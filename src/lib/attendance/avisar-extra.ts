import type { SupabaseClient } from '@supabase/supabase-js'
import { ventanaTurno } from '@/lib/turnos/rol-del-turno'
import { notifyEvent } from '@/lib/push/notify-event'
import { horaAR, textoMinutos } from './horas-extra'

// ---------------------------------------------------------------------------
// Horas de más (solo servidor): fin del turno de un fichaje y aviso a Marco
// ---------------------------------------------------------------------------

/** Fin del turno que corresponde al fichaje (el que empieza más cerca de la entrada). null si no tenía turno. */
export async function finTurnoDeFichaje(admin: SupabaseClient, log: { user_id: string; operative_date: string; clock_in_at: string }): Promise<number | null> {
  const { data } = await admin.from('shifts').select('start_time, end_time').eq('user_id', log.user_id).eq('shift_date', log.operative_date)
  const turnos = ((data ?? []) as { start_time: string | null; end_time: string | null }[])
    .filter((t) => t.start_time && t.end_time)
    .map((t) => ventanaTurno(log.operative_date, t.start_time!, t.end_time!))
  if (!turnos.length) return null
  const entrada = Date.parse(log.clock_in_at)
  return turnos.reduce((a, b) => (Math.abs(b.inicio - entrada) < Math.abs(a.inicio - entrada) ? b : a)).fin
}

type Aviso = {
  /** Quién autorizó (no se le avisa a sí mismo) */
  autorizoId: string
  autorizoNombre: string
  empleado: string
  fecha: string
  fin: number
  /** null = sigue trabajando */
  salida: string | null
  como: 'autorizo' | 'corrigio' | 'quito'
}

/** Aviso al celular de cada autorización de horas de más (evento 'horas_extra_autorizadas'). Nunca corta la acción. */
export async function avisarHorasDeMas(admin: SupabaseClient, a: Aviso): Promise<void> {
  const finTxt = horaAR(a.fin)
  const ahora = horaAR(Date.now())
  let title: string, body: string
  if (a.como === 'quito') {
    title = 'Se quitó una autorización de horas de más'
    body = `${a.autorizoNombre} le quitó a ${a.empleado} las horas de más (turno hasta las ${finTxt}). Se paga hasta el fin del turno.`
  } else {
    const minutos = a.salida ? Math.max(0, Math.round((Date.parse(a.salida) - a.fin) / 60_000)) : 0
    const detalle = a.salida
      ? `salió a las ${horaAR(a.salida)}, ${textoMinutos(minutos)} de más`
      : 'sigue trabajando'
    title = a.como === 'corrigio' ? 'Salida corregida después del turno' : 'Horas de más autorizadas'
    body = a.como === 'corrigio'
      ? `${a.autorizoNombre} corrigió la salida de ${a.empleado} (turno hasta las ${finTxt}): ${detalle}. A las ${ahora}.`
      : `${a.autorizoNombre} autorizó a ${a.empleado} a quedarse después de las ${finTxt} (${detalle}). A las ${ahora}.`
  }
  try {
    await notifyEvent(admin, 'horas_extra_autorizadas', { title, body, url: `/equipo?date=${a.fecha}` }, { excludeUserId: a.autorizoId })
  } catch (err) {
    console.error('[horas de más] aviso', err)
  }
}
