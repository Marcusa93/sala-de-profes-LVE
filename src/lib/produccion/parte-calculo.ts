// ---------------------------------------------------------------------------
// Parte de cierre de producción — las cuentas (sin base: lo usan la pantalla,
// para mostrar el rendimiento mientras se carga, y el servidor al cerrar)
// ---------------------------------------------------------------------------
// Una tarea es lo que Gastón escribe por cada materia prima:
//   entró X kg de un crudo → salieron porciones/kg de cada producto (y kg
//   cocidos si hubo cocción) → volvió algo a materia prima → desperdicio.
// Rendimiento = kg que salieron ÷ kg que se usaron (entró − volvió), contra el
// mínimo del pedido de los socios. Pasa si le falta menos de 5 g (lo que
// redondea una balanza): con 3,025 kg de nalga, 5,29 kg de milanesa pasa.
// ---------------------------------------------------------------------------

export type ControlId = 'pollo_limpio' | 'lomo_porciones' | 'vacio_limpio' | 'vacio_cocido' | 'milanesa_apanada'

export type Control = {
  nombre: string
  /** qué kilos de las salidas se comparan: los que salieron o los cocidos */
  base: 'kg' | 'kg_cocido'
  minimo: number
  /** 'pct': porcentaje del crudo; 'veces': cuántas veces el crudo (milanesa) */
  tipo: 'pct' | 'veces'
}

/** Mínimos del pedido de los socios (16/11) */
export const CONTROLES: Record<ControlId, Control> = {
  pollo_limpio: { nombre: 'Pollo limpio', base: 'kg', minimo: 0.95, tipo: 'pct' },
  lomo_porciones: { nombre: 'Lomo en porciones', base: 'kg', minimo: 0.65, tipo: 'pct' },
  vacio_limpio: { nombre: 'Vacío limpio', base: 'kg', minimo: 0.74, tipo: 'pct' },
  vacio_cocido: { nombre: 'Vacío cocido', base: 'kg_cocido', minimo: 0.64, tipo: 'pct' },
  milanesa_apanada: { nombre: 'Milanesa apanada', base: 'kg', minimo: 1.75, tipo: 'veces' },
}

export const TOLERANCIA_KG = 0.005

export type SalidaParte = {
  id: string
  /** producto de stock al que suma; null = todavía en proceso (ej. nalga en huevada) */
  stock_item_id: string | null
  nombre: string
  unidad: string | null
  porciones: number | null
  kg: number | null
  /** kg después de cocinar (pollo hervido y deshebrado, vacío cocido) */
  kg_cocido: number | null
  en_proceso: boolean
}

export type TareaParte = {
  id: string
  crudo_stock_item_id: string | null
  crudo_nombre: string
  crudo_unidad: string | null
  entrada_kg: number | null
  /** lo que volvió a materia prima sin usar (ej. nalga al freezer) */
  vuelve_kg: number | null
  desperdicio_kg: number | null
  controles: ControlId[]
  salidas: SalidaParte[]
  nota: string | null
  /** obligatorio si un rendimiento da bajo */
  motivo: string | null
  /** la producción que se creó al cerrar (para no duplicarla si se reintenta) */
  production_order_id?: number | null
}

export type ResultadoControl = {
  control: ControlId
  nombre: string
  tipo: Control['tipo']
  minimo: number
  estado: 'ok' | 'bajo' | 'sin_dato' | 'pendiente'
  valor: number | null
  /** kilos que tendrían que haber salido como mínimo */
  objetivo_kg: number | null
  real_kg: number | null
  detalle: string
}

