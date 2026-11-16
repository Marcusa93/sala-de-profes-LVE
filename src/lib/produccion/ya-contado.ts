import type { SupabaseClient } from '@supabase/supabase-js'
import { insertStockMovement } from '@/lib/fudo/stock-sync'

// ---------------------------------------------------------------------------
// Producción que ya estaba en el conteo
// ---------------------------------------------------------------------------
// Si un producto se contó DESPUÉS de que se cargó la producción, el conteo ya
// incluye lo producido (estaba en la heladera). Al confirmarla, la producción
// queda registrada igual (para reportes, costos y rendimiento) pero ese
// producto no se vuelve a sumar: ni en la app ni en Fudo. Así la jefa de
// cocina puede contar y confirmar en cualquier orden.
// ---------------------------------------------------------------------------

export type YaContado = { nombre: string; contado_at: string; antes: number }

type Movimiento = { stock_item_id: number | string; change: number; movement_id?: string | null }

const TZ = 'America/Argentina/Buenos_Aires'
const cuando = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Antes de cerrar: los productos de la orden contados después de cargarla (con su stock de ahora). */
export async function productosYaContados(admin: SupabaseClient, orderId: number, cargadaAt: string): Promise<Map<string, YaContado>> {
  const { data } = await admin.from('production_outputs')
    .select('stock_item_id, is_waste, stock_items(name, last_counted_at, current_qty)')
    .eq('production_order_id', orderId)
  const out = new Map<string, YaContado>()
  for (const o of (data ?? []) as unknown as { stock_item_id: string | null; is_waste: boolean | null; stock_items: { name: string; last_counted_at: string | null; current_qty: number } | null }[]) {
    const s = o.stock_items
    if (!o.stock_item_id || o.is_waste || !s?.last_counted_at) continue
    if (s.last_counted_at > cargadaAt) out.set(o.stock_item_id, { nombre: s.name, contado_at: s.last_counted_at, antes: Number(s.current_qty) })
  }
  return out
}

/**
 * Después del RPC (que ya sumó todo en la app): a lo ya contado le saca la
 * suma en la app y lo deja afuera de lo que se manda a Fudo. Devuelve los
 * movimientos que sí van a Fudo y los nombres de lo que no se sumó.
 */
export async function noSumarLoYaContado(
  admin: SupabaseClient,
  movimientos: Movimiento[],
  yaContados: Map<string, YaContado>,
  p: { userId: string; orderId: number },
): Promise<{ movimientos: Movimiento[]; omitidos: string[]; avisos: string[] }> {
  if (yaContados.size === 0) return { movimientos, omitidos: [], avisos: [] }
  const omitidos: string[] = []
  const avisos: string[] = []

  for (const [itemId, info] of yaContados) {
    const delItem = movimientos.filter((m) => String(m.stock_item_id) === itemId)
    const sumado = delItem.filter((m) => Number(m.change) > 0).reduce((a, m) => a + Number(m.change), 0)
    if (sumado <= 0) continue
    const neto = delItem.reduce((a, m) => a + Number(m.change), 0)
    // Lo que tiene que haber ahora en la app si nadie más lo tocó: lo de antes + lo que movió el RPC
    const esperado = Math.round((info.antes + neto) * 1000) / 1000
    const nuevo = Math.round((esperado - sumado) * 1000) / 1000
    const { data: hecho } = await admin.from('stock_items')
      .update({ current_qty: nuevo, updated_at: new Date().toISOString() })
      .eq('id', itemId).eq('current_qty', esperado).select('id')
    if (!hecho?.length) {
      // Alguien lo movió en el medio: Fudo no recibe la suma y la app se
      // re-espeja de Fudo en la próxima lectura (cada hora), así que queda bien igual
      avisos.push(`${info.nombre}: se acomoda solo con la próxima lectura de Fudo`)
    } else {
      await insertStockMovement(admin, {
        stock_item_id: itemId,
        movement_type: 'ajuste',
        qty: sumado,
        previous_qty: esperado,
        new_qty: nuevo,
        reason: 'ya_contado',
        note: `${info.nombre}: lo producido ya estaba en el conteo del ${cuando(info.contado_at)}; la producción queda registrada pero no se suma de nuevo`,
        created_by: p.userId,
        production_order_id: p.orderId,
        fudo_synced: true,
      })
    }
    omitidos.push(info.nombre)
  }

  return {
    movimientos: movimientos.filter((m) => !(yaContados.has(String(m.stock_item_id)) && Number(m.change) > 0)),
    omitidos,
    avisos,
  }
}
