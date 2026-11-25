import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Leche contra cafés con leche — entre un conteo y el siguiente
// ---------------------------------------------------------------------------
// El barista cuenta toda la leche (barra y depósito, en litros) en el
// "Control de leche" de la noche. Entre dos conteos:
//   usada  = lo que había + lo que entró (compras cargadas) − lo que quedó
//   piden  = cada plato vendido en Fudo cuya receta lleva esa leche × los
//            litros de la receta
// La diferencia es leche que salió sin venta (espuma tirada, invitaciones,
// personal, o algo sin explicar) o, si es negativa, recetas que piden de más
// o una compra que no se cargó.
//
// 25/11/2026: el stock que calculaba la app estaba muy lejos de lo real (al
// contar el 18/11: descremada 72 l en el sistema y 20 en la heladera) y nadie
// contaba la leche: no había cómo saber cuánta se perdía.
// ---------------------------------------------------------------------------

export type IntervaloLeche = {
  desde: string
  hasta: string
  /** Litros contados al empezar y al terminar */
  inicial: number
  final: number
  /** Compras que entraron en el medio (litros) */
  ingresos: number
  usada: number
  /** Lo que piden las ventas según las recetas (litros) */
  piden: number
  /** Platos con esta leche vendidos en el medio */
  vendidos: number
  diferencia: number
}

export type Leche = {
  id: string
  nombre: string
  ultimoConteo: { at: string; litros: number } | null
  /** Desde el último conteo: lo que piden las ventas y lo que entró */
  desdeUltimo: { piden: number; ingresos: number }
  intervalos: IntervaloLeche[]
  /** Días (hasta ayer) en que no se contó */
  diasSinContar: string[]
}

export type ControlLeche = { desde: string; leches: Leche[] }

/** Diferencia que llama la atención: más de 15 % de lo que piden y más de 1 litro */
export const UMBRAL_PCT = 0.15
export const UMBRAL_MIN_L = 1
export const lecheFuera = (i: Pick<IntervaloLeche, 'diferencia' | 'piden'>) => Math.abs(i.diferencia) > Math.max(UMBRAL_MIN_L, i.piden * UMBRAL_PCT)

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
/** Las leches que se cuentan en el control: de barra, en litros, "Leche…" */
export const esLecheDeBarra = (i: { name: string; unit: string; area: string | null; is_active?: boolean | null }) =>
  i.is_active !== false && i.area === 'barra' && i.unit === 'l' && /^leche\b/.test(sinTildes(i.name)) && !sinTildes(i.name).includes('polvo')

const AR_MS = 3 * 3_600_000
const fechaAR = (iso: string) => new Date(Date.parse(iso) - AR_MS).toISOString().slice(0, 10)
const hoyAR = () => fechaAR(new Date().toISOString())
const sumarDias = (fecha: string, d: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)
const r2 = (n: number) => Math.round(n * 100) / 100

/** Litros de la receta según la unidad cargada */
function litros(q: number, unidad: string | null): number {
  const u = (unidad ?? 'l').toLowerCase()
  return u === 'ml' || u === 'g' || u === 'cc' ? q / 1000 : q
}

