import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// El peso cargado en el protocolo "Control de tolva" pasa solo al registro de
// la tolva (tolva_logs: por día y turno TM/TT, inicio / agregado / final):
//   antes de las 12  → inicio del turno mañana (TM)
//   de 12 a 20       → fin de TM e inicio del turno tarde (TT)  (cambio de turno).
//                      Si TM ya tenía fin (el control de las 15:50), el de las
//                      16:00 solo es el inicio de TT: no pisa el fin de TM.
//   desde las 20     → fin de TT
// En los controles que cierran un turno (el de las 15:50 y el de las 21:55)
// se pide además cuánto café se cargó desde el control anterior: se suma al
// agregado de ese turno. Sin eso el consumo daba negativo (25/11/2026: en dos
// semanas el agregado estaba en 0 en todos los turnos y el cruce con las
// ventas no servía).
//
// 28/11/2026 (pedido de Joaquín): en LOS CUATRO controles se piden dos números,
// los dos desde el control anterior: cuánto café se cargó (recarga) y cuánto se
// tiró calibrando o purgando (descarte). Se guardan en la tarea
// (tolva_recarga_gr, tolva_descarte_gr) para el control de merma por día y
// semana: usado = peso anterior + recarga − peso actual. Al registro por turno
// (tolva_logs) solo pasa la recarga de los controles que cierran turno: la de
// los de inicio pasó antes de pesar el inicio.
// Y se controla contra el pesaje anterior (sea del turno que sea):
//   · si subió más que lo cargado → no se cierra (falta la recarga)
//   · si bajó más de lo que se puede usar en ese tiempo → hay que confirmarlo
//     (27/11: de 146 g a 14 g en 3 minutos, sin descarte).
// ---------------------------------------------------------------------------

type Turno = 'TM' | 'TT'
type Fila = { id: number; shift: Turno; start_gr: number | null; added_gr: number | null; end_gr: number | null }

/** Lo que se acepta de diferencia de balanza antes de pedir la recarga (22/11: subió 18 g sin cargar) */
const TOLERANCIA_GR = 25
/** Lo que se puede usar como máximo por minuto (más de un café doble por minuto, de sobra) */
const MAX_GR_POR_MIN = 20
/** Margen antes de pedir confirmación por una caída */
const MARGEN_CAIDA_GR = 40
/** Un pesaje anterior más viejo que esto no sirve para comparar */
const MAX_HORAS_ANTERIOR = 30

type Plan = {
  cambios: { shift: Turno; campo: 'start_gr' | 'end_gr' }[]
  /** Turno al que se suma lo agregado (el que se cierra con este peso) */
  sumarA: Turno | null
}

function planear(hora: string, tm: Fila | undefined): Plan {
  const h = Number(hora.slice(0, 2))
  if (h >= 6 && h < 12) return { cambios: [{ shift: 'TM', campo: 'start_gr' }], sumarA: null }
  if (h >= 12 && h < 20) {
    // Segundo control del cambio de turno: TM ya cerró
    if (tm?.end_gr != null) return { cambios: [{ shift: 'TT', campo: 'start_gr' }], sumarA: null }
    return { cambios: [{ shift: 'TM', campo: 'end_gr' }, { shift: 'TT', campo: 'start_gr' }], sumarA: 'TM' }
  }
  return { cambios: [{ shift: 'TT', campo: 'end_gr' }], sumarA: 'TT' }
}

async function filasDelDia(admin: SupabaseClient, fecha: string) {
  const { data } = await admin.from('tolva_logs').select('id, shift, start_gr, added_gr, end_gr').eq('log_date', fecha)
  const filas = (data ?? []) as Fila[]
  return { tm: filas.find((f) => f.shift === 'TM'), tt: filas.find((f) => f.shift === 'TT') }
}

const gr = (v: number) => `${Math.round(v).toLocaleString('es-AR')} g`

/** El pesaje anterior de la tolva (cualquier control ya hecho, el más reciente) */
async function pesajeAnterior(admin: SupabaseClient, tareaId: string): Promise<{ gramos: number; at: string; hora: string } | null> {
  const { data: protos } = await admin.from('protocolos').select('id').eq('registro', 'tolva')
  const ids = ((protos ?? []) as { id: string }[]).map((p) => p.id)
  if (!ids.length) return null
  const { data } = await admin.from('protocolo_tareas').select('medicion, hecho_at, hora')
    .in('protocolo_id', ids).eq('estado', 'hecha').not('medicion', 'is', null).neq('id', tareaId)
    .lt('hecho_at', new Date(Date.now()).toISOString())
    .order('hecho_at', { ascending: false }).limit(1)
  const f = (data ?? [])[0] as { medicion: number; hecho_at: string; hora: string } | undefined
  if (!f || Date.now() - Date.parse(f.hecho_at) > MAX_HORAS_ANTERIOR * 3_600_000) return null
  return { gramos: Number(f.medicion), at: f.hecho_at, hora: String(f.hora).slice(0, 5) }
}

