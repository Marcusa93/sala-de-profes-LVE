import { ventanaTurno } from '@/lib/turnos/rol-del-turno'

// ---------------------------------------------------------------------------
// Horas de más: quedarse después del fin del turno
// ---------------------------------------------------------------------------
// Se pagan solo si un encargado o socio las autorizó (Marco, 10/10 y 23/11):
//   · tocando "Autorizar" en Equipo → extra_autorizada_por / extra_autorizada_at
//   · o corrigiendo la salida en Equipo → clock_out_type 'edited'
// Se usa igual en el servidor y en el navegador.
// ---------------------------------------------------------------------------

/** Pasarse menos que esto del fin del turno no se avisa (cerrar caja, cambiarse) */
export const TOLERANCIA_EXTRA_MIN = 10

/** Cuántos minutos antes del fin del turno ya se puede autorizar que se quede */
export const ANTICIPO_AUTORIZAR_MIN = 30

type Fichaje = { clock_out_at: string | null; clock_out_type?: string | null; extra_autorizada_at?: string | null }

/** ¿Las horas después del turno se pagan? */
export const extraAutorizada = (f: Fichaje) => f.clock_out_type === 'edited' || !!f.extra_autorizada_at

/** Fin del turno (instante, ms). start/end en 'HH:MM' o 'HH:MM:SS'. */
export const finDelTurno = (fecha: string, start: string, end: string) => ventanaTurno(fecha, start, end).fin

/** Minutos después del fin del turno: hasta la salida o, si sigue trabajando, hasta ahora. */
export function minutosDeMas(fecha: string, start: string, end: string, salida: string | null, ahora = Date.now()): number {
  const hasta = salida ? Date.parse(salida) : ahora
  return Math.max(0, Math.round((hasta - finDelTurno(fecha, start, end)) / 60_000))
}

/** 95 → '1 h 35 min' */
export function textoMinutos(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return `${h} h${r ? ` ${r} min` : ''}`
}

/** Hora argentina de un instante: '23:40' */
export const horaAR = (iso: string | number) =>
  new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })

/** Fecha y hora argentinas cortas: '23/11 22:15' */
export const cuandoAR = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
