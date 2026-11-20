// ---------------------------------------------------------------------------
// Confirmar una producción cuando en la app falta stock de un insumo
// ---------------------------------------------------------------------------
// complete_production_order (v8) frena si un insumo figura con menos stock que
// lo usado y devuelve la lista en `faltantes`. Quien confirma ve los números y
// puede "confirmar igual": el insumo queda en negativo hasta que se cargue la
// compra que faltaba. Sirve a las tres pantallas que confirman producciones.
// ---------------------------------------------------------------------------

export type Faltante = {
  stock_item_id: string
  nombre: string
  unidad: string
  disponible: number
  usado: number
  falta: number
}

const num = (n: number) => Number(Number(n).toFixed(3)).toLocaleString('es-AR')

/** Lee la lista que devuelve /complete cuando frena por stock (o cuando confirmó igual). */
export function leerFaltantes(j: unknown): Faltante[] {
  const lista = (j as { faltantes?: unknown } | null)?.faltantes
  if (!Array.isArray(lista)) return []
  return lista.filter((f): f is Faltante => !!f && typeof (f as Faltante).nombre === 'string')
}

/** "bondiola: en la app hay 4 kg y se usaron 10,6 kg" */
export function textoFaltante(f: Faltante): string {
  const u = (n: number) => (f.unidad === 'unidad' && Number(n) !== 1 ? 'unidades' : f.unidad)
  return `${f.nombre}: en la app hay ${num(f.disponible)} ${u(f.disponible)} y se usaron ${num(f.usado)} ${u(f.usado)}`
}

/** Texto para el window.confirm de las pantallas de validación. */
export function preguntaConfirmarIgual(faltantes: Faltante[]): string {
  return [
    'Falta stock en la app para confirmar esta producción:',
    ...faltantes.map((f) => `• ${textoFaltante(f)}`),
    '',
    'Si entró mercadería y no se cargó la compra, confirmala igual: ese insumo queda en negativo hasta que carguen la compra en Fudo.',
    'Si algún número está mal cargado (ej. kilos en vez de gramos), cancelá y rechazá la producción.',
    '',
    '¿Confirmar igual?',
  ].join('\n')
}

/** Aviso después de confirmar igual. */
export function avisoQuedoNegativo(faltantes: Faltante[]): string {
  return `Quedó en negativo: ${faltantes.map((f) => f.nombre).join(', ')}. Carguen la compra que falta en Fudo.`
}
