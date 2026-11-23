import { claveD, claveM, claveS, corta, DC, DIAS, dow, sumar, type Ahora } from './fechas'
import { DIARIAS, MENSUALES, SEMANALES, diaM, diasDeCaja, estDiaria, estMensual, estSemanal } from './tareas'
import { estDelegado, estPedido, nombreCorto, ultimaSenal } from './pedidos'
import type { CajaDia, DatosOperaciones, VentasOperaciones } from './tipos'

// ---------------------------------------------------------------------------
// Alertas del control interno: rojo = vencido, ámbar = vence pronto
// ---------------------------------------------------------------------------

export type Seccion = 'hoy' | 'semana' | 'mes' | 'pedidos' | 'encargados' | 'ventas'
export type Alerta = { nivel: 'rojo' | 'ambar'; texto: string; seccion: Seccion }

export type Hecho = (periodo: string, tarea: string) => boolean

export function hechoDe(checks: DatosOperaciones['checks']): Hecho {
  const s = new Set(checks.map((c) => `${c.periodo}|${c.tarea}`))
  return (periodo, tarea) => s.has(`${periodo}|${tarea}`)
}

/** ¿Hay diferencia de caja cargada sin motivo? */
export function cajaSinMotivo(c: CajaDia | undefined): boolean {
  return !!c && c.diferencia != null && c.diferencia !== 0 && !(c.motivo ?? '').trim()
}

// ---------------------------------------------------------------------------
// Ventas de ayer contra el promedio del mismo día de las 4 semanas anteriores
// ---------------------------------------------------------------------------

export type AnalisisVentas = {
  ayer: string
  total: number
  tickets: number
  promedio: number
  /** cuántos días entraron al promedio */
  n: number
  /** ayer / promedio (null si no hay promedio) */
  ratio: number | null
  ultimos7: number
}

export function analizarVentas(v: VentasOperaciones | undefined): AnalisisVentas | null {
  if (!v || !v.dias.length) return null
  const mapa = new Map(v.dias.map((d) => [d.fecha, d]))
  const y = mapa.get(v.ayer) ?? { total: 0, tickets: 0 }
  const previos = [7, 14, 21, 28].map((s) => mapa.get(sumar(v.ayer, -s))).filter((d): d is NonNullable<typeof d> => !!d && d.tickets > 0)
  const promedio = previos.length ? previos.reduce((a, b) => a + b.total, 0) / previos.length : 0
  const desde7 = sumar(v.ayer, -7)
  return {
    ayer: v.ayer,
    total: y.total,
    tickets: y.tickets,
    promedio,
    n: previos.length,
    ratio: promedio ? y.total / promedio : null,
    ultimos7: v.dias.filter((d) => d.fecha > desde7).reduce((a, b) => a + b.total, 0),
  }
}

// ---------------------------------------------------------------------------

export function alertas(n: Ahora, datos: DatosOperaciones, hecho: Hecho, ventas: AnalisisVentas | null): Alerta[] {
  const A: Alerta[] = []
  const rojo = (texto: string, seccion: Seccion) => A.push({ nivel: 'rojo', texto, seccion })
  const ambar = (texto: string, seccion: Seccion) => A.push({ nivel: 'ambar', texto, seccion })

  if (n.dow !== 0) {
    for (const t of DIARIAS) {
      const e = estDiaria(t, n, hecho(claveD(n.hoy), t.id))
      if (e === 'late') rojo(`${t.t}: venció a las ${t.h}`, 'hoy')
      else if (e === 'soon') ambar(`${t.t}: vence a las ${t.h}`, 'hoy')
    }
    const caja = new Map(datos.caja.map((c) => [c.fecha, c]))
    for (const f of diasDeCaja(n)) {
      if (cajaSinMotivo(caja.get(f))) rojo(`Diferencia de caja del ${DIAS[dow(f)].toLowerCase()} ${corta(f)} sin explicar`, 'hoy')
    }
  }

  for (const t of SEMANALES) {
    const e = estSemanal(t, n, hecho(claveS(n.hoy), t.id), datos.inicio)
    if (e === 'late') rojo(`${t.t}: venció el ${DC[t.dow].toLowerCase()}`, 'semana')
    else if (e === 'soon') ambar(`${t.t}: vence hoy${t.h !== '23:59' ? ` a las ${t.h}` : ''}`, 'semana')
  }

  for (const t of MENSUALES) {
    const e = estMensual(t, n, hecho(claveM(n.hoy), t.id), datos.inicio)
    const v = diaM(t, n)
    if (e === 'late') rojo(`${t.t}: venció el día ${v}`, 'mes')
    else if (e === 'soon') ambar(`${t.t}: vence el día ${v}${v === n.d ? ' (hoy)' : ''}`, 'mes')
  }

  for (const p of datos.pedidos) {
    if (p.estado === 'hecho') continue
    const nom = nombreCorto(p.delegado_a)
    if (p.delegado_a) {
      if (p.compromiso && p.compromiso > p.vence) ambar(`El compromiso de ${nom} (${corta(p.compromiso)}) es después de lo que vence para el socio (${corta(p.vence)}): ${p.que}`, 'encargados')
      const ed = estDelegado(p, n)
      if (ed === 'late') rojo(`${nom} no cumplió el compromiso del ${corta(p.compromiso!)}: ${p.que}`, 'encargados')
      else if (ed === 'soon') ambar(`Sin seguimiento hace ${Math.floor((Date.now() - Date.parse(ultimaSenal(p))) / 86_400_000)} días (${nom}): ${p.que}`, 'encargados')
    } else if ((Date.now() - Date.parse(p.created_at)) / 3_600_000 > 24) {
      ambar(`Sin delegar desde hace más de 24 h: ${p.que}`, 'pedidos')
    }
    const e = estPedido(p, n)
    if (e === 'late') rojo(`Pedido de ${p.pedido_por} vencido o sin respuesta en 48 h: ${p.que}`, 'pedidos')
    else if (e === 'soon') ambar(`Pedido de ${p.pedido_por} por vencer: ${p.que}`, 'pedidos')
  }

  if (ventas) {
    if (ventas.tickets === 0) rojo(`Santa Fe: sin ventas cerradas en Fudo el ${corta(ventas.ayer)}`, 'ventas')
    else if (ventas.ratio !== null && ventas.ratio < 0.75) {
      ambar(`Santa Fe: ayer vendió ${Math.round((1 - ventas.ratio) * 100)} % menos que el promedio de los ${DIAS[dow(ventas.ayer)].toLowerCase()}s`, 'ventas')
    }
  }

  return A.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'rojo' ? -1 : 1))
}
