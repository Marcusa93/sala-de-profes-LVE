import { isManagerOrAbove, puedeValidarProduccion } from '@/lib/roles'

// ---------------------------------------------------------------------------
// Cambiar una validación de producción (pedido de cocina, 23/11/2026)
// ---------------------------------------------------------------------------
// Quien validó se puede corregir:
//   · Rechazada por error → «Volver a abrir»: vuelve a "para confirmar". Una
//     rechazada nunca movió stock, así que no se toca nada más.
//   · Confirmada por error → «Deshacer validación»: los insumos vuelven, lo
//     producido sale (app y Fudo) y vuelve a "para confirmar" para corregirla
//     con «Falta algo» o rechazarla (revert_production_order, migración 20261123).
// Reglas: lo hace quien la validó o un encargado/socio, nunca quien la cargó
// (igual que validar), hasta 2 días después y siempre con el motivo.
// Sin dependencias de servidor: lo usan la API y las pantallas.
// ---------------------------------------------------------------------------

export const HORAS_PARA_CAMBIAR = 48

export type OrdenParaCambiar = {
  status: string
  chef_id: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  completed_at: string | null
}

export type Cambio = 'deshacer' | 'reabrir'

/** Qué cambio corresponde según el estado (null si no se puede cambiar). */
export function cambioPara(status: string): Cambio | null {
  if (status === 'completed') return 'deshacer'
  if (status === 'rejected') return 'reabrir'
  return null
}

/** Cuándo se confirmó o se rechazó. */
export function cuandoSeReviso(o: OrdenParaCambiar): string | null {
  if (o.status === 'completed') return o.completed_at ?? o.reviewed_at
  if (o.status === 'rejected') return o.reviewed_at
  return null
}

/** Hasta cuándo se puede cambiar (ISO), o null. */
export function cambiableHasta(o: OrdenParaCambiar): string | null {
  const cuando = cuandoSeReviso(o)
  return cuando ? new Date(new Date(cuando).getTime() + HORAS_PARA_CAMBIAR * 3_600_000).toISOString() : null
}

export function puedeCambiarValidacion(
  role: string | null | undefined,
  userId: string | null | undefined,
  o: OrdenParaCambiar,
  ahora: number = Date.now(),
): { ok: true; cambio: Cambio } | { ok: false; error: string } {
  const cambio = cambioPara(o.status)
  if (!cambio) return { ok: false, error: 'Solo se puede cambiar una producción confirmada o rechazada' }
  if (!userId) return { ok: false, error: 'No autenticado' }

  if (!puedeValidarProduccion(role, userId, o.chef_id)) {
    return { ok: false, error: o.chef_id === userId ? 'Esta producción la cargaste vos: la tiene que cambiar otra persona' : 'Solo quien la validó, un encargado o un socio la puede cambiar' }
  }
  // La jefa de cocina cambia solo lo que validó ella; encargados y socios, cualquiera
  if (!isManagerOrAbove(role) && o.reviewed_by !== userId) {
    return { ok: false, error: 'La puede cambiar quien la validó, un encargado o un socio' }
  }

  const hasta = cambiableHasta(o)
  if (!hasta || new Date(hasta).getTime() < ahora) {
    return {
      ok: false,
      error: cambio === 'deshacer'
        ? 'Pasaron más de 2 días desde que se confirmó: si estaba mal, corregí el stock contándolo en Stock → Conteo guiado.'
        : 'Pasaron más de 2 días desde que se rechazó: si hacía falta, que la vuelvan a cargar.',
    }
  }
  return { ok: true, cambio }
}

/** Nota que queda en la producción (y que ve quien la confirma de nuevo). */
export function notaDelCambio(cambio: Cambio, quien: string | null, motivo: string, notaAnterior?: string | null): string {
  const base = cambio === 'deshacer'
    ? `Se deshizo la validación${quien ? ` (${quien})` : ''}: ${motivo}`
    : `Se volvió a abrir${quien ? ` (${quien})` : ''}: ${motivo}${notaAnterior ? ` · Había sido rechazada: ${notaAnterior}` : ''}`
  return base.slice(0, 1000)
}

/** ¿La nota es de un cambio de validación? (para mostrarla al confirmar de nuevo) */
export function esNotaDeCambio(nota: string | null | undefined): boolean {
  return !!nota && (nota.startsWith('Se deshizo la validación') || nota.startsWith('Se volvió a abrir'))
}