export type ControlPesaje =
  | { ok: true; alerta: string | null }
  /** No se cierra (falta la recarga) */
  | { ok: false; error: string }
  /** Se cierra solo si quien pesó lo confirma */
  | { ok: false; confirmar: string }

/**
 * Antes de cerrar un control de tolva: se compara con el pesaje anterior.
 *   recarga/descarte = null → la pantalla vieja (sin los campos): solo se frena si subió
 *   confirmado → quien pesó ya confirmó una caída grande: pasa, y queda la alerta
 */
export async function validarPesajeTolva(
  admin: SupabaseClient,
  tareaId: string,
  gramos: number,
  recarga: number | null,
  descarte: number | null,
  confirmado: boolean,
): Promise<ControlPesaje> {
  const ant = await pesajeAnterior(admin, tareaId)
  if (!ant) return { ok: true, alerta: null }
  const puesto = recarga ?? 0
  if (gramos > ant.gramos + puesto + TOLERANCIA_GR) {
    const falta = Math.ceil(gramos - ant.gramos - puesto)
    if (recarga == null) {
      return { ok: false, error: `La tolva tiene más café que en el control anterior (${gr(ant.gramos)} → ${gr(gramos)}): hay que cargar cuánto café pusiste. Cerrá y volvé a abrir la app para que aparezca ese campo.` }
    }
    return {
      ok: false,
      error: puesto > 0
        ? `Con lo que cargaste no cierra: en el control anterior (${ant.hora}) había ${gr(ant.gramos)}, cargaste ${gr(puesto)} y ahora hay ${gr(gramos)}. Revisá el peso o lo que cargaste (faltan al menos ${gr(falta)}).`
        : `La tolva tiene más café que en el control anterior (${ant.hora}: ${gr(ant.gramos)} → ${gr(gramos)}): poné cuánto café cargaste (al menos ${gr(falta)}).`,
    }
  }
  const usado = ant.gramos + puesto - gramos
  const minutos = Math.max(0, Math.round((Date.now() - Date.parse(ant.at)) / 60_000))
  const maximo = (descarte ?? 0) + MARGEN_CAIDA_GR + minutos * MAX_GR_POR_MIN
  if (usado > maximo) {
    const texto = `bajó ${gr(usado)} en ${minutos === 1 ? '1 minuto' : `${minutos} minutos`} (control de las ${ant.hora}: ${gr(ant.gramos)}${puesto > 0 ? ` + ${gr(puesto)} cargados` : ''} → ahora ${gr(gramos)})`
    if (!confirmado) {
      return { ok: false, confirmar: `La tolva ${texto}, y en ese tiempo no se puede usar tanto café. ¿Pesaste bien? Si tiraste café calibrando o purgando, ponelo en el descarte. Si es así, confirmalo.` }
    }
    return { ok: true, alerta: `Confirmado: ${texto}${descarte ? `, con ${gr(descarte)} de descarte` : ''}` }
  }
  return { ok: true, alerta: null }
}

export async function registrarPesoTolva(admin: SupabaseClient, fecha: string, hora: string, gramos: number, userId: string, agregado = 0): Promise<string> {
  const { tm, tt } = await filasDelDia(admin, fecha)
  const { cambios, sumarA } = planear(hora, tm)
  const ahora = new Date().toISOString()

  for (const c of cambios) {
    const actual = c.shift === 'TM' ? tm : tt
    const suma = sumarA === c.shift && agregado > 0 ? agregado : 0
    if (actual) {
      await admin.from('tolva_logs').update({
        [c.campo]: gramos,
        ...(suma ? { added_gr: Number(actual.added_gr ?? 0) + suma } : {}),
        updated_at: ahora,
      }).eq('id', actual.id)
    } else {
      await admin.from('tolva_logs').insert({ log_date: fecha, shift: c.shift, [c.campo]: gramos, added_gr: suma, created_by: userId, updated_at: ahora })
    }
  }
  const texto = cambios.map((c) => `${c.campo === 'start_gr' ? 'inicio' : 'fin'} ${c.shift === 'TM' ? 'mañana' : 'tarde'}`).join(' y ')
  return sumarA && agregado > 0 ? `${texto}, con ${gr(agregado)} cargados` : texto
}
