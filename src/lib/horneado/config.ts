// ---------------------------------------------------------------------------
// Control de horneado — qué se controla y cómo se cuenta en Fudo
// ---------------------------------------------------------------------------
// Medialunas, bollitos y tortillas vienen congelados y se hornean en tandas.
// Lo que sale de cada uno, según Fudo (ids de producto de Santa Fe, 23/11):
//   · venta: el producto suelto (y la medialuna de jamón y queso, que lleva una)
//   · opcion: elegido dentro de un combo (el Clásico trae 2 a elegir)
//   · personal: lo que consume el equipo
// Se usa igual en el servidor y en el navegador.
// ---------------------------------------------------------------------------

export type Pieza = 'medialuna' | 'bollito' | 'tortilla'
export type TipoRegistro = 'tanda' | 'sobrante' | 'budin' | 'tirado'

// insumo: el ingrediente de Fudo (las cajas congeladas que se compran). Lo que se
// tira o va al budín se descuenta de ahí como merma.
export const PIEZAS: { pieza: Pieza; nombre: string; singular: string; venta: string[]; opcion: string[]; personal: string[]; insumo: string; umbral: number }[] = [
  // Medialuna, Medialuna JyQ, Medialuna Peya, Medialuna j&q peya · en el Clásico · personal
  { pieza: 'medialuna', nombre: 'Medialunas', singular: 'medialuna', venta: ['86', '100', '369', '382'], opcion: ['86'], personal: ['116'], insumo: '377', umbral: 4 },
  // Bollito, Bollito peya · en el Clásico · Bollito Personal
  { pieza: 'bollito', nombre: 'Bollitos', singular: 'bollito', venta: ['87', '381'], opcion: ['87'], personal: ['182'], insumo: '376', umbral: 2 },
  // Tortilla Fina, Tortilla fina peya · en el Clásico · personal (la vieja inactiva también)
  { pieza: 'tortilla', nombre: 'Tortillas', singular: 'tortilla', venta: ['81', '380'], opcion: ['81'], personal: ['181', '340'], insumo: '505', umbral: 2 },
]

/** Budín de pan: suelto y como postre de los menús (para ver si las sobrantes de verdad salen) */
export const BUDIN_DE_PAN = '64'

/** Lo que sale del stock sin venderse: se descuenta en Fudo como merma */
export const MERMA_EN_FUDO: ReadonlySet<TipoRegistro> = new Set(['tirado', 'budin'])

export const ETIQUETA_TIPO: Record<TipoRegistro, string> = {
  tanda: 'Tanda horneada',
  sobrante: 'Sobraron al cierre',
  budin: 'Al budín de pan',
  tirado: 'Se tiraron',
}

/** Desde cuándo se cargan las tandas: antes no hay con qué cruzar (el 24/11 no se cargó nada) */
export const INICIO_HORNEADO = '2026-11-25'

/** Parte de lo del día que conviene hornear a la mañana (el resto, a la tarde si hace falta) */
export const PARTE_MANANA = 0.6

export type Registro = {
  id: string
  fecha: string
  pieza: Pieza
  tipo: TipoRegistro
  cantidad: number
  nota: string | null
  created_by: string | null
  created_at: string
  /** Se descontó del insumo en Fudo (sin la migración 20261126 no viene) */
  descontado_en_fudo?: boolean
}

/** Cuántas hornear: promedio de lo que salió ese día de la semana, redondeado para arriba */
export type Recomendado = { total: number; manana: number; tarde: number; semanas: number }

/** Balance de un día: lo que entró contra lo que salió */
export type BalanceDia = {
  fecha: string
  horneadas: number
  /** Lo que quedó al cierre del día anterior */
  sobranteAyer: number | null
  vendidas: number
  personal: number
  budin: number
  tirado: number
  /** Lo que quedó al cierre (null = no se contó) */
  sobrante: number | null
  /** horneadas + sobró ayer − (vendidas + personal + budín + tiradas + sobró hoy). Positivo: faltan. Negativo: salieron más de las cargadas. */
  diferencia: number
  sinTandas: boolean
  sinConteo: boolean
  /** Antes de empezar a cargar las tandas: no se controla */
  antesDelControl: boolean
}

export type ControlHorneado = {
  desde: string
  hasta: string
  piezas: { pieza: Pieza; nombre: string; singular: string; umbral: number; dias: BalanceDia[]; recomendadoSemana: Record<number, Recomendado> }[]
  /** Porciones de budín de pan vendidas por día (suelto y en menús) */
  budinVendido: Record<string, number>
  falta_migracion: boolean
}
