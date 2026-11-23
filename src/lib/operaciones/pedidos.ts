import type { Ahora } from './fechas'
import type { PedidoSocio } from './tipos'

// ---------------------------------------------------------------------------
// Reglas de los pedidos de socios (mismas del tablero de claude.ai)
// ---------------------------------------------------------------------------
// · Respuesta al socio en 48 h (a las 36 h ya avisa).
// · Delegar no lo saca de la lista: el encargado tiene que dar señales cada
//   48 h y cumplir su compromiso.
// ---------------------------------------------------------------------------

export type EstadoPedido = 'done' | 'late' | 'soon' | ''

const horasDesde = (iso: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : 0)

/** Última señal de un pedido delegado: cuándo se delegó o el último avance */
export function ultimaSenal(p: PedidoSocio): string {
  let t = p.delegado_at ?? p.created_at
  for (const s of p.seguimiento) if (s.created_at > t) t = s.created_at
  return t
}

export function estPedido(p: PedidoSocio, n: Ahora): EstadoPedido {
  if (p.estado === 'hecho') return 'done'
  if (p.vence < n.hoy) return 'late'
  const h = horasDesde(p.created_at)
  if (!p.respondido && h > 48) return 'late'
  if (p.vence === n.hoy) return 'soon'
  if (!p.respondido && h > 36) return 'soon'
  return ''
}

export function estDelegado(p: PedidoSocio, n: Ahora): EstadoPedido {
  if (!p.delegado_a || p.estado === 'hecho') return ''
  if (p.compromiso && p.compromiso < n.hoy) return 'late'
  if (horasDesde(ultimaSenal(p)) > 48) return 'soon'
  return ''
}

export type StatsPedidos = { cumplidos: number; incumplidos: number; aTiempo: number; tarde: number; abiertos: number; verificados: number }

export function statsPedidos(lista: PedidoSocio[]): StatsPedidos {
  const c = lista.filter((p) => p.resultado === 'cumplido')
  const i = lista.filter((p) => p.resultado === 'no_cumplido').length
  const t = c.filter((p) => p.a_tiempo).length
  return { cumplidos: c.length, incumplidos: i, aTiempo: t, tarde: c.length - t, abiertos: lista.filter((p) => p.estado !== 'hecho').length, verificados: c.length + i }
}

export const nombreCorto = (n: string | null) => (n ? n.split(' ')[0] : 'Joaquín')

export function textoResultado(p: PedidoSocio): string {
  if (p.resultado === 'cumplido') return p.a_tiempo ? 'Cumplido a tiempo' : 'Cumplido tarde'
  return 'No cumplido'
}
