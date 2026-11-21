import { getNavItems } from '@/lib/navegacion'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Guía de la app para La Vieja de Historia
// ---------------------------------------------------------------------------
// Dos partes:
//   1. El MENÚ real del rol (sale de lib/navegacion, el mismo que dibuja la
//      barra de abajo): así guía con el camino exacto y nunca inventa pantallas.
//   2. CÓMO SE HACE cada tarea frecuente, filtrado por rol. Si cambia un
//      circuito (producción, stock, protocolos), se actualiza acá.
// ---------------------------------------------------------------------------

type Rol = AppRole | string

const GESTION = ['socio', 'encargado']
const COCINA = ['socio', 'encargado', 'chef', 'cocina']
const TODOS = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha', 'cajero']

/** El menú tal cual lo ve ese rol: barra de abajo y "Más" agrupado. */
export function menuDelRol(role: Rol): string {
  const nav = getNavItems(role as AppRole)
  const barra = nav.items.map((i) => `${i.label} (${i.href})`).join(' · ')
  const grupos = (nav.more?.groups ?? []).map((g) =>
    `  ${g.label}:\n${g.items.map((i) => `    - ${i.label} (${i.href})${i.description ? `: ${i.description}` : ''}`).join('\n')}`,
  ).join('\n')
  return `Barra de abajo: ${barra}${grupos ? `\nBotón "Más" (abajo a la derecha):\n${grupos}` : ''}`
}

type Tema = { roles: string[]; titulo: string; texto: string }

