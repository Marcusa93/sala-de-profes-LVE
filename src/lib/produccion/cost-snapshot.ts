import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Congelar el costo de producción al momento de completar.
// ---------------------------------------------------------------------------
// Sin esto, el costo de una producción se recalcula SIEMPRE con el precio de
// hoy de cada insumo — no es histórico. Al completar una orden, copiamos el
// costo actual de cada insumo (stock_items.cost_per_unit, ya en la unidad del
// item porque las cantidades se normalizan antes de guardar) a
// production_inputs.cost_per_unit. Así el costo de esa producción queda fijo:
// aunque mañana suba la nalga, la milanesa que hiciste hoy conserva su costo.
//
// Solo rellena los insumos con cost_per_unit NULL — nunca pisa un costo ya
// congelado (idempotente si se llama dos veces).
// ---------------------------------------------------------------------------

export async function snapshotProductionInputCosts(
  admin: SupabaseClient,
  orderId: number,
): Promise<void> {
  const { data: inputs } = await admin
    .from('production_inputs')
    .select('id, cost_per_unit, stock_items(cost_per_unit)')
    .eq('production_order_id', orderId)

  for (const input of inputs ?? []) {
    if (input.cost_per_unit != null) continue
    const stockCost = (input.stock_items as { cost_per_unit?: number | null } | null)?.cost_per_unit
    if (stockCost == null || stockCost <= 0) continue
    await admin
      .from('production_inputs')
      .update({ cost_per_unit: stockCost })
      .eq('id', input.id)
  }
}
