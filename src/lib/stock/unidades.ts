// ---------------------------------------------------------------------------
// Una sola unidad por producto: kilos, litros o unidades. Nada de gramos.
// ---------------------------------------------------------------------------
// Cada producto se cuenta en su unidad (la de Fudo): kg, l o unidad. El
// 25/11/2026 se vio que en cocina contaban en gramos productos que van en
// kilos (las notas decían "800gr", "gramos"): Ternera 1 kg → 800 kg, granola
// 0,86 kg → 800 kg, tomate deshidratado → 300 kg. Ese número va también a
// Fudo, así que se ensuciaba el stock de los dos lados y las mermas daban
// millones de pesos falsos.
//
// Si un conteo en kg o l es 20 veces más grande que lo que había (o que el
// mínimo), casi seguro está en gramos o mililitros: se frena y se pregunta.
// Si de verdad es así (llegó mucha mercadería), se confirma y se guarda.
// ---------------------------------------------------------------------------

export type DudaUnidad = {
  /** Lo que sería si estaba en gramos / mililitros */
  sugerido: number
  mensaje: string
}

const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 })

/** Nombre de la unidad para mostrar al lado del número */
export function nombreUnidad(unidad: string): string {
  const u = unidad.toLowerCase()
  if (u === 'kg') return 'kilos'
  if (u === 'l') return 'litros'
  return 'unidades'
}

export function dudaDeUnidad(nombre: string, unidad: string, nuevo: number, actual: number | null | undefined, minimo: number | null | undefined): DudaUnidad | null {
  const u = unidad.toLowerCase()
  if (u !== 'kg' && u !== 'l') return null
  if (!Number.isFinite(nuevo) || nuevo < 20) return null
  const ref = Math.max(Math.abs(Number(actual ?? 0)), Number(minimo ?? 0))
  const raro = ref > 0 ? nuevo >= 20 * ref : nuevo >= 50
  if (!raro) return null
  const sugerido = Math.round(nuevo) / 1000
  const chica = u === 'kg' ? 'gramos' : 'mililitros'
  return {
    sugerido,
    mensaje: `¿${num(nuevo)} ${u} de ${nombre}? Todo se cuenta en ${nombreUnidad(u)}: ${num(nuevo)} ${chica} son ${num(sugerido)} ${u}.`,
  }
}
