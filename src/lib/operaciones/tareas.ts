import { aMin, dow, idxSemana, lunes, sumar, ultimoDia, type Ahora } from './fechas'

// ---------------------------------------------------------------------------
// Tareas del Jefe de Operaciones (del perfil del puesto) — Santa Fe
// ---------------------------------------------------------------------------
// Las mismas del tablero que usaba en claude.ai. Lo de cada local va solo de
// Santa Fe: la 24 tiene su propio control en su app. Los ids no se cambian:
// son la clave de lo tildado en operaciones_checks.
// "sup": fecha supuesta, a confirmar con Marco.
// ---------------------------------------------------------------------------

export type TareaDiaria = { id: string; t: string; d: string; h: string; caja?: boolean }
export type TareaSemanal = { id: string; t: string; d: string; dow: number; h: string; sup?: boolean }
export type TareaMensual = { id: string; t: string; d: string; dia: number | 'fin'; sup?: boolean }
/** done = hecha · late = vencida · soon = vence pronto · prev = venció antes de empezar a usar el control */
export type EstadoTarea = 'done' | 'late' | 'soon' | 'prev' | ''

export const DIARIAS: TareaDiaria[] = [
  { id: 'd1', t: 'Cierre de ayer en Fudo', d: 'Caja, arqueo y diferencias de Santa Fe. Toda diferencia se explica hoy.', h: '11:00', caja: true },
  { id: 'd3', t: 'Bancos', d: 'Saldos y movimientos de ICBC, Macro y BBVA. Débitos raros, al toque a Marco.', h: '11:00' },
  { id: 'd4', t: 'Cobros', d: 'Que Payway y PedidosYa se estén acreditando.', h: '14:00' },
  { id: 'd6', t: 'Encargados', d: 'Faltantes, incidentes y novedades del personal. Al registro de incidentes.', h: '14:00' },
  { id: 'd2', t: 'PedidosYa a día vencido', d: 'Durante el servicio: pedidos, total en Fudo, rechazos, demoras y productos pausados de la noche anterior.', h: '20:30' },
  { id: 'd5', t: 'Compras del día', d: 'Cargadas en Fudo con comprobante. Compra de urgencia en El Puesto: avisar a Marco.', h: '20:30' },
  { id: 'd7', t: 'Pendientes de socios', d: 'Mover lo que vence. Lo trabado se escala hoy.', h: '20:30' },
]

export const SEMANALES: TareaSemanal[] = [
  { id: 's1', t: 'Reporte a los socios', d: 'PDF al grupo: resuelto, escalado, bancos, pagos, personal contra venta, PedidosYa.', dow: 1, h: '20:00' },
  { id: 's2', t: 'Control semanal', d: 'Ventas contra facturación, gastos contra comprobantes, cobros contra banco. Saldos a pagar y posición de caja para Marco y Bruno.', dow: 1, h: '23:59' },
  { id: 's3', t: 'Pago a proveedores', d: 'Cargar transferencias con respaldo, Marco aprueba. Registrar pagos y actualizar eCheq.', dow: 2, h: '14:00' },
  { id: 's4', t: 'Reuniones', d: 'Tramo de operación con los socios, después encargados para bajar lo decidido.', dow: 2, h: '23:59' },
  { id: 's5', t: 'Liquidación de PedidosYa', d: 'Contra Fudo y contra banco. Reclamos y calificaciones de la semana.', dow: 3, h: '20:30', sup: true },
  { id: 's8', t: 'Lanzamientos y redes', d: 'Avisar a Franco qué sale. Que esté cargado en Fudo y PedidosYa y que el equipo lo sepa.', dow: 4, h: '20:30', sup: true },
  { id: 's6', t: 'Personal', d: 'Horarios y planilla de horas de Santa Fe. Consumo de personal ($20.000 por día).', dow: 5, h: '20:30', sup: true },
  { id: 's7', t: 'Stock', d: 'Con Meli: control hecho en Santa Fe, conectado con Sala de Profes y Fudo.', dow: 6, h: '14:00', sup: true },
]

