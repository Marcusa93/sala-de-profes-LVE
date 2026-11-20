import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROLES_VALIDAN_PRODUCCION, puedeValidarProduccion } from '@/lib/roles'
import { normalizeToStockUnit } from '@/lib/produccion/units'
import { logAudit } from '@/lib/audit'
import { crearTareaAlTerminarProduccion } from '@/lib/protocolos/protocolos'
import { notifyEvent } from '@/lib/push/notify-event'
import { snapshotProductionInputCosts, persistProductionCost } from '@/lib/produccion/cost-snapshot'
import { noSumarLoYaContado, productosYaContados } from '@/lib/produccion/ya-contado'
import { avisoQuedoNegativo, leerFaltantes, textoFaltante, type Faltante } from '@/lib/produccion/faltantes'

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

// Si la orden viene de una plantilla con receta y la receta no tiene
// output_stock_item_id, lo aprende de la salida principal (output no-waste
// con stock_item_id de mayor cantidad). Así el vínculo receta ↔ stock se
// auto-repara con el uso, sin depender del match por nombre.
async function linkRecipeOutput(admin: ReturnType<typeof createAdminClient>, orderId: number) {
  const { data: orderRow } = await admin
    .from('production_orders')
    .select('template_id')
    .eq('id', orderId)
    .single()
  if (!orderRow?.template_id) return

  const { data: template } = await admin
    .from('production_templates')
    .select('recipe_id')
    .eq('id', orderRow.template_id)
    .single()
  if (!template?.recipe_id) return

  const { data: recipe, error: recipeErr } = await admin
    .from('recipes')
    .select('id, output_stock_item_id')
    .eq('id', template.recipe_id)
    .single()
  // Columna todavía no migrada (o receta borrada): no hay nada que reparar.
  if (recipeErr || !recipe || recipe.output_stock_item_id) return

  const { data: outputs } = await admin
    .from('production_outputs')
    .select('stock_item_id, qty_produced, is_waste')
    .eq('production_order_id', orderId)
    .eq('is_waste', false)
    .not('stock_item_id', 'is', null)
    .order('qty_produced', { ascending: false })
    .limit(1)

  const mainOutput = outputs?.[0]
  if (!mainOutput?.stock_item_id) return

  await admin
    .from('recipes')
    .update({ output_stock_item_id: mainOutput.stock_item_id })
    .eq('id', recipe.id)
    .is('output_stock_item_id', null)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Confirmar aunque en la app falte stock de algún insumo (lo decide quien
    // valida, después de ver los números). Ver lib/produccion/faltantes.
    const body = await request.json().catch(() => null) as { permitir_faltante?: unknown } | null
    const permitirFaltante = body?.permitir_faltante === true

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!profile || !(ROLES_VALIDAN_PRODUCCION as readonly string[]).includes(profile.role)) {
      return NextResponse.json({
        error: 'Solo socio, encargado o chef puede validar producción e impactar Fudo',
      }, { status: 403 })
    }

    const { id: idStr } = await params
    const id = Number(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const admin = createAdminClient()

    const { data: order, error: orderErr } = await admin
      .from('production_orders')
      .select('id, name, status, chef_id, submitted_at, created_at')
      .eq('id', id)
      .single()

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Orden de producción no encontrada' }, { status: 404 })
    }

    // El chef confirma la producción de otro, nunca la suya
    if (!puedeValidarProduccion(profile.role, user.id, order.chef_id)) {
      return NextResponse.json({ error: 'Esta producción la cargaste vos: la tiene que confirmar otra persona' }, { status: 403 })
    }

    if (order.status === 'completed') {
      return NextResponse.json({ error: 'La producción ya fue completada' }, { status: 409 })
    }

    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'No se puede validar una producción cancelada' }, { status: 409 })
    }

    if (order.status === 'rejected') {
      return NextResponse.json({ error: 'No se puede validar una producción rechazada' }, { status: 409 })
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

    // Lo que se contó después de cargar esta producción ya la incluye: se
    // registra igual, pero esos productos no se vuelven a sumar (ver ya-contado)
    const yaContados = await productosYaContados(admin, id, order.submitted_at ?? order.created_at)

    // Call the SECURITY DEFINER RPC that handles all stock movements transactionally
    // El tercer parámetro solo se manda cuando hace falta: así la llamada normal
    // anda igual con la función vieja (antes de correr la migración 20261120).
    const { data, error } = await admin.rpc('complete_production_order', {
      p_order_id: id,
      p_user_id: user.id,
      ...(permitirFaltante ? { p_permitir_faltante: true } : {}),
    })

    if (error && permitirFaltante && error.code === 'PGRST202') {
      return NextResponse.json({
        error: 'Todavía no se puede confirmar con faltante de stock: falta actualizar la base (migración 20261120). Mientras tanto, contá el insumo o cargá la compra en Fudo.',
      }, { status: 409 })
    }
    if (error) throw error

    const result = data as {
      success: boolean
      error?: string
      code?: string
      faltantes?: Faltante[]
      order_id?: number
      total_input_qty?: number
      total_output_qty?: number
      waste_qty?: number
      efficiency_pct?: number | null
      total_cost?: number
      cost_per_output_unit?: number | null
      movements?: { stock_item_id: number | string; change: number; movement_id?: string | null }[]
    }

    if (!result.success) {
      // Stock insuficiente: la pantalla muestra qué falta y ofrece confirmar igual
      if (result.code === 'stock_insuficiente') {
        return NextResponse.json({ error: result.error, code: result.code, faltantes: leerFaltantes(result) }, { status: 409 })
      }
      return NextResponse.json({ error: result.error ?? 'Error al completar la orden' }, { status: 400 })
    }
    const faltantes = leerFaltantes(result)

    // Congelar el costo de los insumos y persistir el costo real de la tanda
    // (el RPC v5 ya lo hace; con el RPC viejo lo calcula acá).
    await snapshotProductionInputCosts(admin, id)
    const costSummary = await persistProductionCost(admin, id, {
      rpcAlreadyPersisted: typeof result.cost_per_output_unit === 'number',
    }).catch(() => null)
    const costPerOutputUnit = result.cost_per_output_unit ?? costSummary?.cost_per_output_unit ?? null
    const totalCost = result.total_cost ?? costSummary?.total_cost ?? null

    // Auto-reparación del vínculo receta → stock producido: si la orden viene
    // de una plantilla con receta y esa receta todavía no tiene
    // output_stock_item_id, guardar el stock_item de la salida principal.
    // Best-effort: nunca bloquea la validación (ni si la columna no existe aún).
    await linkRecipeOutput(admin, id).catch((err) => {
      console.warn('[production recipe output link warning]', err instanceof Error ? err.message : err)
    })

    // Sync affected stock items to Fudo (menos lo que ya estaba en el conteo)
    const warnings: string[] = []
    if (faltantes.length > 0) warnings.push(avisoQuedoNegativo(faltantes))
    const yaContado =await noSumarLoYaContado(admin, (result.movements ?? []) as { stock_item_id: number; change: number; movement_id?: string | null }[], yaContados, { userId: user.id, orderId: id })
    if (yaContado.omitidos.length > 0) warnings.push(`Ya estaba en el conteo, no se sumó de nuevo: ${yaContado.omitidos.join(', ')}`)
    warnings.push(...yaContado.avisos)
    const movements = yaContado.movimientos as { stock_item_id: number; change: number; movement_id?: string | null }[]
    let fudoSummary: { synced: number; errors: string[]; encolados: string[] } | null = null
    if (movements.length > 0) {
      try {
        const { syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
        fudoSummary = await syncProductionToFudo(admin, movements, user.id)
        if (fudoSummary.encolados.length > 0) warnings.push(`${fudoSummary.encolados.length === 1 ? 'Un insumo no entró' : `${fudoSummary.encolados.length} insumos no entraron`} a Fudo todavía (queda registrado y se reintenta solo): ${fudoSummary.encolados.map((e) => e.split(':')[0]).join(', ')}`)
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
        review_notes: faltantes.length > 0
          ? `Aprobada con faltante de stock en la app — ${faltantes.map(textoFaltante).join('; ')}`.slice(0, 1000)
          : 'Aprobada desde Control de Producción',
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
      description: `${validatorName ?? 'Alguien'}: validó "${order.name}"${costPerOutputUnit ? ` — $${costPerOutputUnit}/u` : ''}${result.efficiency_pct != null ? ` — eficiencia ${result.efficiency_pct}%` : ''}${faltantes.length > 0 ? ` — con faltante de stock: ${faltantes.map(textoFaltante).join('; ')}` : ''}`,
      metadata: {
        faltantes: faltantes.length > 0 ? faltantes : undefined,
        total_input_qty: result.total_input_qty,
        total_output_qty: result.total_output_qty,
        waste_qty: result.waste_qty,
        efficiency_pct: result.efficiency_pct,
        total_cost: totalCost,
        cost_per_output_unit: costPerOutputUnit,
        movements: result.movements,
        fudo_synced: fudoSummary ? fudoSummary.errors.length === 0 : true,
      },
    })

    notifyEvent(admin, 'production_completed', {
      title: '👨‍🍳 Producción validada',
      body: `${validatorName ?? 'Alguien'}: "${order.name}"${costPerOutputUnit ? ` · $${Math.round(costPerOutputUnit).toLocaleString('es-AR')}/u` : ''}`,
      url: '/stock/produccion',
    }).catch(() => {})

    // Se cerró la producción: toca contar los elaborados (si ya hay una tarea abierta, no se repite)
    await crearTareaAlTerminarProduccion(admin)

    return NextResponse.json({
      success: true,
      warnings,
      order_id: result.order_id,
      total_input_qty: result.total_input_qty,
      total_output_qty: result.total_output_qty,
      waste_qty: result.waste_qty,
      efficiency_pct: result.efficiency_pct,
      total_cost: totalCost,
      cost_per_output_unit: costPerOutputUnit,
      movements: result.movements,
      fudo: fudoSummary,
      ya_contados: yaContado.omitidos,
      faltantes,
      message: costPerOutputUnit
        ? `Producción validada — $${Math.round(costPerOutputUnit).toLocaleString('es-AR')} por unidad`
        : 'Producción validada',
    })
  } catch (err) {
    console.error('[POST /api/produccion/orders/[id]/complete]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
