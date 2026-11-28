import type { SupabaseClient } from '@supabase/supabase-js'
import type { MermaCafe } from './merma'

// ---------------------------------------------------------------------------
// Tolva contra café vendido — por día y turno (TM hasta las 16, TT después)
// ---------------------------------------------------------------------------
// Café usado según la tolva = inicio + agregado − final.
// Café que piden las ventas = por cada plato vendido en Fudo que lleva café
// en la receta, los gramos de esa receta. Los platos salen de los insumos de
// café de stock (nombre "Cafe" o "Café…", en kg o g) → recetas → platos con
// producto de Fudo. Sin recetas vinculadas, por nombre del plato y 17 g.
//
// 25/11/2026: antes buscaba "%café%" con tilde y solo activos; el insumo que
// se usa se llama "Cafe" y el de tilde está dado de baja, así que contaba por
// nombre: dejaba afuera Americano, Capuccino, los Ice… (más o menos la mitad
// de los cafés) y calculaba 17 g cuando las recetas dicen 20-21 g.
// ---------------------------------------------------------------------------

export type Turno = 'TM' | 'TT'

export type EstadoTurnoCafe =
  | 'ok'
  /** El consumo da negativo: cargaron café y no lo anotaron */
  | 'falta_agregado'
  /** Falta el inicio o el final */
  | 'sin_cerrar'
  /** Hubo ventas de café y no hay registro de tolva */
  | 'sin_registro'

export type TurnoCafe = {
  fecha: string
  turno: Turno
  inicio: number | null
  agregado: number
  fin: number | null
  /** Café usado según la tolva (g); null si falta inicio o final */
  real: number | null
  /** Cafés vendidos en el turno (unidades) */
  cafes: number
  /** Café que piden las ventas según las recetas (g) */
  esperado: number
  /** real − esperado (g); solo si el turno está completo y cierra */
  diferencia: number | null
  estado: EstadoTurnoCafe
}

export type ControlCafe = {
  desde: string
  turnos: TurnoCafe[]
  /** Promedio de gramos por café vendido (según las recetas) */
  gr_por_cafe: number
  /** Productos de Fudo que se cuentan como café */
  productos: number
  /** true si no hay recetas con café: se cuenta por nombre del plato */
  por_nombre: boolean
  /** Merma por día y semana, de pesaje a pesaje (lib/tolva/merma); la agrega /api/operaciones/cafe */
  merma?: MermaCafe | null
}

const GR_POR_CAFE_DEFAULT = 17
/** Diferencia de balanza que no cuenta como consumo negativo */
const TOLERANCIA_GR = 15
/** Diferencia que llama la atención: más de 15 % de lo esperado y más de 60 g */
export const UMBRAL_PCT = 0.15
export const UMBRAL_MIN_GR = 60
export const fueraDeRango = (t: Pick<TurnoCafe, 'diferencia' | 'esperado'>) =>
  t.diferencia != null && Math.abs(t.diferencia) > Math.max(UMBRAL_MIN_GR, t.esperado * UMBRAL_PCT)

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** Insumo de café en grano o molido (no descafeinado, no "cafetera") */
const esInsumoCafe = (nombre: string, unidad: string) =>
  ['kg', 'g'].includes(unidad) && /^cafe(\s|$)/.test(sinTildes(nombre).trim()) && !sinTildes(nombre).includes('descaf')
/** Respaldo por nombre del plato */
const NOMBRES_CAFE = /\b(cafe|espresso|cortado|latte|capp?uccino|americano|flat white|piccolo|lungo|mocc?a|moka|aerocano|ice black|ice flat)\b/
const NO_ES_CAFE = /\b(pack|1\/4|1\/2|kg|bolsa|descaf)/

const AR_MS = 3 * 3_600_000 // Argentina, UTC−3 sin horario de verano
export const hoyAR = () => new Date(Date.now() - AR_MS).toISOString().slice(0, 10)
const sumarDias = (fecha: string, d: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)

/** Día operativo y turno de una venta: de 0 a 6 h es la noche del día anterior */
function turnoDe(iso: string): { fecha: string; turno: Turno } {
  const ar = new Date(Date.parse(iso) - AR_MS)
  const h = ar.getUTCHours()
  const fecha = ar.toISOString().slice(0, 10)
  if (h < 6) return { fecha: sumarDias(fecha, -1), turno: 'TT' }
  return { fecha, turno: h < 16 ? 'TM' : 'TT' }
}