export const MENSUALES: TareaMensual[] = [
  { id: 'm2', t: 'Sueldos', d: 'Liquidación con las horas de Sala de Profes. Marco aprueba, después se pagan.', dia: 4, sup: true },
  { id: 'm1', t: 'Cierre del mes', d: 'Conciliar bancos, Payway, PedidosYa y proveedores. Pasarle al estudio lo que pida.', dia: 10 },
  { id: 'm5', t: 'Vencimientos', d: 'Impuestos, servicios y alquiler de Santa Fe.', dia: 10, sup: true },
  { id: 'm3', t: 'Estado de resultados', d: 'Ventas por canal, mercadería, sueldos, fijos, resultado. PedidosYa neto aparte.', dia: 10 },
  { id: 'm9', t: 'Resultado de acciones comerciales', d: 'Cuánto vendió cada promo o plato nuevo, por canal. A socios y a Franco.', dia: 10 },
  { id: 'm4', t: 'Reunión con Marco', d: 'El mes en LVE Finanzas y la evaluación.', dia: 15 },
  { id: 'm8a', t: 'Consumo teórico · 1ª quincena', d: 'Compras y stock contra lo vendido.', dia: 15 },
  { id: 'm7', t: 'Recetas y márgenes', d: 'Cargar recetas en Fudo y marcar platos con margen bajo. Los precios los fijan los socios.', dia: 20, sup: true },
  { id: 'm6', t: 'Inventario de fin de mes', d: 'En Santa Fe.', dia: 'fin' },
  { id: 'm8b', t: 'Consumo teórico · 2ª quincena', d: 'Compras y stock contra lo vendido.', dia: 'fin' },
]

const IDS = new Set([...DIARIAS, ...SEMANALES, ...MENSUALES].map((t) => t.id))
/** ¿Esa tarea corresponde a ese tipo de período? (d1 con 'd:…', s3 con 's:…') */
export const tareaValida = (periodo: string, tarea: string) => IDS.has(tarea) && periodo.charAt(0) === tarea.charAt(0)

export function estDiaria(t: TareaDiaria, n: Ahora, hecho: boolean): EstadoTarea {
  if (hecho) return 'done'
  const l = aMin(t.h)
  if (n.min > l) return 'late'
  if (n.min > l - 60) return 'soon'
  return ''
}

export const venceSem = (t: TareaSemanal, hoy: string) => sumar(lunes(hoy), idxSemana(t.dow) - 1)

export function estSemanal(t: TareaSemanal, n: Ahora, hecho: boolean, inicio: string): EstadoTarea {
  if (hecho) return 'done'
  if (inicio && venceSem(t, n.hoy) < inicio) return 'prev'
  const c = idxSemana(n.dow), v = idxSemana(t.dow)
  if (c > v || (c === v && n.min > aMin(t.h))) return 'late'
  if (c === v) return 'soon'
  return ''
}

export const diaM = (t: TareaMensual, n: Ahora) => (t.dia === 'fin' ? ultimoDia(n.y, n.mo) : t.dia)

export function estMensual(t: TareaMensual, n: Ahora, hecho: boolean, inicio: string): EstadoTarea {
  if (hecho) return 'done'
  const v = diaM(t, n)
  if (inicio && `${n.hoy.slice(0, 8)}${String(v).padStart(2, '0')}` < inicio) return 'prev'
  if (n.d > v) return 'late'
  if (v - n.d <= 3) return 'soon'
  return ''
}

/**
 * Días de caja que se revisan hoy: el cierre de ayer. El lunes, el sábado y el
 * domingo (el domingo no hay tareas, así que el sábado se revisa el lunes).
 */
export function diasDeCaja(n: Ahora): string[] {
  if (n.dow === 0) return []
  if (n.dow === 1) return [sumar(n.hoy, -2), sumar(n.hoy, -1)]
  return [sumar(n.hoy, -1)]
}

export const esDomingo = (s: string) => dow(s) === 0