export type CalculoTarea = {
  usado_kg: number | null
  salidas_kg: number
  en_proceso_kg: number
  /** entró − volvió − salió (solo en tareas que no agregan peso, como el apanado) */
  desperdicio_calculado: number | null
  /** si cargó el desperdicio: lo que no cierra entre entrada, salidas y desperdicio */
  diferencia_kg: number | null
  controles: ResultadoControl[]
  bajo: boolean
  /** lo que falta para poder cerrar */
  errores: string[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const kgTxt = (n: number) => `${Number(n.toFixed(3)).toLocaleString('es-AR')} kg`
const pctTxt = (n: number) => `${(n * 100).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
const vecesTxt = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} veces`

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Qué rendimiento se controla según el crudo (se puede cambiar en la tarea) */
export function controlesSugeridos(nombreCrudo: string): ControlId[] {
  const n = normalizar(nombreCrudo)
  if (/vacio/.test(n)) return ['vacio_limpio', 'vacio_cocido']
  if (/lomo/.test(n) && !/atun/.test(n)) return ['lomo_porciones']
  if (/pollo|pechuga/.test(n)) return ['pollo_limpio']
  if (/nalga/.test(n)) return ['milanesa_apanada']
  return []
}

const esMasa = (unidad: string | null) => /^(kg|g)$/i.test((unidad ?? '').trim())

export function calcularTarea(t: TareaParte): CalculoTarea {
  const errores: string[] = []
  const nombre = t.crudo_nombre || 'Tarea'
  if (!t.crudo_stock_item_id) errores.push(`${nombre}: elegí qué materia prima entró`)
  if (!(t.entrada_kg != null && t.entrada_kg > 0)) errores.push(`${nombre}: poné cuántos kilos entraron`)
  if (t.salidas.length === 0) errores.push(`${nombre}: cargá al menos una salida`)
  for (const s of t.salidas) {
    const quien = s.nombre || 'una salida'
    if (!s.en_proceso && !s.stock_item_id) errores.push(`${nombre}: elegí a qué producto va ${quien}, o marcala «en proceso»`)
    if (!(s.kg != null && s.kg > 0)) errores.push(`${nombre}: poné los kilos de ${quien}`)
    if (!s.en_proceso && s.stock_item_id && !esMasa(s.unidad) && !(s.porciones != null && s.porciones > 0)) errores.push(`${nombre}: poné cuántas porciones salieron de ${quien}`)
  }

  const entrada = t.entrada_kg ?? 0
  const vuelve = t.vuelve_kg ?? 0
  const usado = t.entrada_kg != null ? r3(entrada - vuelve) : null
  if (usado != null && usado < 0) errores.push(`${nombre}: volvió más de lo que entró`)
  const salidasKg = r3(t.salidas.reduce((a, s) => a + (s.kg ?? 0), 0))
  const enProcesoKg = r3(t.salidas.filter((s) => s.en_proceso).reduce((a, s) => a + (s.kg ?? 0), 0))
  // Un apanado agrega peso: ahí no hay desperdicio que deducir
  const agregaPeso = t.controles.some((c) => CONTROLES[c].tipo === 'veces')
  const desperdicioCalculado = usado != null && !agregaPeso ? r3(Math.max(0, usado - salidasKg)) : null
  const diferencia = usado != null && t.desperdicio_kg != null && !agregaPeso ? r3(usado - salidasKg - t.desperdicio_kg) : null

  const controles: ResultadoControl[] = t.controles.map((id) => {
    const c = CONTROLES[id]
    const base = { control: id, nombre: c.nombre, tipo: c.tipo, minimo: c.minimo }
    if (!usado || usado <= 0) return { ...base, estado: 'sin_dato', valor: null, objetivo_kg: null, real_kg: null, detalle: 'Faltan los kilos que entraron' }
    // Lo que todavía está en proceso cuenta como limpio, pero no como apanado ni cocido
    const consideradas = c.tipo === 'veces' || c.base === 'kg_cocido' ? t.salidas.filter((s) => !s.en_proceso) : t.salidas
    let real: number
    if (c.base === 'kg_cocido') {
      const conCocido = consideradas.filter((s) => s.kg_cocido != null && s.kg_cocido > 0)
      if (conCocido.length === 0) return { ...base, estado: 'sin_dato', valor: null, objetivo_kg: r3(usado * c.minimo), real_kg: null, detalle: 'Faltan los kilos cocidos' }
      real = r3(conCocido.reduce((a, s) => a + (s.kg_cocido ?? 0), 0))
    } else {
      real = r3(consideradas.reduce((a, s) => a + (s.kg ?? 0), 0))
    }
    const objetivo = r3(usado * c.minimo)
    if (real <= 0) return { ...base, estado: 'pendiente', valor: null, objetivo_kg: objetivo, real_kg: null, detalle: `Se mide cuando se termine: tienen que salir ${kgTxt(objetivo)} o más` }
    const valor = real / usado
    const ok = real >= objetivo - TOLERANCIA_KG
    const minimoTxt = c.tipo === 'pct' ? pctTxt(c.minimo) : vecesTxt(c.minimo)
    const valorTxt = c.tipo === 'pct' ? pctTxt(valor) : vecesTxt(valor)
    return {
      ...base,
      estado: ok ? 'ok' : 'bajo',
      valor,
      objetivo_kg: objetivo,
      real_kg: real,
      detalle: `${valorTxt} (${kgTxt(real)} de ${kgTxt(usado)}) · mínimo ${minimoTxt}${ok ? '' : `: faltaron ${kgTxt(objetivo - real)}`}`,
    }
  })

  const bajo = controles.some((c) => c.estado === 'bajo')
  if (bajo && !(t.motivo && t.motivo.trim().length >= 3)) errores.push(`${nombre}: el rendimiento dio bajo, escribí el motivo`)

  return { usado_kg: usado, salidas_kg: salidasKg, en_proceso_kg: enProcesoKg, desperdicio_calculado: desperdicioCalculado, diferencia_kg: diferencia, controles, bajo, errores }
}

/** Instante de la salida: la primera vez que es esa hora después de la entrada */
export function salidaDespuesDe(entrada: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const ar = new Date(entrada.getTime() - 3 * 3_600_000)
  const base = Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate(), h, m || 0) + 3 * 3_600_000
  let d = new Date(base)
  while (d.getTime() <= entrada.getTime()) d = new Date(d.getTime() + 86_400_000)
  return d
}
