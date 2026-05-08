import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type QuickOutputPayload = {
  stock_item_id?: string | null
  output_name: string
  qty_produced: number
  theoretical_qty?: number | null
  unit?: string
  is_waste?: boolean
  notes?: string | null
  lot_code?: string | null
  produced_at?: string | null
  expires_at?: string | null
}

function isLotSchemaError(message: string | undefined) {
  if (!message) return false
  return (
    message.includes('lot_code')
    || message.includes('produced_at')
    || message.includes('expires_at')
    || message.includes('stock_lots')
  )
}

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
    return { user: null, error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }
  }

  return { user, error: null }
}

function buildOutputRows(orderId: number, outputs: QuickOutputPayload[], includeLotFields: boolean) {
  return outputs
    .filter((output) => output.output_name && output.qty_produced !== undefined)
    .map((output) => {
      const row: Record<string, unknown> = {
        production_order_id: orderId,
        stock_item_id: output.stock_item_id || null,
        output_name: output.output_name,
        qty_produced: Number(output.qty_produced),
        theoretical_qty: output.theoretical_qty != null ? Number(output.theoretical_qty) : null,
        unit: output.unit ?? 'kg',
        is_waste: Boolean(output.is_waste),
        notes: output.notes ?? null,
      }

      if (includeLotFields) {
        row.lot_code = output.lot_code?.trim() || null
        row.produced_at = output.produced_at ?? null
        row.expires_at = output.expires_at ?? null
      }

      return row
    })
}

async function realignStockFromFudo(admin: ReturnType<typeof createAdminClient>) {
  try {
    const { syncFromFudo } = await import('@/lib/fudo/stock-sync')
    const read = await syncFromFudo(admin)
    return { success: true, synced: read.synced, errors: read.errors }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error al re-sincronizar desde Fudo' }
  }
}

async function validateStockMappings(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (uniqueIds.length === 0) return []

  const { data, error } = await admin
    .from('stock_items')
    .select('id, name, fudo_ingredient_id, fudo_product_id, fudo_skip')
    .in('id', uniqueIds)

  if (error) return [`No pude validar mapeos Fudo: ${error.message}`]

  const rowsById = new Map((data ?? []).map((row) => [String(row.id), row]))
  const errors: string[] = []

  for (const id of uniqueIds) {
    const row = rowsById.get(id)
    if (!row) {
      errors.push(`${id}: item de stock no encontrado`)
      continue
    }
    const isLocalOnly = (row as Record<string, unknown>).fudo_skip === true
    if (!row.fudo_ingredient_id && !row.fudo_product_id && !isLocalOnly) {
      errors.push(`${row.name}: sin mapeo Fudo ni local explícito`)
    }
  }

  return errors
}

