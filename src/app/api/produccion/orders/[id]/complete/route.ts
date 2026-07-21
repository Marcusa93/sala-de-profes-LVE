import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { normalizeToStockUnit } from '@/lib/produccion/units'
import { logAudit } from '@/lib/audit'
import { notifyEvent } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// POST /api/produccion/orders/[id]/complete
// ---------------------------------------------------------------------------
// Cierra la orden de producción aplicando todos los movimientos de stock:
//   - Descuenta los insumos (production_inputs)
//   - Suma los productos obtenidos (production_outputs no-waste con stock_item_id)
//   - Registra la merma
//   - Marca la orden como 'completed'
//
// Retorna: { success, order_id, total_input_qty, total_output_qty, waste_qty,
//            efficiency_pct, movements }
// ---------------------------------------------------------------------------

async function realignStockFromFudo(admin: ReturnType<typeof createAdminClient>) {
  try {
    const { syncFromFudo } = await import('@/lib/fudo/stock-sync')
    const read = await syncFromFudo(admin)
    return { success: true, synced: read.synced, errors: read.errors }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error al re-sincronizar desde Fudo' }
  }
}

async function validateOrderFudoLinks(admin: ReturnType<typeof createAdminClient>, orderId: number) {
  const [inputsRes, outputsRes] = await Promise.all([
    admin
      .from('production_inputs')
      .select('stock_item_id, stock_items(name, fudo_ingredient_id, fudo_product_id, fudo_skip)')
      .eq('production_order_id', orderId),
    admin
      .from('production_outputs')
      .select('stock_item_id, output_name, is_waste, stock_items(name, fudo_ingredient_id, fudo_product_id, fudo_skip)')
      .eq('production_order_id', orderId),
  ])

  if (inputsRes.error) return [`No pude validar materias primas Fudo: ${inputsRes.error.message}`]
  if (outputsRes.error) return [`No pude validar productos Fudo: ${outputsRes.error.message}`]

  const errors: string[] = []
  // fudo_skip = semielaborado local intencional (milanesa cruda): válido, no bloquea.
  type FudoItem = { name?: string | null; fudo_ingredient_id?: string | null; fudo_product_id?: string | null; fudo_skip?: boolean | null }
  const unlinked = (item: FudoItem | null) => !item?.fudo_ingredient_id && !item?.fudo_product_id && !item?.fudo_skip

  for (const input of inputsRes.data ?? []) {
    const item = input.stock_items as unknown as FudoItem | null
    if (!input.stock_item_id || unlinked(item)) {
      errors.push(`${item?.name ?? input.stock_item_id ?? 'Materia prima'}: sin vínculo Fudo`)
    }
  }

  for (const output of outputsRes.data ?? []) {
    if (output.is_waste) continue
    const item = output.stock_items as unknown as FudoItem | null
    if (!output.stock_item_id || unlinked(item)) {
      errors.push(`${item?.name ?? output.output_name ?? 'Producto final'}: sin vínculo Fudo`)
    }
  }

  return errors
}

