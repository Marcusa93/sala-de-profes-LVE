import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { productosCafe, ventasCafe } from './cruce'

// ---------------------------------------------------------------------------
// Merma de café por día y por semana (pedido de Joaquín, 27/11/2026)
// ---------------------------------------------------------------------------
// Se arma con los pesajes del Control de tolva (4 por día), de a tramos entre
// un pesaje y el siguiente:
//   usado    = peso anterior + recarga − peso actual
//   teórico  = cafés vendidos en Fudo en ese tramo × gramos de su receta
//   merma    = usado − teórico            merma % = merma ÷ usado
//   descarte = lo que se tiró calibrando o purgando (ya está dentro de usado)
//   sin explicar = merma − descarte
// Cada tramo es del día operativo de su pesaje final: el día junta los tramos
// desde el último pesaje del día anterior hasta el último de ese día, y las
// ventas de ese mismo lapso. Solo cuentan los tramos cuyo pesaje final trae
// recarga y descarte (se piden desde el 28/11/2026, migración
// 20261128_tolva_recarga_descarte); los anteriores quedan como incompletos.
// ---------------------------------------------------------------------------

/** Un pesaje anterior más viejo que esto corta la cadena */
const MAX_HORAS_TRAMO = 30
/** Merma que llama la atención: más de 15 % de lo usado y más de 60 g (como el cruce por turno) */
export const MERMA_UMBRAL_PCT = 0.15
export const MERMA_UMBRAL_MIN_GR = 60

export type Tramo = {
  desde: string
  hasta: string
  /** Hora del control que cierra el tramo (07:00, 15:50…) */
  control: string
  dia: string
  pesoAntes: number
  pesoDespues: number
  recarga: number | null
  descarte: number | null
  usado: number
  cafes: number
  teorico: number
  /** Trae recarga y descarte: entra en la cuenta */
  completo: boolean
  alerta: string | null
}

export type Totales = {
  usado: number
  teorico: number
  cafes: number
  descarte: number
  /** usado − teórico (g) */
  merma: number
  /** merma ÷ usado; null si no se usó nada */
  mermaPct: number | null
  /** descarte ÷ usado */
  descartePct: number | null
  /** merma − descarte (g) */
  sinExplicar: number
  tramos: number
  incompletos: number
  alertas: number
}

export type DiaMerma = Totales & { fecha: string }
export type SemanaMerma = Totales & { lunes: string; hasta: string }

export type MermaCafe = {
  desde: string
  hoy: string
  dias: DiaMerma[]
  semanas: SemanaMerma[]
  /** Tramos de los últimos días, del más nuevo al más viejo (detalle) */
  tramos: Tramo[]
  /** Desde cuándo hay pesajes con recarga y descarte */
  primerCompleto: string | null
}