async function todas<T>(armar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const filas: T[] = []
  for (let d = 0; d < 50_000; d += 1000) {
    const { data, error } = await armar(d, d + 999)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return filas
}

export async function cruceLeche(db: SupabaseClient, dias = 14): Promise<ControlLeche> {
  const hoy = hoyAR()
  const desde = sumarDias(hoy, -(Math.max(1, dias) - 1))
  // Un conteo anterior al período sirve de punto de partida
  const desdeLogs = new Date(Date.parse(`${sumarDias(desde, -14)}T03:00:00Z`)).toISOString()

  const { data: items } = await db.from('stock_items').select('id, name, unit, area, is_active').eq('area', 'barra').eq('unit', 'l').eq('is_active', true)
  const leches = ((items ?? []) as { id: string; name: string; unit: string; area: string | null; is_active: boolean }[]).filter(esLecheDeBarra)
  if (!leches.length) return { desde, leches: [] }
  const ids = leches.map((l) => l.id)

  // Recetas → productos de Fudo → litros por plato, por leche
  const { data: ris } = await db.from('recipe_ingredients').select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit').in('stock_item_id', ids)
  const porReceta = new Map<number, Map<string, number>>()
  for (const r of (ris ?? []) as { recipe_id: number; stock_item_id: string; qty_per_portion: number | null; ingredient_unit: string | null }[]) {
    const l = litros(Number(r.qty_per_portion ?? 0), r.ingredient_unit)
    if (!(l > 0 && l < 3)) continue
    const m = porReceta.get(r.recipe_id) ?? new Map<string, number>()
    m.set(r.stock_item_id, (m.get(r.stock_item_id) ?? 0) + l)
    porReceta.set(r.recipe_id, m)
  }
  const porProducto = new Map<string, Map<string, number>>() // producto → leche → litros
  if (porReceta.size) {
    const { data: mis } = await db.from('menu_items').select('fudo_product_id, recipe_id').in('recipe_id', [...porReceta.keys()]).not('fudo_product_id', 'is', null)
    for (const m of (mis ?? []) as { fudo_product_id: string; recipe_id: number }[]) porProducto.set(String(m.fudo_product_id), porReceta.get(m.recipe_id)!)
  }

  const [logs, ventas] = await Promise.all([
    todas<{ stock_item_id: string; action: string; old_qty: number | null; new_qty: number | null; created_at: string }>((a, b) =>
      db.from('stock_logs').select('stock_item_id, action, old_qty, new_qty, created_at')
        .in('stock_item_id', ids).in('action', ['physical_count', 'receipt', 'reception']).gte('created_at', desdeLogs)
        .order('created_at', { ascending: true }).range(a, b)),
    porProducto.size
      ? todas<{ fudo_product_id: string; quantity: number | null; sold_at: string }>((a, b) =>
        db.from('fudo_consumo').select('fudo_product_id, quantity, sold_at')
          .in('fudo_product_id', [...porProducto.keys()]).gte('sold_at', desdeLogs)
          .order('sold_at', { ascending: true }).range(a, b))
      : Promise.resolve([]),
  ])

  const ahora = new Date().toISOString()
  const ms = (iso: string) => Date.parse(iso)
  const ventasMs = ventas.map((v) => ({ ...v, t: ms(v.sold_at) }))
  const resultado: Leche[] = leches.map((leche) => {
    const mios = logs.filter((l) => l.stock_item_id === leche.id)
    // Conteos: si hay dos en menos de 3 horas (una corrección), vale el último
    const conteos: { at: string; litros: number }[] = []
    for (const c of mios.filter((l) => l.action === 'physical_count' && l.new_qty != null)) {
      const ult = conteos[conteos.length - 1]
      const c2 = { at: c.created_at, litros: Number(c.new_qty) }
      if (ult && Date.parse(c.created_at) - Date.parse(ult.at) < 3 * 3_600_000) conteos[conteos.length - 1] = c2
      else conteos.push(c2)
    }
    const ingresos = mios
      .filter((l) => l.action !== 'physical_count' && l.new_qty != null && l.old_qty != null && Number(l.new_qty) > Number(l.old_qty))
      .map((l) => ({ at: l.created_at, t: ms(l.created_at), litros: Number(l.new_qty) - Number(l.old_qty) }))
    const pedido = (a: string, b: string) => {
      let piden = 0, vendidos = 0
      const ta = ms(a), tb = ms(b)
      for (const v of ventasMs) {
        if (v.t <= ta || v.t > tb) continue
        const l = porProducto.get(String(v.fudo_product_id))?.get(leche.id)
        if (!l) continue
        const q = Number(v.quantity ?? 1)
        piden += q * l
        vendidos += q
      }
      return { piden, vendidos }
    }
    const entro = (a: string, b: string) => { const ta = ms(a), tb = ms(b); return ingresos.filter((i) => i.t > ta && i.t <= tb).reduce((s, i) => s + i.litros, 0) }

    const intervalos: IntervaloLeche[] = []
    for (let k = 1; k < conteos.length; k++) {
      const a = conteos[k - 1], b = conteos[k]
      if (fechaAR(b.at) < desde) continue
      const { piden, vendidos } = pedido(a.at, b.at)
      const ing = entro(a.at, b.at)
      const usada = a.litros + ing - b.litros
      intervalos.push({
        desde: a.at, hasta: b.at, inicial: r2(a.litros), final: r2(b.litros), ingresos: r2(ing),
        usada: r2(usada), piden: r2(piden), vendidos: Math.round(vendidos), diferencia: r2(usada - piden),
      })
    }
    const ultimo = conteos[conteos.length - 1] ?? null
    const contados = new Set(conteos.map((c) => fechaAR(c.at)))
    const diasSinContar: string[] = []
    for (let f = desde; f < hoy; f = sumarDias(f, 1)) if (!contados.has(f)) diasSinContar.push(f)
    const desdeUlt = ultimo ? pedido(ultimo.at, ahora) : { piden: 0 }
    return {
      id: leche.id,
      nombre: leche.name,
      ultimoConteo: ultimo ? { at: ultimo.at, litros: r2(ultimo.litros) } : null,
      desdeUltimo: { piden: r2(desdeUlt.piden), ingresos: r2(ultimo ? entro(ultimo.at, ahora) : 0) },
      intervalos,
      diasSinContar,
    }
  })
  // La que más se usa primero
  resultado.sort((a, b) => b.intervalos.reduce((s, i) => s + i.piden, 0) + b.desdeUltimo.piden - (a.intervalos.reduce((s, i) => s + i.piden, 0) + a.desdeUltimo.piden))
  return { desde, leches: resultado }
}