// Normaliza las filas de la orden a la unidad de cada item de stock antes de
// ejecutar el RPC (que suma/resta contra stock_items.current_qty sin convertir).
// Cubre órdenes creadas antes de que el alta convirtiera unidades.
async function normalizeOrderUnits(admin: ReturnType<typeof createAdminClient>, orderId: number) {
  const [inputsRes, outputsRes] = await Promise.all([
    admin
      .from('production_inputs')
      .select('id, qty_used, unit, stock_items(name, unit)')
      .eq('production_order_id', orderId),
    admin
      .from('production_outputs')
      .select('id, qty_produced, unit, is_waste, stock_item_id, stock_items(name, unit)')
      .eq('production_order_id', orderId),
  ])

  const errors: string[] = []

  for (const input of inputsRes.data ?? []) {
    const item = input.stock_items as unknown as { name: string; unit: string } | null
    if (!item || input.unit === item.unit) continue
    const normalized = normalizeToStockUnit(Number(input.qty_used), String(input.unit), item)
    if (!normalized.ok) { errors.push(normalized.error); continue }
    const { error } = await admin
      .from('production_inputs')
      .update({ qty_used: normalized.qty, unit: normalized.unit })
      .eq('id', input.id)
    if (error) errors.push(`${item.name}: ${error.message}`)
  }

  for (const output of outputsRes.data ?? []) {
    if (output.is_waste || !output.stock_item_id) continue
    const item = output.stock_items as unknown as { name: string; unit: string } | null
    if (!item || output.unit === item.unit) continue
    const normalized = normalizeToStockUnit(Number(output.qty_produced), String(output.unit), item)
    if (!normalized.ok) { errors.push(normalized.error); continue }
    const { error } = await admin
      .from('production_outputs')
      .update({ qty_produced: normalized.qty, unit: normalized.unit })
      .eq('id', output.id)
    if (error) errors.push(`${item.name}: ${error.message}`)
  }

  return errors
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!profile || !isManagerOrAbove(profile.role)) {
      return NextResponse.json({
        error: 'Solo socio o encargado puede validar producción e impactar Fudo',
      }, { status: 403 })
    }

    const { id: idStr } = await params
    const id = Number(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const admin = createAdminClient()

    const { data: order, error: orderErr } = await admin
      .from('production_orders')
      .select('id, name, status')
      .eq('id', id)
      .single()

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Orden de producción no encontrada' }, { status: 404 })
    }

    if (order.status === 'completed') {
      return NextResponse.json({ error: 'La producción ya fue completada' }, { status: 409 })
    }

    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'No se puede validar una producción cancelada' }, { status: 409 })
    }

    const fudoLinkErrors = await validateOrderFudoLinks(admin, id)
    if (fudoLinkErrors.length > 0) {
      return NextResponse.json({
        success: false,
        order_id: id,
        status: order.status,
        error: `Producción bloqueada: todo insumo/producto debe estar vinculado a Fudo. ${fudoLinkErrors.join('; ')}`,
      }, { status: 409 })
    }

    const unitErrors = await normalizeOrderUnits(admin, id)
    if (unitErrors.length > 0) {
      return NextResponse.json({
        success: false,
        order_id: id,
        status: order.status,
        error: `Producción bloqueada por unidades incompatibles: ${unitErrors.join('; ')}`,
      }, { status: 409 })
    }

    const { fudo } = await import('@/lib/fudoClient')
    const fudoConnection = await fudo.testConnection()
    if (!fudoConnection.ok) {
      return NextResponse.json({
        success: false,
        order_id: id,
        status: order.status,
        error: `Fudo no está disponible. Producción no validada: ${fudoConnection.error}`,
      }, { status: 502 })
    }

    // Call the SECURITY DEFINER RPC that handles all stock movements transactionally
    const { data, error } = await admin.rpc('complete_production_order', {
      p_order_id: id,
      p_user_id: user.id,
    })

    if (error) throw error

    const result = data as {
      success: boolean
      error?: string
      order_id?: number
      total_input_qty?: number
      total_output_qty?: number
      waste_qty?: number
      efficiency_pct?: number
      movements?: { stock_item_id: number | string; change: number }[]
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Error al completar la orden' }, { status: 400 })
    }

    // Sync affected stock items to Fudo
    const movements = (result.movements ?? []) as { stock_item_id: number; change: number }[]
    let fudoSummary: { synced: number; errors: string[] } | null = null
    if (movements.length > 0) {
      try {
        const { syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
        fudoSummary = await syncProductionToFudo(admin, movements, user.id)
        if (fudoSummary.errors.length > 0) {
          const realignment = await realignStockFromFudo(admin)
          return NextResponse.json({
            success: false,
            order_id: result.order_id,
            status: 'completed_local_fudo_failed',
            error: 'La producción se cerró en LVE pero Fudo no confirmó todos los movimientos. LVE se re-sincronizó desde Fudo cuando fue posible.',
            fudo: fudoSummary,
            realignment,
          }, { status: 502 })
        }
      } catch (err) {
        const realignment = await realignStockFromFudo(admin)
        return NextResponse.json({
          success: false,
          order_id: result.order_id,
          status: 'completed_local_fudo_failed',
          error: `La producción se cerró en LVE pero falló la sincronización con Fudo: ${err instanceof Error ? err.message : 'error desconocido'}. LVE se re-sincronizó desde Fudo cuando fue posible.`,
          fudo: fudoSummary,
          realignment,
        }, { status: 502 })
      }
    }

    const { error: reviewErr } = await admin
      .from('production_orders')
      .update({
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: 'Aprobada desde Control de Producción',
      })
      .eq('id', id)

    if (reviewErr) {
      console.warn('[production review metadata warning]', reviewErr.message)
    }

    const validatorName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
    logAudit(admin, {
      userId: user.id,
      userName: validatorName,
      action: 'complete_production_order',
      module: 'produccion',
      entityType: 'production_order',
      entityId: String(id),
      description: `${validatorName ?? 'Alguien'}: validó "${order.name}" — eficiencia ${result.efficiency_pct}%`,
      metadata: {
        total_input_qty: result.total_input_qty,
        total_output_qty: result.total_output_qty,
        waste_qty: result.waste_qty,
        efficiency_pct: result.efficiency_pct,
        movements: result.movements,
        fudo_synced: fudoSummary ? fudoSummary.errors.length === 0 : true,
      },
    })

    notifyEvent(admin, 'production_completed', {
      title: '👨‍🍳 Producción validada',
      body: `${validatorName ?? 'Alguien'}: "${order.name}" — eficiencia ${result.efficiency_pct}%`,
      url: '/stock/produccion',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      order_id: result.order_id,
      total_input_qty: result.total_input_qty,
      total_output_qty: result.total_output_qty,
      waste_qty: result.waste_qty,
      efficiency_pct: result.efficiency_pct,
      movements: result.movements,
      fudo: fudoSummary,
      message: `Producción validada — eficiencia ${result.efficiency_pct}%`,
    })
  } catch (err) {
    console.error('[POST /api/produccion/orders/[id]/complete]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
