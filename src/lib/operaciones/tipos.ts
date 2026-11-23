// ---------------------------------------------------------------------------
// Tipos del control interno de operaciones (los usan la API y la pantalla)
// ---------------------------------------------------------------------------

/** Encargados a los que Joaquín puede delegar un pedido */
export const ENCARGADOS = ['Noelia Andrada', 'Ricardo Marquez'] as const
/** Quién pidió */
export const QUIENES = ['Marco', 'Bruno', 'Franco', 'Otro socio'] as const

export type Check = { periodo: string; tarea: string; hecho_por: string | null; hecho_at: string }

export type CajaDia = {
  fecha: string
  diferencia: number | null
  motivo: string | null
  cargado_por: string | null
  updated_at: string
}

export type Seguimiento = { id: string; pedido_id: string; texto: string; created_by: string | null; created_at: string }

export type PedidoSocio = {
  id: string
  que: string
  pedido_por: string
  /** null = lo hace Joaquín */
  delegado_a: string | null
  delegado_at: string | null
  vence: string
  compromiso: string | null
  respondido: boolean
  respondido_at: string | null
  estado: 'abierto' | 'delegado' | 'hecho'
  resultado: 'cumplido' | 'no_cumplido' | null
  cerrado: string | null
  a_tiempo: boolean | null
  reprogramado: number
  created_by: string | null
  created_at: string
  updated_at: string
  seguimiento: Seguimiento[]
}

export type DatosOperaciones = {
  /** ¿Puede tildar, cargar la caja y mover pedidos? (Joaquín) Si no, solo ve y anota pedidos. */
  puede_editar: boolean
  /** Desde cuándo se usa el control: lo que venció antes no cuenta */
  inicio: string
  falta_migracion: boolean
  checks: Check[]
  caja: CajaDia[]
  pedidos: PedidoSocio[]
  /** id → nombre, para mostrar quién hizo cada cosa */
  nombres: Record<string, string>
  yo: string
}

export type VentasOperaciones = {
  /** Día operativo de ayer */
  ayer: string
  dias: { fecha: string; total: number; tickets: number }[]
  error: string | null
}

/** Cambios posibles de un pedido */
export const CAMBIOS_PEDIDO = ['respondido', 'no_respondido', 'delegar', 'compromiso', 'cumplido', 'no_cumplido', 'reprogramar', 'reabrir', 'borrar'] as const
export type CambioPedido = (typeof CAMBIOS_PEDIDO)[number]
