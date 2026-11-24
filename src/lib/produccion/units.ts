// ---------------------------------------------------------------------------
// Conversión de unidades para producción.
// El RPC complete_production_order suma/resta contra stock_items.current_qty
// en la unidad del item de stock, así que toda cantidad debe normalizarse a
// esa unidad ANTES de insertarse en production_inputs / production_outputs.
// ---------------------------------------------------------------------------

const MASS_TO_KG: Record<string, number> = { kg: 1, g: 0.001 }
// El stock usa 'l'; la UI de producción históricamente usó 'lt'.
const VOLUME_TO_L: Record<string, number> = { l: 1, lt: 1, litro: 1, ml: 0.001 }

function norm(unit: string | null | undefined): string {
  return String(unit ?? '').trim().toLowerCase()
}

/**
 * Unidad tipeada dentro de una cantidad libre ('500 g', '2,5 kg', '3 un').
 * Devuelve la unidad canónica ('g', 'kg', 'l', 'ml', 'lt', 'unidad') o null si
 * no trae unidad. Es la MISMA regla en cliente y server: la conversión de
 * verdad la hace convertQty/normalizeToStockUnit.
 */
export function parseTypedUnit(raw: string | null | undefined): string | null {
  const m = String(raw ?? '').toLowerCase().match(/\b(kg|g|gr|lt|l|ml|unidad(?:es)?|un|u)\b/)
  if (!m) return null
  const u = m[1]
  if (u === 'u' || u === 'un' || u.startsWith('unidad')) return 'unidad'
  if (u === 'gr') return 'g'
  return u
}

/**
 * Convierte qty de una unidad a otra. Devuelve null si las unidades no son
 * compatibles (ej. kg → unidad), en cuyo caso el caller debe rechazar.
 */
export function convertQty(qty: number, fromUnit: string, toUnit: string): number | null {
  const f = norm(fromUnit)
  const t = norm(toUnit)
  if (!f || !t || f === t) return qty
  if (f in MASS_TO_KG && t in MASS_TO_KG) return (qty * MASS_TO_KG[f]) / MASS_TO_KG[t]
  if (f in VOLUME_TO_L && t in VOLUME_TO_L) return (qty * VOLUME_TO_L[f]) / VOLUME_TO_L[t]
  return null
}

/**
 * Normaliza una cantidad a la unidad del item de stock.
 * Devuelve { ok: true, qty, unit } listo para persistir, o { ok: false, error }.
 */
export function normalizeToStockUnit(
  qty: number,
  unit: string,
  stockItem: { name: string; unit: string },
): { ok: true; qty: number; unit: string } | { ok: false; error: string } {
  const converted = convertQty(qty, unit, stockItem.unit)
  if (converted == null) {
    return {
      ok: false,
      error: `${stockItem.name}: la unidad "${unit}" no es convertible a "${stockItem.unit}" (unidad del stock). Cargalo en ${stockItem.unit}.`,
    }
  }
  return { ok: true, qty: Math.round(converted * 1000) / 1000, unit: stockItem.unit }
}

// ---------------------------------------------------------------------------
// Producción se carga siempre en la unidad grande (Marco, 24/11/2026)
// ---------------------------------------------------------------------------
// Kilos, litros o unidades: nunca gramos ni mililitros. Con una lista de
// unidades para elegir pasaba "250 litros de aceite" cuando eran 250 ml (#67)
// o 105 kg de levadura. Ahora la unidad es la del producto en el stock, fija,
// y abajo del número se ve la equivalencia en chico ("= 250 ml").
// ---------------------------------------------------------------------------

/** Las únicas unidades con las que se carga producción */
export const UNIDADES_PRODUCCION = ['kg', 'l', 'unidad'] as const

const SINONIMOS: Record<string, string> = {
  gr: 'g', gramos: 'g', kilo: 'kg', kilos: 'kg',
  cc: 'ml', lt: 'l', litro: 'l', litros: 'l',
  u: 'unidad', un: 'unidad', unid: 'unidad', unidades: 'unidad',
  // Las porciones se cuentan como unidades (milanesas, sorrentinos…)
  'porción': 'unidad', porcion: 'unidad', porciones: 'unidad',
}
const GRANDE: Record<string, string> = { g: 'kg', kg: 'kg', ml: 'l', l: 'l', unidad: 'unidad' }

/** La unidad grande de una unidad: g → kg, ml → l, lt → l, u → unidad */
export function unidadGrande(unit: string | null | undefined): string {
  const base = SINONIMOS[norm(unit)] ?? norm(unit)
  return GRANDE[base] ?? (base || 'kg')
}

/** La cantidad pasada a la unidad grande (250 g → 0,25 kg) */
export function aUnidadGrande(qty: number, unit: string | null | undefined): { qty: number; unit: string } {
  const base = SINONIMOS[norm(unit)] ?? norm(unit)
  const grande = GRANDE[base]
  if (!grande) return { qty, unit: base || 'kg' }
  const convertida = convertQty(qty, base, grande)
  return convertida == null ? { qty, unit: base } : { qty: Math.round(convertida * 100000) / 100000, unit: grande }
}

/** `qty` en `unidad` pasada a `destino` (con sinónimos: gr, lt, porción…); null si no se puede (kg → unidad) */
export function aUnidadDe(qty: number, unidad: string | null | undefined, destino: string): number | null {
  const desde = SINONIMOS[norm(unidad)] ?? norm(unidad)
  const hacia = SINONIMOS[norm(destino)] ?? norm(destino)
  if (!desde) return qty
  return convertQty(qty, desde, hacia)
}

/**
 * Lo mismo en la unidad chica, para leerlo de un vistazo: 0,25 kg → "= 250 g",
 * 250 l → "= 250000 ml". null si no aplica (unidades, vacío).
 */
export function equivalenciaChica(qty: number, unit: string | null | undefined): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return null
  // Solo si la cantidad YA está en kg o l (una en g no tiene "unidad chica")
  const u = SINONIMOS[norm(unit)] ?? norm(unit)
  const chica = u === 'kg' ? 'g' : u === 'l' ? 'ml' : null
  if (!chica) return null
  // Sin punto de miles: "2.314 kg = 2.314 g" se leía igual; "= 2314 g" no
  return `= ${(qty * 1000).toLocaleString('es-AR', { maximumFractionDigits: 1, useGrouping: false })} ${chica}`
}
