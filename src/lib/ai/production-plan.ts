// ---------------------------------------------------------------------------
// Plan de producción IA — el puente físico↔digital de producción.
// Cruza: velocidad de venta por producto y día de semana (Fudo) × stock actual
// × vida útil × producción pendiente → sugiere cuánto producir hoy.
// ---------------------------------------------------------------------------

import { SupabaseClient } from '@supabase/supabase-js'
import { format, subMonths } from 'date-fns'
import { fetchMonthSales, type MonthSale } from '@/lib/fudo/month-sales'

const DOW_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Categorías que produce la casa (lo que tiene sentido "producir")
const PRODUCIBLE_CATEGORIES = ['elaborados', 'panaderia']

export type ProductionPlanItem = {
  stock_item_id: string
  name: string
  unit: string
  category: string
  current_qty: number
  shelf_life_days: number | null
  /** unidades vendidas por día activo (promedio del período) */
  avg_daily_sales: number
  /** venta esperada hoy según el día de semana */
  expected_today: number
  /** ya en órdenes de producción abiertas (draft/pending_review/in_progress) */
  pending_production: number
  suggested_qty: number
  reason: string
}

export type ProductionPlan = {
  generatedAt: string
  today: string
  items: ProductionPlanItem[]
  sellingWithoutStock: { name: string; avg_daily_sales: number; current_qty: number }[]
  analysis: string
  model: string | null
}

export async function buildProductionPlan(admin: SupabaseClient): Promise<ProductionPlan> {
  // --- 1) Ventas: mes actual + anterior para tener velocidad estable ---
  const now = new Date()
  const [current, previous] = await Promise.all([
    fetchMonthSales(format(now, 'yyyy-MM')),
    fetchMonthSales(format(subMonths(now, 1), 'yyyy-MM')),
  ])
  const sales: MonthSale[] = [...previous.sales, ...current.sales].filter(s => s.state === 'CLOSED')

  // Días activos totales y por día de semana
  const activeDates = new Set<string>()
  const dowDates: Array<Set<string>> = Array.from({ length: 7 }, () => new Set<string>())
  for (const s of sales) {
    activeDates.add(s.argDate)
    dowDates[s.argDow].add(s.argDate)
  }
  const activeDays = Math.max(activeDates.size, 1)

  // Unidades vendidas por producto: total y del día de semana de hoy
  const todayDow = new Date(
    new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10) + 'T12:00:00',
  ).getDay()
  const todayDowDays = Math.max(dowDates[todayDow].size, 1)

  const soldTotal = new Map<string, number>()
  const soldTodayDow = new Map<string, number>()
  for (const s of sales) {
    for (const item of s.items) {
      if (!item.productId) continue
      soldTotal.set(item.productId, (soldTotal.get(item.productId) ?? 0) + item.qty)
      if (s.argDow === todayDow) {
        soldTodayDow.set(item.productId, (soldTodayDow.get(item.productId) ?? 0) + item.qty)
      }
    }
  }

  // --- 2) Stock actual de los producibles ---
  const { data: stockItems } = await admin
    .from('stock_items')
    .select('id, name, unit, category, current_qty, shelf_life_days, fudo_product_id')
    .eq('is_active', true)
    .not('fudo_product_id', 'is', null)
    .in('category', PRODUCIBLE_CATEGORIES)

  // --- 3) Producción ya en curso (no sugerir lo que ya se está haciendo) ---
  const { data: openOrders } = await admin
    .from('production_orders')
    .select('id, status, production_outputs(stock_item_id, qty_produced, is_waste)')
    .in('status', ['draft', 'pending_review', 'in_progress'])

  const pendingByItem = new Map<string, number>()
  for (const order of (openOrders ?? []) as unknown as { production_outputs: { stock_item_id: string | null; qty_produced: number; is_waste: boolean }[] }[]) {
    for (const output of order.production_outputs ?? []) {
      if (!output.stock_item_id || output.is_waste) continue
      pendingByItem.set(output.stock_item_id, (pendingByItem.get(output.stock_item_id) ?? 0) + Number(output.qty_produced))
    }
  }

  // --- 4) Sugerencia por item ---
  const items: ProductionPlanItem[] = []
  const sellingWithoutStock: ProductionPlan['sellingWithoutStock'] = []

  for (const row of (stockItems ?? []) as unknown as {
    id: string; name: string; unit: string; category: string; current_qty: number
    shelf_life_days: number | null; fudo_product_id: string
  }[]) {
    const total = soldTotal.get(row.fudo_product_id) ?? 0
    if (total === 0) continue // nunca se vendió en ~2 meses: no sugerimos producirlo

    const avgDaily = total / activeDays
    const dowQty = soldTodayDow.get(row.fudo_product_id) ?? 0
    const expectedToday = dowQty > 0 ? dowQty / todayDowDays : avgDaily

    const currentQty = Math.max(Number(row.current_qty), 0) // negativo digital = físicamente no hay
    const pending = pendingByItem.get(row.id) ?? 0

    // Cobertura objetivo: hoy con 20% de margen; si la vida útil da (≥3 días),
    // producir también para mañana (mismo esperado como aproximación).
    const coverTomorrow = (row.shelf_life_days ?? 0) >= 3
    const target = expectedToday * 1.2 + (coverTomorrow ? expectedToday : 0)
    const suggested = Math.max(0, Math.ceil(target - currentQty - pending))

    if (Number(row.current_qty) <= 0 && avgDaily >= 0.5) {
      sellingWithoutStock.push({ name: row.name, avg_daily_sales: Math.round(avgDaily * 10) / 10, current_qty: Number(row.current_qty) })
    }

    if (suggested <= 0) continue

    const reasons: string[] = [`vendés ~${Math.round(expectedToday * 10) / 10}/día los ${DOW_LABELS[todayDow]}`]
    if (currentQty > 0) reasons.push(`hay ${currentQty} ${row.unit}`)
    else reasons.push('sin stock')
    if (pending > 0) reasons.push(`${pending} ya en producción`)
    if (coverTomorrow) reasons.push('cubre hoy y mañana')

    items.push({
      stock_item_id: row.id,
      name: row.name,
      unit: row.unit,
      category: row.category,
      current_qty: Number(row.current_qty),
      shelf_life_days: row.shelf_life_days,
      avg_daily_sales: Math.round(avgDaily * 10) / 10,
      expected_today: Math.round(expectedToday * 10) / 10,
      pending_production: pending,
      suggested_qty: suggested,
      reason: reasons.join(' · '),
    })
  }

  items.sort((a, b) => b.suggested_qty * Math.max(b.avg_daily_sales, 0.1) - a.suggested_qty * Math.max(a.avg_daily_sales, 0.1))

  const { analysis, model } = await generatePlanText(items, sellingWithoutStock, todayDow)

  return {
    generatedAt: new Date().toISOString(),
    today: DOW_LABELS[todayDow],
    items: items.slice(0, 15),
    sellingWithoutStock: sellingWithoutStock.slice(0, 10),
    analysis,
    model,
  }
}

