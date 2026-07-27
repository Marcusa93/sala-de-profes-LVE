import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { PRODUCTION_BATCHES, matchIngredientToStock } from '@/lib/recipes/production-batches'
import { canon, toStockUnit } from '@/lib/recipes/recipe-cost'

// ---------------------------------------------------------------------------
// GET /api/produccion/sugerencias
// ---------------------------------------------------------------------------
// "¿Qué producir hoy?" con datos duros — sin IA, todo trazable.
//
// Para cada receta de producción del recetario (PRODUCTION_BATCHES) cuya
// salida (elaborado intermedio) está vinculada a un stock_item:
//
//   1. Demanda por día de semana: fudo_sales últimos 28 días (sold_at UTC→AR
//      restando 3h), unidades vendidas de los productos que CONSUMEN ese
//      intermedio vía la cadena oficial:
//        menu_items(fudo_product_id, recipe_id) → recipe_ingredients →
//        stock_item del intermedio (qty_per_portion, canonicalizada).
//      Más la venta directa si el propio intermedio tiene fudo_product_id.
//      Si no existe ninguna cadena, fallback: stock_movements out/sale del
//      propio stock_item (mismo criterio que lib/stock/consumption.ts).
//   2. Stock actual (stock_items.current_qty) + lotes vigentes: lo vencido
//      (stock_lots.expires_at < hoy con qty_remaining) se descuenta del
//      stock utilizable.
//   3. Sugerencia = max(0, demanda hoy + demanda mañana − stock utilizable),
//      redondeada al tamaño de tanda típica (promedio del output total por
//      orden de producción completada; fallback: yieldPerBase del recetario).
//
// Orden: cobertura_dias asc (más urgente primero). Se excluye lo que tiene
// cobertura > 3 días. Roles cocina. Cache en memoria de módulo: 10 minutos.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 10 * 60 * 1000
const WINDOW_DAYS = 28
const AR_OFFSET_MS = 3 * 60 * 60 * 1000 // UTC-3, sin DST en Argentina
const DOW_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const PAGE_SIZE = 1000

export type SugerenciaItem = {
  recipe_id: string            // slug de la receta de producción
  nombre: string               // displayName de la receta
  stock_item_id: string
  stock_item_name: string      // elaborado intermedio en stock
  unidad: string
  stock_actual: number
  stock_utilizable: number     // stock_actual − lotes vencidos
  vencido_qty: number
  vence_proximo: string | null // fecha de vencimiento más cercana de lotes vigentes
  demanda_hoy: number
  demanda_maniana: number
  demanda_diaria_prom: number
  sugerido: number
  tanda_tipica: number | null
  cobertura_dias: number
  fuente_demanda: 'ventas_fudo' | 'movimientos_stock'
  reason: string
}

type Payload = {
  generated_at: string
  hoy: string
  maniana: string
  ventana_dias: number
  items: SugerenciaItem[]
  sin_datos: string[]          // recetas con salida vinculada pero sin demanda medible
}

let cached: { at: number; payload: Payload } | null = null

/** Pagina de a 1000 (PostgREST corta en 1000 por default). */
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

/** Fecha AR (YYYY-MM-DD) y día de semana AR de un timestamp UTC. */
function argDateDow(iso: string): { date: string; dow: number } {
  const t = new Date(new Date(iso).getTime() - AR_OFFSET_MS)
  return { date: t.toISOString().slice(0, 10), dow: t.getUTCDay() }
}

function round1(n: number) { return Math.round(n * 10) / 10 }

