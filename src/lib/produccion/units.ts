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
