// ---------------------------------------------------------------------------
// Reporte de mermas con costo — la plata que se va sin que nadie la vea.
// Cruza tres fuentes:
//  1) Snapshots diarios + ventas: stock_ayer − ventas_del_día − stock_hoy
//     → diferencia sin explicar = merma estimada (o entrada sin registrar si
//     el stock subió más de lo esperado).
//  2) Lotes vencidos con resto (stock_lots).
//  3) Desperdicio declarado en producción (production_outputs.is_waste).
// Todo valorizado a cost_per_unit.
// ---------------------------------------------------------------------------

import { SupabaseClient } from '@supabase/supabase-js'

type SnapshotItem = {
  id: string
  name: string
  unit: string | null
  category: string | null
  current_qty: number
  cost_per_unit: number | null
  fudo_product_id: string | null
  fudo_ingredient_id: string | null
}

export type WasteLine = {
  name: string
  unit: string | null
  qty: number
  value: number | null
  detail: string
}

export type WasteReport = {
  generatedAt: string
  windowDays: number
  daysWithData: number
  shrinkage: { lines: WasteLine[]; totalValue: number }
  unexplainedGains: { lines: WasteLine[]; totalValue: number }
  expiredLots: { lines: WasteLine[]; totalValue: number }
  productionWaste: { lines: WasteLine[]; totalValue: number }
  totalValue: number
  analysis: string
  model: string | null
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`

export async function buildWasteReport(admin: SupabaseClient, windowDays = 7): Promise<WasteReport> {
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - windowDays - 1)
  const sinceStr = sinceDate.toISOString().slice(0, 10)

  // --- 1) Snapshots diarios de la ventana ---
  const { data: snapshots } = await admin
    .from('stock_snapshots')
    .select('snapshot_date, items')
    .eq('snapshot_type', 'daily')
    .gte('snapshot_date', sinceStr)
    .order('snapshot_date', { ascending: true })

  const snaps = (snapshots ?? []) as unknown as { snapshot_date: string; items: SnapshotItem[] }[]

  // --- Ventas por producto por fecha argentina (paginado: >1000 filas/semana) ---
  const salesRows: { fudo_product_id: string; quantity: number; sold_at: string }[] = []
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data: batch } = await admin
      .from('fudo_sales')
      .select('fudo_product_id, quantity, sold_at')
      .gte('sold_at', sinceStr)
      .order('sold_at', { ascending: true })
      .range(offset, offset + 999)
    if (!batch || batch.length === 0) break
    salesRows.push(...(batch as typeof salesRows))
    if (batch.length < 1000) break
  }

  const soldByProductDate = new Map<string, number>() // `${productId}|${argDate}` → qty
  for (const row of salesRows) {
    const argDate = new Date(row.sold_at).toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
    const key = `${row.fudo_product_id}|${argDate}`
    soldByProductDate.set(key, (soldByProductDate.get(key) ?? 0) + Number(row.quantity))
  }

  // --- Diferencias día a día ---
  // El snapshot de la fecha D se toma a las 03:00 AR → refleja el cierre de D-1.
  // Entre snapshot(D) y snapshot(D+1) pasan las ventas del día D.
  const shrinkMap = new Map<string, WasteLine>()
  const gainMap = new Map<string, WasteLine>()

  for (let i = 0; i + 1 < snaps.length; i++) {
    const day = snaps[i].snapshot_date // ventas de este día explican el cambio
    const before = new Map(snaps[i].items.map(it => [it.id, it]))
    const after = new Map(snaps[i + 1].items.map(it => [it.id, it]))

    for (const [id, b] of before) {
      const a = after.get(id)
      if (!a || !b.fudo_product_id) continue // solo items espejados por producto (venta directa)

      const sold = soldByProductDate.get(`${b.fudo_product_id}|${day}`) ?? 0
      const actualChange = Number(a.current_qty) - Number(b.current_qty)
      const unexplained = actualChange + sold // esperado: -sold → unexplained = actual - (-sold)

      if (Math.abs(unexplained) < 0.5) continue // ruido de redondeo

      const cost = a.cost_per_unit ?? b.cost_per_unit
      if (unexplained < 0) {
        const qty = -unexplained
        const prev = shrinkMap.get(id) ?? { name: b.name, unit: b.unit, qty: 0, value: cost != null ? 0 : null, detail: '' }
        prev.qty += qty
        if (prev.value !== null && cost != null) prev.value += qty * cost
        prev.detail = `faltante sin explicar (stock bajó más que las ventas)`
        shrinkMap.set(id, prev)
      } else {
        // subió más de lo esperado: entrada (compra/producción) sin registrar — no es merma,
        // pero es el mismo agujero de trazabilidad, se reporta aparte
        const prev = gainMap.get(id) ?? { name: b.name, unit: b.unit, qty: 0, value: cost != null ? 0 : null, detail: '' }
        prev.qty += unexplained
        if (prev.value !== null && cost != null) prev.value += unexplained * cost
        prev.detail = 'entrada sin registrar (stock subió sin carga)'
        gainMap.set(id, prev)
      }
    }
  }

  // --- 2) Lotes vencidos con resto ---
  const { data: lots } = await admin
    .from('stock_lots')
    .select('lot_code, qty_remaining, unit, expires_at, stock_items(name, cost_per_unit)')
    .gt('qty_remaining', 0)
    .lte('expires_at', new Date().toISOString())

  const expiredLines: WasteLine[] = ((lots ?? []) as unknown as {
    lot_code: string | null; qty_remaining: number; unit: string | null; expires_at: string
    stock_items: { name: string; cost_per_unit: number | null } | null
  }[]).map(l => ({
    name: l.stock_items?.name ?? l.lot_code ?? 'Lote',
    unit: l.unit,
    qty: Number(l.qty_remaining),
    value: l.stock_items?.cost_per_unit != null ? Number(l.qty_remaining) * l.stock_items.cost_per_unit : null,
    detail: `lote ${l.lot_code ?? 's/c'} vencido el ${l.expires_at.slice(0, 10)}`,
  }))

  // --- 3) Desperdicio declarado en producción ---
  const { data: wasteOutputs } = await admin
    .from('production_outputs')
    .select('output_name, qty_produced, unit, created_at, stock_items(name, cost_per_unit)')
    .eq('is_waste', true)
    .gte('created_at', sinceStr)

  const prodLines: WasteLine[] = ((wasteOutputs ?? []) as unknown as {
    output_name: string; qty_produced: number; unit: string | null
    stock_items: { name: string; cost_per_unit: number | null } | null
  }[]).map(o => ({
    name: o.output_name || o.stock_items?.name || 'Merma de producción',
    unit: o.unit,
    qty: Number(o.qty_produced),
    value: o.stock_items?.cost_per_unit != null ? Number(o.qty_produced) * o.stock_items.cost_per_unit : null,
    detail: 'declarado como merma en una orden de producción',
  }))

  const sum = (lines: WasteLine[]) => lines.reduce((s, l) => s + (l.value ?? 0), 0)
  const shrinkLines = Array.from(shrinkMap.values()).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const gainLines = Array.from(gainMap.values()).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

  const report: WasteReport = {
    generatedAt: new Date().toISOString(),
    windowDays,
    daysWithData: Math.max(snaps.length - 1, 0),
    shrinkage: { lines: shrinkLines.slice(0, 20), totalValue: sum(shrinkLines) },
    unexplainedGains: { lines: gainLines.slice(0, 10), totalValue: sum(gainLines) },
    expiredLots: { lines: expiredLines.slice(0, 20), totalValue: sum(expiredLines) },
    productionWaste: { lines: prodLines.slice(0, 20), totalValue: sum(prodLines) },
    totalValue: sum(shrinkLines) + sum(expiredLines) + sum(prodLines),
    analysis: '',
    model: null,
  }

  const { analysis, model } = await generateWasteText(report)
  report.analysis = analysis
  report.model = model
  return report
}

// ---------------------------------------------------------------------------
// Narrativa IA con fallback
// ---------------------------------------------------------------------------

async function generateWasteText(r: WasteReport): Promise<{ analysis: string; model: string | null }> {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY

  const fallback = () => {
    if (r.daysWithData === 0 && r.expiredLots.lines.length === 0 && r.productionWaste.lines.length === 0) {
      return 'Todavía no hay días completos de datos: los snapshots diarios empezaron a acumularse hoy. Desde mañana este reporte compara stock vs ventas día a día. Los lotes vencidos y mermas de producción aparecen apenas se registren.'
    }
    const parts = [`Merma estimada de los últimos ${r.windowDays} días (${r.daysWithData} días con datos): ${fmt(r.totalValue)}.`]
    if (r.shrinkage.lines.length > 0) parts.push(`Faltantes sin explicar: ${r.shrinkage.lines.slice(0, 5).map(l => `${l.name} (${Math.round(l.qty * 10) / 10} ${l.unit ?? ''}${l.value != null ? `, ${fmt(l.value)}` : ''})`).join('; ')}`)
    if (r.expiredLots.lines.length > 0) parts.push(`Lotes vencidos con resto: ${r.expiredLots.lines.length} (${fmt(r.expiredLots.totalValue)}).`)
    if (r.productionWaste.lines.length > 0) parts.push(`Merma declarada en producción: ${fmt(r.productionWaste.totalValue)}.`)
    if (r.unexplainedGains.lines.length > 0) parts.push(`Además hay entradas sin registrar (stock que subió sin carga): revisar compras/producción no cargadas.`)
    return parts.join('\n')
  }

  if (!OPENROUTER_KEY) return { analysis: fallback(), model: null }

  const lines = [
    `VENTANA: últimos ${r.windowDays} días — ${r.daysWithData} días con snapshot comparable`,
    '',
    `FALTANTES SIN EXPLICAR (stock bajó más que las ventas) — total ${fmt(r.shrinkage.totalValue)}:`,
    ...r.shrinkage.lines.slice(0, 12).map(l => `- ${l.name}: ${Math.round(l.qty * 10) / 10} ${l.unit ?? 'u'} ${l.value != null ? `≈ ${fmt(l.value)}` : '(sin costo cargado)'}`),
    '',
    `ENTRADAS SIN REGISTRAR (stock subió sin carga) — total ${fmt(r.unexplainedGains.totalValue)}:`,
    ...r.unexplainedGains.lines.slice(0, 8).map(l => `- ${l.name}: +${Math.round(l.qty * 10) / 10} ${l.unit ?? 'u'}`),
    '',
    `LOTES VENCIDOS CON RESTO — total ${fmt(r.expiredLots.totalValue)}:`,
    ...r.expiredLots.lines.slice(0, 8).map(l => `- ${l.name}: ${l.qty} ${l.unit ?? 'u'} (${l.detail})`),
    '',
    `MERMA DECLARADA EN PRODUCCIÓN — total ${fmt(r.productionWaste.totalValue)}:`,
    ...r.productionWaste.lines.slice(0, 8).map(l => `- ${l.name}: ${l.qty} ${l.unit ?? 'u'}`),
  ]

  const systemPrompt = `Sos el auditor de costos de La Vieja Escuela, bar/café en Tucumán, Argentina.
Te paso el reporte de mermas de la semana. Escribí un análisis corto para el dueño:
1) El número total que se está yendo y dónde está concentrado (productos concretos).
2) Distinguí merma real (faltantes, vencidos) de problemas de registro (entradas sin cargar):
   lo segundo no es plata perdida pero rompe la trazabilidad.
3) 2-4 acciones concretas para esta semana (ajustar producción de X, revisar por qué falta Y,
   cargar las compras de Z al sistema).
Si hay pocos días con datos, aclaralo sin alarmar: el sistema está empezando a medir.
Formato: texto plano con guiones. Sin markdown ni emojis. Máximo 180 palabras. Español argentino.`

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
        max_tokens: 500,
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
