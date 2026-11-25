import { claveD, claveM, claveS, corta, DC, DIAS, dow, sumar, type Ahora } from './fechas'
import { DIARIAS, MENSUALES, SEMANALES, diaM, diasDeCaja, estDiaria, estMensual, estSemanal } from './tareas'
import { estDelegado, estPedido, nombreCorto, pesoPrioridad, ultimaSenal } from './pedidos'
import type { CajaDia, DatosOperaciones, VentasOperaciones } from './tipos'
import type { ControlHorneado } from '@/lib/horneado/config'
import { fueraDeRango, type ControlCafe } from '@/lib/tolva/cruce'
import { lecheFuera, type ControlLeche } from '@/lib/leche/cruce'

// ---------------------------------------------------------------------------
// Alertas del control interno: rojo = vencido, ámbar = vence pronto
// ---------------------------------------------------------------------------

export type Seccion = 'hoy' | 'semana' | 'mes' | 'pedidos' | 'encargados' | 'ventas' | 'horneado' | 'cafe'
/** cantidad: cuántas cosas junta (las tareas del mismo tipo van en una sola alerta) */
export type Alerta = { nivel: 'rojo' | 'ambar'; texto: string; seccion: Seccion; cantidad: number }

/** ['Bancos', 'Cobros', 'Encargados'] → 'Bancos, Cobros y Encargados' */
const juntar = (n: string[]) => (n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`)

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

export function alertas(n: Ahora, datos: DatosOperaciones, hecho: Hecho, ventas: AnalisisVentas | null, horneado: ControlHorneado | null = null, cafe: ControlCafe | null = null, leche: ControlLeche | null = null): Alerta[] {
  const A: Alerta[] = []
  const rojo = (texto: string, seccion: Seccion) => A.push({ nivel: 'rojo', texto, seccion, cantidad: 1 })
  const ambar = (texto: string, seccion: Seccion) => A.push({ nivel: 'ambar', texto, seccion, cantidad: 1 })
  /**
   * Tareas del mismo tipo y estado en una sola alerta: con una sola, el
   * detalle (hora o día); con varias, cuántas y cuáles. Así lo importante
   * (pedidos, caja, ventas) no queda tapado por siete tareas del día.
   */
  function grupo<T extends { t: string }>(items: T[], nivel: Alerta['nivel'], seccion: Seccion, una: (t: T) => string, varias: string) {
    if (items.length === 1) A.push({ nivel, texto: una(items[0]), seccion, cantidad: 1 })
    else if (items.length > 1) A.push({ nivel, texto: `${items.length} ${varias}: ${juntar(items.map((t) => t.t))}`, seccion, cantidad: items.length })
  }

  if (n.dow !== 0) {
    const est = DIARIAS.map((t) => ({ t, e: estDiaria(t, n, hecho(claveD(n.hoy), t.id)) }))
    grupo(est.filter((x) => x.e === 'late').map((x) => x.t), 'rojo', 'hoy', (t) => `${t.t}: venció a las ${t.h}`, 'tareas de hoy vencidas')
    grupo(est.filter((x) => x.e === 'soon').map((x) => x.t), 'ambar', 'hoy', (t) => `${t.t}: vence a las ${t.h}`, 'tareas de hoy vencen pronto')
    const caja = new Map(datos.caja.map((c) => [c.fecha, c]))
    for (const f of diasDeCaja(n)) {
      if (cajaSinMotivo(caja.get(f))) rojo(`Diferencia de caja del ${DIAS[dow(f)].toLowerCase()} ${corta(f)} sin explicar`, 'hoy')
    }
  }

  const sem = SEMANALES.map((t) => ({ t, e: estSemanal(t, n, hecho(claveS(n.hoy), t.id), datos.inicio) }))
  grupo(sem.filter((x) => x.e === 'late').map((x) => x.t), 'rojo', 'semana', (t) => `${t.t}: venció el ${DC[t.dow].toLowerCase()}`, 'tareas de la semana vencidas')
  grupo(sem.filter((x) => x.e === 'soon').map((x) => x.t), 'ambar', 'semana', (t) => `${t.t}: vence hoy${t.h !== '23:59' ? ` a las ${t.h}` : ''}`, 'tareas de la semana vencen hoy')

  const mes = MENSUALES.map((t) => ({ t, e: estMensual(t, n, hecho(claveM(n.hoy), t.id), datos.inicio) }))
  grupo(mes.filter((x) => x.e === 'late').map((x) => x.t), 'rojo', 'mes', (t) => `${t.t}: venció el día ${diaM(t, n)}`, 'tareas del mes vencidas')
  grupo(mes.filter((x) => x.e === 'soon').map((x) => x.t), 'ambar', 'mes', (t) => { const v = diaM(t, n); return `${t.t}: vence el día ${v}${v === n.d ? ' (hoy)' : ''}` }, 'tareas del mes vencen pronto')

  // Los de prioridad alta, primero y marcados
  for (const p of [...datos.pedidos].sort((a, b) => pesoPrioridad(a) - pesoPrioridad(b))) {
    if (p.estado === 'hecho') continue
    const nom = nombreCorto(p.delegado_a)
    const urg = p.prioridad === 'alta' ? 'Prioridad alta · ' : ''
    if (p.delegado_a) {
      if (p.compromiso && p.compromiso > p.vence) ambar(`${urg}El compromiso de ${nom} (${corta(p.compromiso)}) es después de lo que vence para el socio (${corta(p.vence)}): ${p.que}`, 'encargados')
      const ed = estDelegado(p, n)
      if (ed === 'late') rojo(`${urg}${nom} no cumplió el compromiso del ${corta(p.compromiso!)}: ${p.que}`, 'encargados')
      else if (ed === 'soon') ambar(`${urg}Sin seguimiento hace ${Math.floor((Date.now() - Date.parse(ultimaSenal(p))) / 86_400_000)} días (${nom}): ${p.que}`, 'encargados')
    } else if ((Date.now() - Date.parse(p.created_at)) / 3_600_000 > 24) {
      ambar(`${urg}Sin delegar desde hace más de 24 h: ${p.que}`, 'pedidos')
    }
    const e = estPedido(p, n)
    if (e === 'late') rojo(`${urg}Pedido de ${p.pedido_por} vencido o sin respuesta en 48 h: ${p.que}`, 'pedidos')
    else if (e === 'soon') ambar(`${urg}Pedido de ${p.pedido_por} por vencer: ${p.que}`, 'pedidos')
  }

  if (ventas) {
    if (ventas.tickets === 0) rojo(`Santa Fe: sin ventas cerradas en Fudo el ${corta(ventas.ayer)}`, 'ventas')
    else if (ventas.ratio !== null && ventas.ratio < 0.75) {
      ambar(`Santa Fe: ayer vendió ${Math.round((1 - ventas.ratio) * 100)} % menos que el promedio de los ${DIAS[dow(ventas.ayer)].toLowerCase()}s`, 'ventas')
    }
  }

  // Horneado de ayer (medialunas, bollitos, tortillas) contra lo vendido en Fudo
  if (horneado && !horneado.falta_migracion) {
    for (const p of horneado.piezas) {
      const d = p.dias[p.dias.length - 1]
      if (!d || d.antesDelControl) continue
      const salieron = d.vendidas + d.personal
      if (d.sinTandas) ambar(`Ayer no se cargaron las tandas de ${p.nombre.toLowerCase()} (salieron ${salieron})`, 'horneado')
      else if (d.diferencia > p.umbral) rojo(`Ayer faltan ${d.diferencia} ${p.nombre.toLowerCase()} sin explicar`, 'horneado')
      else if (d.diferencia < -p.umbral) ambar(`Ayer salieron ${-d.diferencia} ${p.nombre.toLowerCase()} más de las cargadas`, 'horneado')
      if (d.horneadas > 0 && d.sinConteo) ambar(`Ayer no se contaron las ${p.nombre.toLowerCase()} que sobraron`, 'horneado')
    }
  }

  // Café de ayer: tolva contra cafés vendidos (los dos turnos)
  if (cafe) {
    const ayer = sumar(n.hoy, -1)
    const turnos = cafe.turnos.filter((t) => t.fecha === ayer)
    const nombre = (t: { turno: string }) => (t.turno === 'TM' ? 'la mañana' : 'la tarde')
    const sinAgregado = turnos.filter((t) => t.estado === 'falta_agregado')
    if (sinAgregado.length) ambar(`Ayer la tolva de ${juntar(sinAgregado.map(nombre))} terminó con más café del que empezó: cargaron café y no lo anotaron`, 'cafe')
    const sinControl = turnos.filter((t) => t.estado === 'sin_registro' || t.estado === 'sin_cerrar')
    if (sinControl.length) ambar(`Ayer no se cerró el control de tolva de ${juntar(sinControl.map(nombre))}`, 'cafe')
    for (const t of turnos) {
      if (!fueraDeRango(t) || t.diferencia == null) continue
      const g = Math.abs(t.diferencia).toLocaleString('es-AR')
      if (t.diferencia > 0) rojo(`Ayer a ${nombre(t)} la tolva usó ${g} g de café más de lo que piden los ${t.cafes} cafés vendidos`, 'cafe')
      else ambar(`Ayer a ${nombre(t)} se vendieron cafés por ${g} g más de lo que usó la tolva: revisar el peso o las recetas`, 'cafe')
    }
  }

  // Leche: ayer sin contar y el último tramo entre conteos fuera de rango
  if (leche) {
    const ayer = sumar(n.hoy, -1)
    const sinContar = leche.leches.filter((l) => l.diasSinContar.includes(ayer))
    if (sinContar.length) ambar(`Ayer no se contó la leche (${juntar(sinContar.map((l) => l.nombre.toLowerCase()))})`, 'cafe')
    for (const l of leche.leches) {
      const i = l.intervalos[l.intervalos.length - 1]
      if (!i || !lecheFuera(i) || i.hasta.slice(0, 10) < sumar(n.hoy, -2)) continue
      const d = Math.abs(i.diferencia).toLocaleString('es-AR', { maximumFractionDigits: 1 })
      if (i.diferencia > 0) rojo(`${l.nombre}: en el último conteo se usaron ${d} l más de lo que piden los ${i.vendidos} platos vendidos`, 'cafe')
      else ambar(`${l.nombre}: las ventas piden ${d} l más de lo que se usó (¿compra sin cargar o receta de más?)`, 'cafe')
    }
  }

  return A.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'rojo' ? -1 : 1))
}