export async function GET() {
  try {
    const auth = await requireRole(['socio', 'encargado', 'chef', 'cocina'])
    if (auth.response) return auth.response

    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload)
    }

    const admin = createAdminClient()
    const cutoffISO = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString()
    const { dow: todayDow } = argDateDow(new Date().toISOString())
    const tomorrowDow = (todayDow + 1) % 7

    // --- 1) Recetas de producción con salida vinculada a un stock_item ---
    const { data: stockItems, error: siError } = await admin
      .from('stock_items')
      .select('id, name, unit, current_qty, fudo_product_id, shelf_life_days')
      .eq('is_active', true)
    if (siError) throw new Error(siError.message)
    const allStock = stockItems ?? []

    type Intermediate = {
      slug: string
      displayName: string
      yieldPerBase: number
      item: (typeof allStock)[number]
    }
    const intermediates: Intermediate[] = []
    for (const batch of PRODUCTION_BATCHES) {
      if (!batch.output) continue
      const match = matchIngredientToStock(batch.output.name, allStock)
      if (!match) continue
      intermediates.push({
        slug: batch.slug,
        displayName: batch.displayName,
        yieldPerBase: batch.output.yieldPerBase,
        item: match,
      })
    }
    const itemIds = intermediates.map(i => i.item.id)

    if (intermediates.length === 0) {
      const payload: Payload = {
        generated_at: new Date().toISOString(),
        hoy: DOW_LABELS[todayDow], maniana: DOW_LABELS[tomorrowDow],
        ventana_dias: WINDOW_DAYS, items: [], sin_datos: [],
      }
      return NextResponse.json(payload)
    }

    // --- 2) Cadena de consumo: qué productos Fudo consumen cada intermedio ---
    // menu_items → recipes → recipe_ingredients(stock_item del intermedio)
    const [{ data: menuItems }, { data: riRows }] = await Promise.all([
      admin.from('menu_items')
        .select('recipe_id, fudo_product_id')
        .eq('is_active', true)
        .not('recipe_id', 'is', null)
        .not('fudo_product_id', 'is', null),
      admin.from('recipe_ingredients')
        .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
        .in('stock_item_id', itemIds),
    ])

    const fudoIdsByRecipe = new Map<string, string[]>()
    for (const mi of menuItems ?? []) {
      if (!mi.recipe_id || !mi.fudo_product_id) continue
      const list = fudoIdsByRecipe.get(mi.recipe_id) ?? []
      list.push(mi.fudo_product_id)
      fudoIdsByRecipe.set(mi.recipe_id, list)
    }

    // fudo_product_id → [{ itemId, factor }] (factor = qty de intermedio por unidad vendida)
    const consumersByFudoId = new Map<string, { itemId: string; factor: number }[]>()
    const addConsumer = (fudoId: string, itemId: string, factor: number) => {
      const list = consumersByFudoId.get(fudoId) ?? []
      list.push({ itemId, factor })
      consumersByFudoId.set(fudoId, list)
    }

    const itemById = new Map(intermediates.map(i => [i.item.id, i.item]))
    for (const ri of riRows ?? []) {
      const item = itemById.get(ri.stock_item_id)
      if (!item) continue
      const fudoIds = fudoIdsByRecipe.get(ri.recipe_id) ?? []
      if (fudoIds.length === 0) continue
      // Canonicalizar unidad de la receta y convertir a la unidad del stock_item
      const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
      const factor = toStockUnit(c.qty, c.unit, item.unit)
      if (factor <= 0) continue
      for (const fudoId of fudoIds) addConsumer(fudoId, item.id, factor)
    }
    // Venta directa: el intermedio ES un producto Fudo (ej. Milanesa cruda mapeada)
    for (const i of intermediates) {
      if (i.item.fudo_product_id) addConsumer(i.item.fudo_product_id, i.item.id, 1)
    }

    // --- 3) Ventas últimos 28 días de los productos consumidores ---
    const allFudoIds = [...consumersByFudoId.keys()]
    // qtyByDow por intermedio (en unidad del stock_item)
    const demandByItem = new Map<string, number[]>()
    for (const id of itemIds) demandByItem.set(id, Array(7).fill(0))
    // días activos por día de semana (fechas AR distintas con alguna venta)
    const datesByDow: Array<Set<string>> = Array.from({ length: 7 }, () => new Set<string>())

    if (allFudoIds.length > 0) {
      type SaleRow = { fudo_product_id: string; quantity: number; sold_at: string }
      const sales = await fetchAll<SaleRow>((from, to) =>
        admin.from('fudo_sales')
          .select('fudo_product_id, quantity, sold_at')
          .in('fudo_product_id', allFudoIds)
          .gte('sold_at', cutoffISO)
          .order('id', { ascending: true })
          .range(from, to) as never,
      )
      for (const s of sales) {
        const { date, dow } = argDateDow(s.sold_at)
        datesByDow[dow].add(date)
        const consumers = consumersByFudoId.get(s.fudo_product_id) ?? []
        for (const c of consumers) {
          demandByItem.get(c.itemId)![dow] += Number(s.quantity ?? 0) * c.factor
        }
      }
    }

    // Fallback: intermedios sin ninguna cadena de venta → stock_movements out/sale
    const withSales = new Set(
      [...consumersByFudoId.values()].flat().map(c => c.itemId),
    )
    const fallbackIds = itemIds.filter(id => !withSales.has(id))
    const fallbackItems = new Set<string>()
    if (fallbackIds.length > 0) {
      const movements = await fetchAll<{ stock_item_id: string; qty: number; created_at: string | null }>((from, to) =>
        admin.from('stock_movements')
          .select('stock_item_id, qty, created_at')
          .in('stock_item_id', fallbackIds)
          .eq('movement_type', 'out')
          .eq('reason', 'sale')
          .gte('created_at', cutoffISO)
          .order('id', { ascending: true })
          .range(from, to) as never,
      )
      for (const m of movements) {
        if (!m.created_at) continue
        const { date, dow } = argDateDow(m.created_at)
        datesByDow[dow].add(date)
        demandByItem.get(m.stock_item_id)![dow] += Number(m.qty ?? 0)
        fallbackItems.add(m.stock_item_id)
      }
    }

    // --- 4) Lotes vigentes / vencidos + tanda típica histórica ---
    const nowISO = new Date().toISOString()
    const [{ data: lots }, { data: outputs }] = await Promise.all([
      admin.from('stock_lots')
        .select('stock_item_id, qty_remaining, expires_at')
        .in('stock_item_id', itemIds)
        .gt('qty_remaining', 0),
      admin.from('production_outputs')
        .select('stock_item_id, production_order_id, qty_produced, is_waste, production_orders!inner(status)')
        .in('stock_item_id', itemIds)
        .eq('production_orders.status', 'completed'),
    ])

    const expiredByItem = new Map<string, number>()
    const nextExpiryByItem = new Map<string, string>()
    for (const lot of lots ?? []) {
      if (lot.expires_at && lot.expires_at < nowISO) {
        expiredByItem.set(lot.stock_item_id, (expiredByItem.get(lot.stock_item_id) ?? 0) + Number(lot.qty_remaining))
      } else if (lot.expires_at) {
        const prev = nextExpiryByItem.get(lot.stock_item_id)
        if (!prev || lot.expires_at < prev) nextExpiryByItem.set(lot.stock_item_id, lot.expires_at)
      }
    }

    // Tanda típica = promedio del total producido por orden completada
    const byItemOrder = new Map<string, Map<number, number>>()
    for (const o of (outputs ?? []) as unknown as { stock_item_id: string; production_order_id: number; qty_produced: number; is_waste: boolean | null }[]) {
      if (!o.stock_item_id || o.is_waste) continue
      const orders = byItemOrder.get(o.stock_item_id) ?? new Map<number, number>()
      orders.set(o.production_order_id, (orders.get(o.production_order_id) ?? 0) + Number(o.qty_produced))
      byItemOrder.set(o.stock_item_id, orders)
    }
    const tandaByItem = new Map<string, number>()
    for (const [itemId, orders] of byItemOrder) {
      const totals = [...orders.values()].filter(t => t > 0)
      if (totals.length === 0) continue
      tandaByItem.set(itemId, totals.reduce((a, b) => a + b, 0) / totals.length)
    }

    // --- 5) Armar sugerencias ---
    const items: SugerenciaItem[] = []
    const sinDatos: string[] = []
    const totalActiveDays = Math.max(new Set(datesByDow.flatMap(s => [...s])).size, 1)

    for (const inter of intermediates) {
      const dowQty = demandByItem.get(inter.item.id)!
      const total = dowQty.reduce((a, b) => a + b, 0)
      if (total <= 0) { sinDatos.push(inter.displayName); continue }

      const perDow = (dow: number) => {
        const days = Math.max(datesByDow[dow].size, 1)
        return dowQty[dow] / days
      }
      const avgDaily = total / totalActiveDays
      // Si nunca hubo venta ese día de semana, usar el promedio general
      const demandaHoy = dowQty[todayDow] > 0 ? perDow(todayDow) : avgDaily
      const demandaManiana = dowQty[tomorrowDow] > 0 ? perDow(tomorrowDow) : avgDaily

      const stockActual = Number(inter.item.current_qty)
      const vencido = expiredByItem.get(inter.item.id) ?? 0
      const utilizable = Math.max(0, stockActual - vencido)

      const cobertura = avgDaily > 0 ? utilizable / avgDaily : Infinity
      if (cobertura > 3) continue // hay stock para más de 3 días: no urge

      const raw = Math.max(0, demandaHoy + demandaManiana - utilizable)
      const tandaHist = tandaByItem.get(inter.item.id) ?? null
      const tanda = tandaHist ?? inter.yieldPerBase
      let sugerido = Math.ceil(raw)
      if (raw > 0 && tanda > 0) {
        // Redondear al múltiplo de tanda más cercano, mínimo una tanda
        sugerido = round1(Math.max(1, Math.round(raw / tanda)) * tanda)
      }

      const dowName = DOW_LABELS[todayDow]
      const reason = raw > 0
        ? `Los ${dowName} se venden ~${round1(demandaHoy)}, tenés ${round1(utilizable)}${vencido > 0 ? ` (${round1(vencido)} vencidos)` : ''}`
        : `Tenés ${round1(utilizable)}: cubre hoy (~${round1(demandaHoy)}) y mañana (~${round1(demandaManiana)}), pero queda poco margen`

      items.push({
        recipe_id: inter.slug,
        nombre: inter.displayName,
        stock_item_id: inter.item.id,
        stock_item_name: inter.item.name,
        unidad: inter.item.unit,
        stock_actual: round1(stockActual),
        stock_utilizable: round1(utilizable),
        vencido_qty: round1(vencido),
        vence_proximo: nextExpiryByItem.get(inter.item.id)?.slice(0, 10) ?? null,
        demanda_hoy: round1(demandaHoy),
        demanda_maniana: round1(demandaManiana),
        demanda_diaria_prom: round1(avgDaily),
        sugerido,
        tanda_tipica: tanda > 0 ? Math.round(tanda * 10) / 10 : null,
        cobertura_dias: Math.round(cobertura * 10) / 10,
        fuente_demanda: fallbackItems.has(inter.item.id) ? 'movimientos_stock' : 'ventas_fudo',
        reason,
      })
    }

    items.sort((a, b) => a.cobertura_dias - b.cobertura_dias)

    const payload: Payload = {
      generated_at: new Date().toISOString(),
      hoy: DOW_LABELS[todayDow],
      maniana: DOW_LABELS[tomorrowDow],
      ventana_dias: WINDOW_DAYS,
      items,
      sin_datos: sinDatos,
    }
    cached = { at: Date.now(), payload }
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/produccion/sugerencias]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