const TEMAS: Tema[] = [
  // ── Producción ──
  {
    roles: COCINA,
    titulo: 'Cómo funciona la producción (circuito completo)',
    texto: `1) Lista y mínimos (/cocina/lista): qué produce la cocina y cuánto tiene que haber como mínimo en Santa Fe y en la 24. La editan solo Marco y Joaquín; el resto la ve.
2) Qué producir (/cocina/a-producir): lo que falta para llegar al mínimo de Santa Fe más lo que le falta a la 24, menos lo que ya se cargó y falta confirmar. Cada producto tiene «Lo hice». Si la Lista y mínimos está vacía, esta pantalla no muestra nada.
3) Registrar lo producido: «Lo hice» (en Qué producir, o en Elaborados: Más → Contar elaborados → pestaña «Elaborados») registra una tanda usando la receta de producción. El encargado de producción de la noche (Gastón) usa el Parte de cierre (/cocina/parte): hora de entrada y salida y, por cada tarea, qué materia prima entró y cuántos kilos, qué salió (porciones y kilos) y el desperdicio. Al cerrar el parte se crean las producciones para confirmar. Lo que va en el parte NO se carga también en «Nueva producción», porque queda duplicado.
4) Confirmar: una producción la confirma OTRA persona (jefa de cocina, encargado o socio), nunca quien la cargó. Hasta que se confirma, el stock no cambia. Se confirma en Lo de hoy · Cocina (/cocina/lo-de-hoy), paso 1, con los botones «Está todo», «Falta algo» (se corrige cuánto salió de verdad) o «No está» (se rechaza con el motivo). Los encargados y socios también pueden abrir la producción en Producción (/cocina/produccion) y tocar «Validar y sync Fudo», o usar Stock → Producción (/stock/produccion).
5) Si en la app hay menos stock de un insumo que lo que se usó, la app muestra qué falta y aparece «Confirmar igual»: se confirma y ese insumo queda en negativo hasta que se cargue en Fudo la compra que faltaba. Si un número está mal cargado (por ejemplo 105 kg de levadura en vez de 105 g), no se confirma: se rechaza y se avisa a quien la cargó.
6) Al cierre, en Lo de hoy: paso 2, conteo de cierre (lo que hay de verdad de cada producto de la Lista); paso 3, merma (lo que se tira y el consumo del personal). Hay además un conteo de todos los elaborados en Más → Contar elaborados (/cocina/elaborados?tab=contar).
7) Enviar a la 24 (/cocina/envios): se arma el envío (los elaborados aparecen primero). Cuando la 24 lo acepta se descuenta de Santa Fe. Abajo están los envíos recientes y en qué quedaron (en camino, llegó, llegó con faltantes, anulado). Mientras está en camino se puede anular y el stock vuelve.`,
  },
  {
    roles: COCINA,
    titulo: 'Ver las producciones cargadas',
    texto: 'Producción (/cocina/produccion) lista todas las órdenes con su estado: borrador, para confirmar, confirmada, rechazada o anulada. Tocando una se ve el detalle (qué entró, qué salió, quién la cargó y quién la confirmó). Para encargados y socios, la vista con costos y rendimientos está en Stock → Producción (/stock/produccion).',
  },
  {
    roles: COCINA,
    titulo: 'Recetas',
    texto: 'Hay dos tipos. La receta de PRODUCCIÓN (qué lleva un elaborado, por ejemplo una tanda de bondiola braseada) se ve y se carga en Elaborados (/cocina/elaborados; desde el menú: Contar elaborados → pestaña «Elaborados»). El Recetario de platos (/recetario) es la ficha de cada plato de la carta por porción: sirve para el costo, el margen y el armado.',
  },
  // ── Stock y compras ──
  {
    roles: COCINA,
    titulo: 'Stock',
    texto: `Stock (/stock; la cocina entra por Más → Stock cocina): todo el inventario con semáforo (🔴 por debajo del mínimo, 🟡 cerca, 🟢 bien), filtrable por área; tocando un insumo se ve su detalle y sus movimientos. Fudo es la fuente: lo que se vende y las compras cargadas en Fudo se reflejan solos. Para contar: botón verde «Conteo guiado» abajo en Stock (/stock/conteo); cada número que se confirma se escribe en Fudo. Los encargados y socios tienen además, dentro de Stock, Rendimiento, Historial, Consumo, Producción (validar y costos) y Precios de compra.`,
  },
  {
    roles: GESTION,
    titulo: 'Compras y pedidos',
    texto: 'Compras (/pedidos) tiene tres pasos: PEDIR (sugiere qué y cuánto por proveedor; se manda por WhatsApp y queda «en camino»), EN CAMINO (cuando la compra se carga en Fudo, en Gastos, aparece acá y «Llegó» cierra el pedido sin volver a sumar stock) y RECIBIDOS (el historial). Cuentas por pagar: /pedidos/cuentas. Gastos por período y proveedor: /pedidos/gastos.',
  },
  {
    roles: TODOS,
    titulo: 'Avisar que algo se está acabando',
    texto: 'Sugerir compra (/sugerir-compra): cualquiera avisa lo que se acaba, pegando la lista como en WhatsApp o de a uno. Es una sugerencia para el encargado; no hace el pedido.',
  },
  // ── Protocolos y tareas ──
  {
    roles: TODOS,
    titulo: 'Protocolos (tareas con horario)',
    texto: 'Protocolos (/protocolos): tareas con hora fija (limpieza del baño, control de tolva, control de descartables y conteo de elaborados después de producir). Cada tarea se asigna a alguien que esté en turno. Cuando llega la hora aparece un aviso rojo abajo en la pantalla. Se cierra marcando todos los pasos y sacando las fotos que pide. La cierra quien la tiene asignada o un encargado. Si quedó atrasada, el encargado se la puede pasar a quien está trabajando ahora.',
  },
  // ── Personal ──
  {
    roles: TODOS,
    titulo: 'Fichar, horarios y avisos',
    texto: 'Fichar entrada y salida: Mi Turno (/mi-turno). Pide permiso de ubicación porque hay que estar en el local. No se puede fichar por el chat. Mis turnos: Horarios (/mis-horarios). Avisos del equipo: Avisos (/notificaciones). Cambiar la contraseña propia: /cambiar-clave.',
  },
  {
    roles: GESTION,
    titulo: 'Equipo: altas, bajas, roles y turnos',
    texto: 'Equipo y turnos (/equipo): quién está hoy y la lista del personal. Tocando a una persona se abre su ficha (/equipo/[id]): ahí se cambian el rol y los datos, se la pasa a «Inactivo» (baja: deja de entrar a la app y no se borra su historial) y se cambian el email o la contraseña con la que entra. Turnos de la semana: /equipo/turnos (para cargar, /equipo/turnos/cargar). Asistencia de hoy y correcciones de fichajes: /equipo/asistencia. Liquidación de horas: /admin/reportes/liquidacion.',
  },
  {
    roles: ['socio'],
    titulo: 'Ventas y reportes',
    texto: 'Ventas (/ventas): facturación y tickets que vienen de Fudo (solo socios). Reportes (/admin/reportes): food cost, márgenes, ventas, stock y turnos por período.',
  },
  {
    roles: ['socio', 'encargado', 'barista'],
    titulo: 'Barra',
    texto: 'Tolva (/tolva): el cuaderno de la tolva de café por turno (inicio, agregado y final; el consumo se calcula solo). Descartables (vasos y tapas): se cuentan desde Stock, área descartables, y se descuentan solos al vender para llevar.',
  },
  {
    roles: TODOS,
    titulo: 'Vajilla',
    texto: 'Vajilla (/vajilla): se cargan las roturas y los faltantes y se controla la reposición.',
  },
]

/** Guía completa para el rol: menú + cómo se hace cada cosa. */
export function guiaDeLaApp(role: Rol): string {
  const temas = TEMAS.filter((t) => t.roles.includes(role) || role === 'socio')
  return `MAPA DE LA APP PARA ESTE USUARIO (rol ${role}). Es el menú real: guiá SOLO con estas pantallas y caminos.
${menuDelRol(role)}

CÓMO SE HACE CADA COSA:
${temas.map((t) => `### ${t.titulo}\n${t.texto}`).join('\n\n')}`
}