export async function POST(request: NextRequest) {
  let orderId: number | null = null

  try {
    const supabase = await createClient()
    const { user, error: authErr } = await authorize(supabase)
    if (authErr || !user) return authErr!

    const body = await request.json().catch(() => null)
    if (!body?.name || !body?.input || !body?.outputs?.length) {
      return NextResponse.json({
        error: 'Campos requeridos: name, input (stock_item_id, qty_used, unit), outputs[]',
      }, { status: 400 })
    }

    const admin = createAdminClient()
    const autoComplete = body.auto_complete !== false
    const warnings: string[] = []

    const mappingErrors = await validateStockMappings(admin, [
      String(body.input.stock_item_id),
      ...((body.outputs as QuickOutputPayload[])
        .filter((output) => !output.is_waste && output.stock_item_id)
        .map((output) => String(output.stock_item_id))),
    ])

    if (mappingErrors.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Producción bloqueada por mapeo Fudo: ${mappingErrors.join('; ')}`,
      }, { status: 409 })
    }

    const { data: order, error: orderErr } = await admin
      .from('production_orders')
      .insert({
        name: body.name,
        template_id: body.template_id ?? null,
        status: 'draft',
        chef_id: user.id,
        notes: body.notes ?? null,
      })
      .select('id')
      .single()

    if (orderErr || !order) {
      throw new Error(orderErr?.message ?? 'Error al crear la orden')
    }

    orderId = order.id

    const { error: inputErr } = await admin
      .from('production_inputs')
      .insert({
        production_order_id: orderId,
        stock_item_id: body.input.stock_item_id,
        qty_used: Number(body.input.qty_used),
        unit: body.input.unit ?? 'kg',
        cost_per_unit: body.input.cost_per_unit != null ? Number(body.input.cost_per_unit) : null,
      })

    if (inputErr) {
      throw new Error(`Error al agregar insumo: ${inputErr.message}`)
    }

    const outputRowsWithLots = buildOutputRows(orderId, body.outputs as QuickOutputPayload[], true)
    if (outputRowsWithLots.length === 0) {
      throw new Error('Se requiere al menos una salida')
    }

    let lotSupport = true
    let { error: outputErr } = await admin
      .from('production_outputs')
      .insert(outputRowsWithLots)

    if (outputErr && isLotSchemaError(outputErr.message)) {
      lotSupport = false
      warnings.push('La migración de lotes todavía no está aplicada. La producción se guardó sin vencimientos por lote.')
      const fallbackRows = buildOutputRows(orderId, body.outputs as QuickOutputPayload[], false)
      const fallbackInsert = await admin.from('production_outputs').insert(fallbackRows)
      outputErr = fallbackInsert.error
    }

    if (outputErr) {
      throw new Error(`Error al agregar salidas: ${outputErr.message}`)
    }

    if (!autoComplete) {
      return NextResponse.json({
        success: true,
        order_id: orderId,
        status: 'draft',
        warnings,
        message: 'Orden creada como borrador',
      }, { status: 201 })
    }

    const { fudo } = await import('@/lib/fudoClient')
    const fudoConnection = await fudo.testConnection()
    if (!fudoConnection.ok) {
      return NextResponse.json({
        success: false,
        order_id: orderId,
        status: 'draft',
        error: `Fudo no está disponible. Producción no cerrada: ${fudoConnection.error}`,
      }, { status: 502 })
    }

    const { data: result, error: completeErr } = await admin.rpc(
      'complete_production_order',
      { p_order_id: orderId, p_user_id: user.id },
    )

    if (completeErr) {
      throw new Error(`Error al completar: ${completeErr.message}`)
    }

    const rpcResult = result as {
      success: boolean
      error?: string
      total_input_qty?: number
      total_output_qty?: number
      waste_qty?: number
      efficiency_pct?: number
      movements?: { stock_item_id: number | string; change: number }[]
    }

    if (!rpcResult.success) {
      return NextResponse.json({
        error: rpcResult.error ?? 'Error al completar la orden',
        order_id: orderId,
        status: 'draft',
      }, { status: 400 })
    }

    const movements = rpcResult.movements ?? []
    let fudoSummary: { synced: number; errors: string[] } | null = null

    if (movements.length > 0) {
      try {
        const { syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
        fudoSummary = await syncProductionToFudo(admin, movements, user.id)
        if (fudoSummary.errors.length > 0) {
          const realignment = await realignStockFromFudo(admin)
          return NextResponse.json({
            success: false,
            order_id: orderId,
            status: 'completed_local_fudo_failed',
            error: 'La producción se cerró en LVE pero no quedó sincronizada completa con Fudo',
            fudo: fudoSummary,
            realignment,
            warnings,
          }, { status: 502 })
        }
      } catch (err) {
        const realignment = await realignStockFromFudo(admin)
        return NextResponse.json({
          success: false,
          order_id: orderId,
          status: 'completed_local_fudo_failed',
          error: `No se pudo sincronizar producción a Fudo: ${err instanceof Error ? err.message : 'error desconocido'}`,
          realignment,
          warnings,
        }, { status: 502 })
      }
    }

    if (!lotSupport) {
      warnings.push('Aplicá la migración `20260507_stock_lots.sql` para registrar lote, elaboración y vencimiento en LVE.')
    }

    return NextResponse.json({
      success: true,
      order_id: orderId,
      status: 'completed',
      total_input_qty: rpcResult.total_input_qty,
      total_output_qty: rpcResult.total_output_qty,
      waste_qty: rpcResult.waste_qty,
      efficiency_pct: rpcResult.efficiency_pct,
      warnings,
      fudo: fudoSummary,
      message: `Producción completada — eficiencia ${rpcResult.efficiency_pct}%`,
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/produccion/orders/quick]', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Error interno',
      order_id: orderId,
      status: orderId ? 'draft' : null,
    }, { status: orderId ? 400 : 500 })
  }
}
