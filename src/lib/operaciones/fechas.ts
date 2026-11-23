// ---------------------------------------------------------------------------
// Fechas del control interno de operaciones (hora de Tucumán)
// ---------------------------------------------------------------------------
// Día de calendario (sin el corte de las 06:00 del fichaje): Joaquín trabaja
// de 11 a 20:30, así que "hoy" es el día que marca el reloj.
// Se usa igual en el servidor y en el navegador.
// ---------------------------------------------------------------------------

export const TZ = 'America/Argentina/Tucuman'
export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const DC = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export type Ahora = {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  /** minutos desde las 00:00 */
  min: number
  /** YYYY-MM-DD */
  hoy: string
  /** 0 = domingo */
  dow: number
}

export const pad = (n: number) => (n < 10 ? '0' : '') + n

export function ahora(fecha: Date = new Date()): Ahora {
  const p: Record<string, string> = {}
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(fecha)
    .forEach((x) => { p[x.type] = x.value })
  const y = +p.year, mo = +p.month, d = +p.day, h = (+p.hour) % 24, mi = +p.minute
  const hoy = `${y}-${pad(mo)}-${pad(d)}`
  return { y, mo, d, h, mi, min: h * 60 + mi, hoy, dow: dow(hoy) }
}

export const dow = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay()

export function sumar(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

/** Días entre dos fechas (b - a) */
export const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

/** Semana ISO: '2026-W48' */
export function semanaIso(s: string): string {
  const d = new Date(`${s}T12:00:00Z`)
  const k = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - k + 3)
  const f = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const w = 1 + Math.round(((d.getTime() - f.getTime()) / 86_400_000 - 3 + ((f.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${pad(w)}`
}

export const lunes = (s: string) => sumar(s, -((dow(s) + 6) % 7))
/** Día de la semana empezando el lunes: lunes = 1 … domingo = 7 */
export const idxSemana = (d: number) => (d === 0 ? 7 : d)
export const ultimoDia = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate()
export const aMin = (h: string) => { const [a, b] = h.split(':'); return (+a) * 60 + (+b) }
/** '2026-11-23' → '23/11' */
export const corta = (s: string) => { const [, m, d] = s.split('-'); return `${+d}/${+m}` }
export const dinero = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null)

/** Claves de período de las tareas tildadas */
export const claveD = (hoy: string) => `d:${hoy}`
export const claveS = (hoy: string) => `s:${semanaIso(hoy)}`
export const claveM = (hoy: string) => `m:${hoy.slice(0, 7)}`

/** Fecha y hora cortas de un instante: '23/11 14:05' */
export const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
/** Fecha corta de un instante: '23/11' */
export const diaDe = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: TZ, day: 'numeric', month: 'numeric' })