const sumarDias = (fecha: string, d: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)
/** Lunes de la semana de una fecha (YYYY-MM-DD) */
export const lunesDe = (fecha: string) => sumarDias(fecha, -((new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7))
const r = (n: number) => Math.round(n)

function totales(ts: Tramo[]): Totales {
  const c = ts.filter((t) => t.completo)
  const usado = c.reduce((a, t) => a + t.usado, 0)
  const teorico = c.reduce((a, t) => a + t.teorico, 0)
  const descarte = c.reduce((a, t) => a + (t.descarte ?? 0), 0)
  const merma = usado - teorico
  return {
    usado: r(usado),
    teorico: r(teorico),
    cafes: c.reduce((a, t) => a + t.cafes, 0),
    descarte: r(descarte),
    merma: r(merma),
    mermaPct: usado > 0 ? merma / usado : null,
    descartePct: usado > 0 ? descarte / usado : null,
    sinExplicar: r(merma - descarte),
    tramos: c.length,
    incompletos: ts.length - c.length,
    alertas: ts.filter((t) => t.alerta).length,
  }
}

/** ¿La merma de un día (o semana) llama la atención? */
export const mermaAlta = (t: Pick<Totales, 'merma' | 'usado'>) =>
  t.usado > 0 && t.merma > Math.max(MERMA_UMBRAL_MIN_GR, t.usado * MERMA_UMBRAL_PCT)

type Pesaje = {
  hecho_at: string
  hora: string
  medicion: number
  tolva_recarga_gr?: number | null
  tolva_descarte_gr?: number | null
  tolva_alerta?: string | null
}

/** Los últimos `dias` días (hoy incluido) */
export async function mermaCafe(db: SupabaseClient, dias = 28): Promise<MermaCafe> {
  const hoy = fechaOperativa()
  const desde = sumarDias(hoy, -(Math.max(1, dias) - 1))
  // Un día antes para tener el pesaje que abre el primer tramo
  const desdeIso = `${sumarDias(desde, -1)}T06:00:00-03:00`

  const { data: protos } = await db.from('protocolos').select('id').eq('registro', 'tolva')
  const ids = ((protos ?? []) as { id: string }[]).map((p) => p.id)
  if (!ids.length) return { desde, hoy, dias: [], semanas: [], tramos: [], primerCompleto: null }

  const campos = 'hecho_at, hora, medicion, tolva_recarga_gr, tolva_descarte_gr, tolva_alerta'
  const consulta = (sel: string) => db.from('protocolo_tareas').select(sel)
    .in('protocolo_id', ids).eq('estado', 'hecha').not('medicion', 'is', null).gte('hecho_at', desdeIso)
    .order('hecho_at', { ascending: true })
  let res = await consulta(campos)
  // Sin la migración 20261128 todavía: sin recarga ni descarte, todo queda incompleto
  if (res.error && /tolva_/.test(res.error.message)) res = await consulta('hecho_at, hora, medicion')
  if (res.error) throw new Error(res.error.message)
  const pesajes = (res.data ?? []) as unknown as Pesaje[]

  const tramos: Tramo[] = []
  for (let i = 1; i < pesajes.length; i++) {
    const a = pesajes[i - 1]
    const b = pesajes[i]
    if (Date.parse(b.hecho_at) - Date.parse(a.hecho_at) > MAX_HORAS_TRAMO * 3_600_000) continue
    const dia = fechaOperativa(new Date(b.hecho_at))
    if (dia < desde) continue
    const recarga = b.tolva_recarga_gr == null ? null : Number(b.tolva_recarga_gr)
    const descarte = b.tolva_descarte_gr == null ? null : Number(b.tolva_descarte_gr)
    tramos.push({
      desde: a.hecho_at,
      hasta: b.hecho_at,
      control: String(b.hora).slice(0, 5),
      dia,
      pesoAntes: Number(a.medicion),
      pesoDespues: Number(b.medicion),
      recarga,
      descarte,
      usado: Number(a.medicion) + (recarga ?? 0) - Number(b.medicion),
      cafes: 0,
      teorico: 0,
      completo: recarga != null && descarte != null,
      alerta: b.tolva_alerta ?? null,
    })
  }

  // Ventas de café de cada tramo (por la hora de la venta)
  const prod = await productosCafe(db)
  if (tramos.length && prod.gramos.size) {
    const ventas = await ventasCafe(db, [...prod.gramos.keys()], tramos[0].desde)
    let k = 0
    for (const v of ventas) {
      const t = Date.parse(v.sold_at)
      while (k < tramos.length && Date.parse(tramos[k].hasta) < t) k++
      if (k >= tramos.length) break
      const tr = tramos[k]
      if (t <= Date.parse(tr.desde)) continue // entre tramos (cadena cortada)
      const q = Number(v.quantity ?? 1)
      tr.cafes += q
      tr.teorico += q * (prod.gramos.get(String(v.fudo_product_id)) ?? 0)
    }
  }
  for (const t of tramos) { t.usado = r(t.usado); t.teorico = r(t.teorico); t.cafes = Math.round(t.cafes) }

  const diasOut: DiaMerma[] = []
  for (let f = desde; f <= hoy; f = sumarDias(f, 1)) {
    const ts = tramos.filter((t) => t.dia === f)
    if (ts.length) diasOut.push({ fecha: f, ...totales(ts) })
  }
  const semanas: SemanaMerma[] = []
  for (let l = lunesDe(desde); l <= hoy; l = sumarDias(l, 7)) {
    const hasta = sumarDias(l, 6) < hoy ? sumarDias(l, 6) : hoy
    const ts = tramos.filter((t) => t.dia >= l && t.dia <= hasta)
    if (ts.length) semanas.push({ lunes: l, hasta, ...totales(ts) })
  }
  const primer = tramos.find((t) => t.completo)
  return {
    desde,
    hoy,
    dias: diasOut,
    semanas,
    tramos: tramos.filter((t) => t.dia >= sumarDias(hoy, -6)).reverse(),
    primerCompleto: primer ? primer.dia : null,
  }
}