/** Gramos de café por producto de Fudo */
export async function productosCafe(db: SupabaseClient): Promise<{ gramos: Map<string, number>; porNombre: boolean }> {
  const gramos = new Map<string, number>()
  const { data: insumos } = await db.from('stock_items').select('id, name, unit').ilike('name', 'caf%')
  const cafe = ((insumos ?? []) as { id: string; name: string; unit: string }[]).filter((i) => esInsumoCafe(i.name, i.unit))
  if (cafe.length) {
    const unidad = new Map(cafe.map((c) => [c.id, c.unit]))
    const { data: ris } = await db.from('recipe_ingredients')
      .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
      .in('stock_item_id', cafe.map((c) => c.id))
    const porReceta = new Map<number, number>()
    for (const r of (ris ?? []) as { recipe_id: number; stock_item_id: string; qty_per_portion: number | null; ingredient_unit: string | null }[]) {
      const q = Number(r.qty_per_portion ?? 0)
      const u = r.ingredient_unit ?? unidad.get(r.stock_item_id) ?? 'kg'
      const g = u === 'g' ? q : q * 1000
      if (g > 0 && g < 500) porReceta.set(r.recipe_id, (porReceta.get(r.recipe_id) ?? 0) + g)
    }
    if (porReceta.size) {
      const { data: mis } = await db.from('menu_items').select('fudo_product_id, recipe_id').in('recipe_id', [...porReceta.keys()]).not('fudo_product_id', 'is', null)
      for (const m of (mis ?? []) as { fudo_product_id: string; recipe_id: number }[]) {
        gramos.set(String(m.fudo_product_id), porReceta.get(m.recipe_id) ?? GR_POR_CAFE_DEFAULT)
      }
    }
  }
  if (gramos.size) return { gramos, porNombre: false }

  const { data: todos } = await db.from('menu_items').select('fudo_product_id, name').not('fudo_product_id', 'is', null)
  for (const m of (todos ?? []) as { fudo_product_id: string; name: string }[]) {
    const n = sinTildes(m.name)
    if (NOMBRES_CAFE.test(n) && !NO_ES_CAFE.test(n)) gramos.set(String(m.fudo_product_id), GR_POR_CAFE_DEFAULT)
  }
  return { gramos, porNombre: true }
}

/** Ventas de esos productos desde una fecha, todas (de a 1000 filas) */
export async function ventasCafe(db: SupabaseClient, ids: string[], desdeIso: string) {
  const filas: { fudo_product_id: string; quantity: number | null; sold_at: string }[] = []
  for (let desde = 0; desde < 50_000; desde += 1000) {
    const { data, error } = await db.from('fudo_consumo')
      .select('fudo_product_id, quantity, sold_at')
      .in('fudo_product_id', ids)
      .gte('sold_at', desdeIso)
      .order('sold_at', { ascending: true })
      .range(desde, desde + 999)
    if (error) throw new Error(error.message)
    filas.push(...((data ?? []) as typeof filas))
    if (!data || data.length < 1000) break
  }
  return filas
}

/** Los últimos `dias` días (hoy incluido), turno por turno */
export async function cruceTolva(db: SupabaseClient, dias: number): Promise<ControlCafe> {
  const hoy = hoyAR()
  const desde = sumarDias(hoy, -(Math.max(1, dias) - 1))

  const [{ data: logs }, prod] = await Promise.all([
    db.from('tolva_logs').select('log_date, shift, start_gr, added_gr, end_gr').gte('log_date', desde),
    productosCafe(db),
  ])
  const tolva = new Map<string, { start_gr: number | null; added_gr: number | null; end_gr: number | null }>()
  for (const l of (logs ?? []) as { log_date: string; shift: Turno; start_gr: number | null; added_gr: number | null; end_gr: number | null }[]) {
    tolva.set(`${l.log_date}:${l.shift}`, l)
  }

  const cafes = new Map<string, number>()
  const esperado = new Map<string, number>()
  if (prod.gramos.size) {
    // Desde las 6 de la mañana (hora AR) del primer día
    for (const v of await ventasCafe(db, [...prod.gramos.keys()], `${desde}T09:00:00Z`)) {
      const { fecha, turno } = turnoDe(v.sold_at)
      if (fecha < desde) continue
      const k = `${fecha}:${turno}`
      const q = Number(v.quantity ?? 1)
      cafes.set(k, (cafes.get(k) ?? 0) + q)
      esperado.set(k, (esperado.get(k) ?? 0) + q * (prod.gramos.get(String(v.fudo_product_id)) ?? GR_POR_CAFE_DEFAULT))
    }
  }

  const turnos: TurnoCafe[] = []
  for (let f = desde; f <= hoy; f = sumarDias(f, 1)) {
    for (const turno of ['TM', 'TT'] as Turno[]) {
      const k = `${f}:${turno}`
      const l = tolva.get(k)
      const nCafes = Math.round(cafes.get(k) ?? 0)
      const esp = Math.round(esperado.get(k) ?? 0)
      if (!l && nCafes === 0) continue
      const inicio = l?.start_gr != null ? Number(l.start_gr) : null
      const agregado = Number(l?.added_gr ?? 0)
      const fin = l?.end_gr != null ? Number(l.end_gr) : null
      const real = inicio != null && fin != null ? Math.round(inicio + agregado - fin) : null
      const estado: EstadoTurnoCafe = !l ? 'sin_registro' : real == null ? 'sin_cerrar' : real < -TOLERANCIA_GR ? 'falta_agregado' : 'ok'
      turnos.push({
        fecha: f, turno, inicio, agregado, fin, real, cafes: nCafes, esperado: esp,
        diferencia: estado === 'ok' && nCafes > 0 ? Math.round(Math.max(0, real!) - esp) : null,
        estado,
      })
    }
  }

  const totC = turnos.reduce((a, t) => a + t.cafes, 0)
  const totE = turnos.reduce((a, t) => a + t.esperado, 0)
  return {
    desde,
    turnos,
    gr_por_cafe: totC > 0 ? Math.round(totE / totC) : GR_POR_CAFE_DEFAULT,
    productos: prod.gramos.size,
    por_nombre: prod.porNombre,
  }
}
