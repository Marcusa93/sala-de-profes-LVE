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
// ---------------------------------------------------------------------------

type Turno = 'TM' | 'TT'
type Fila = { id: number; shift: Turno; start_gr: number | null; added_gr: number | null; end_gr: number | null }

/** Lo que se acepta de diferencia de balanza antes de pedir el agregado */
const TOLERANCIA_GR = 15

/** ¿Este control abre el turno mañana? (no cierra ningún turno) */
export const esControlDeInicio = (hora: string) => {
  const h = Number(hora.slice(0, 2))
  return h >= 6 && h < 12
}

type Plan = {
  cambios: { shift: Turno; campo: 'start_gr' | 'end_gr' }[]
  /** Turno al que se suma lo agregado (el que se cierra con este peso) */
  sumarA: Turno | null
  /** Cuánto café tenía que haber como máximo (lo del control anterior + lo agregado en el turno) */
  base: number | null
}

function planear(hora: string, tm: Fila | undefined, tt: Fila | undefined): Plan {
  const h = Number(hora.slice(0, 2))
  const n = (v: number | null | undefined) => (v == null ? 0 : Number(v))
  if (h >= 6 && h < 12) return { cambios: [{ shift: 'TM', campo: 'start_gr' }], sumarA: null, base: null }
  if (h >= 12 && h < 20) {
    if (tm?.end_gr != null) {
      // Segundo control del cambio de turno: TM ya cerró
      return { cambios: [{ shift: 'TT', campo: 'start_gr' }], sumarA: null, base: Number(tm.end_gr) }
    }
    return {
      cambios: [{ shift: 'TM', campo: 'end_gr' }, { shift: 'TT', campo: 'start_gr' }],
      sumarA: 'TM',
      base: tm?.start_gr != null ? Number(tm.start_gr) + n(tm.added_gr) : null,
    }
  }
  return {
    cambios: [{ shift: 'TT', campo: 'end_gr' }],
    sumarA: 'TT',
    base: tt?.start_gr != null ? Number(tt.start_gr) + n(tt.added_gr) : null,
  }
}

async function filasDelDia(admin: SupabaseClient, fecha: string) {
  const { data } = await admin.from('tolva_logs').select('id, shift, start_gr, added_gr, end_gr').eq('log_date', fecha)
  const filas = (data ?? []) as Fila[]
  return { tm: filas.find((f) => f.shift === 'TM'), tt: filas.find((f) => f.shift === 'TT') }
}

const gr = (v: number) => `${Math.round(v).toLocaleString('es-AR')} g`

/**
 * Antes de cerrar la tarea: si la tolva tiene más café que en el control
 * anterior, alguien cargó café y tiene que decir cuánto. Devuelve el mensaje
 * de error, o null si está bien.
 *   agregado = null → la pantalla vieja (sin el campo): solo se frena si subió
 */
export async function validarPesoTolva(admin: SupabaseClient, fecha: string, hora: string, gramos: number, agregado: number | null): Promise<string | null> {
  if (esControlDeInicio(hora)) return null
  const { tm, tt } = await filasDelDia(admin, fecha)
  const { base } = planear(hora, tm, tt)
  if (base == null) return null
  const puesto = agregado ?? 0
  if (gramos <= base + puesto + TOLERANCIA_GR) return null
  const falta = Math.ceil(gramos - base - puesto)
  if (agregado == null) {
    return `La tolva tiene más café que en el control anterior (${gr(base)} → ${gr(gramos)}): hay que cargar cuánto café pusiste. Cerrá y volvé a abrir la app para que aparezca ese campo.`
  }
  return puesto > 0
    ? `Con lo que cargaste no cierra: en el control anterior había ${gr(base)}, cargaste ${gr(puesto)} y ahora hay ${gr(gramos)}. Revisá el peso o lo que cargaste (faltan al menos ${gr(falta)}).`
    : `La tolva tiene más café que en el control anterior (${gr(base)} → ${gr(gramos)}): poné cuánto café cargaste (al menos ${gr(falta)}).`
}

export async function registrarPesoTolva(admin: SupabaseClient, fecha: string, hora: string, gramos: number, userId: string, agregado = 0): Promise<string> {
  const { tm, tt } = await filasDelDia(admin, fecha)
  const { cambios, sumarA } = planear(hora, tm, tt)
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