// ---------------------------------------------------------------------------
// Narrativa IA con fallback
// ---------------------------------------------------------------------------

async function generatePlanText(
  items: ProductionPlanItem[],
  sellingWithoutStock: ProductionPlan['sellingWithoutStock'],
  todayDow: number,
): Promise<{ analysis: string; model: string | null }> {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
  const fallback = () => {
    if (items.length === 0) {
      return 'No hay producción sugerida para hoy: el stock cubre la venta esperada. Revisá igualmente los items sin stock digital si cocina reporta faltantes.'
    }
    const top = items.slice(0, 5).map(i => `- ${i.name}: producir ${i.suggested_qty} ${i.unit} (${i.reason})`)
    const alerts = sellingWithoutStock.length > 0
      ? `\nAtención: ${sellingWithoutStock.map(s => s.name).join(', ')} registran ventas pero no tienen stock digital — contá lo físico y corregí.`
      : ''
    return `Prioridades de producción para hoy ${DOW_LABELS[todayDow]}:\n${top.join('\n')}${alerts}`
  }

  if (!OPENROUTER_KEY || items.length === 0) {
    return { analysis: fallback(), model: null }
  }

  const lines = [
    `HOY ES: ${DOW_LABELS[todayDow]}`,
    '',
    'SUGERENCIAS CALCULADAS (venta esperada según histórico del día de semana, stock actual, producción en curso, vida útil):',
    ...items.map(i => `- ${i.name} [${i.category}]: sugerido ${i.suggested_qty} ${i.unit} | stock ${i.current_qty} | venta esperada hoy ${i.expected_today} | en producción ${i.pending_production} | vida útil ${i.shelf_life_days ?? 's/d'} días`),
    '',
    sellingWithoutStock.length > 0
      ? `VENDIENDO SIN STOCK DIGITAL (posible faltante físico o conteo pendiente): ${sellingWithoutStock.map(s => `${s.name} (~${s.avg_daily_sales}/día, stock ${s.current_qty})`).join('; ')}`
      : 'Sin items vendiendo en negativo.',
  ]

  const systemPrompt = `Sos el jefe de producción de La Vieja Escuela, bar/café con pastelería propia en Tucumán, Argentina.
Te paso el plan de producción calculado para hoy. Escribí un mensaje corto para el chef y el encargado:
1) Las 3-5 prioridades de producción de hoy con cantidades concretas y el porqué en una línea.
2) Si hay items vendiendo sin stock digital, marcalo como URGENTE: hay que contar lo físico primero.
3) Cerrá con una observación útil si la ves (ej. algo con vida útil corta que conviene producir en dos tandas).
Formato: texto plano con guiones. Sin markdown ni emojis. Máximo 150 palabras. Español argentino, directo.`

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: lines.join('\n') },
        ],
      }),
    })

    if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
    const json = await res.json()
    const text = json.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('Empty response')
    return { analysis: text, model: json.model ?? 'anthropic/claude-sonnet-4' }
  } catch {
    return { analysis: fallback(), model: null }
  }
}
