import type { StockItem } from '@/lib/hooks/use-stock'
import type { StockCategoryValue } from '@/types/database'
import { type StockPriority } from '@/lib/stock/intelligence'
import type { StockAnomalyItem } from '@/lib/contracts/stock-anomalies'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SemaphoreColor = 'red' | 'yellow' | 'green'
export type StockSourceFilter = 'all' | 'fudo' | 'local' | 'unmapped'
export type StockView = 'radar' | 'conteo' | 'inventario'
export type WasteReason = 'vencido' | 'roto' | 'consumo_interno' | 'otro'
export type FudoConnectionState = 'checking' | 'ok' | 'warning' | 'error'

export const WASTE_REASON_OPTIONS: { value: WasteReason; label: string }[] = [
  { value: 'vencido',         label: 'Venció' },
  { value: 'roto',            label: 'Roto / dañado' },
  { value: 'consumo_interno', label: 'Consumo interno' },
  { value: 'otro',            label: 'Otro' },
]

// Áreas operativas: cocina maneja proteínas/verduras/etc; pastelería lo horneado.
export const AREA_FILTERS = [
  { value: 'all', label: 'Todo' },
  { value: 'cocina', label: 'Cocina' },
  { value: 'pasteleria', label: 'Pastelería' },
] as const
export type AreaFilter = (typeof AREA_FILTERS)[number]['value']
export const AREA_CATEGORIES: Record<Exclude<AreaFilter, 'all'>, string[]> = {
  cocina: ['carnes', 'verduras', 'frutas', 'lacteos', 'condimentos', 'elaborados'],
  pasteleria: ['panaderia'],
}

export type StockReviewCard = {
  id: string
  item: StockItem | null
  priority: 'critico' | 'revisar' | 'accion'
  title: string
  detail: string
  primaryAction: 'sync' | 'count' | 'configure' | 'map' | 'watch'
  actionLabel?: string
  actionHref?: string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COLORS: Record<SemaphoreColor, { text: string; bg: string; border: string; dot: string }> = {
  red: { text: 'text-[#ea504c]', bg: 'bg-[#fef2f2]', border: 'border-[#ea504c]', dot: 'bg-[#ea504c]' },
  yellow: { text: 'text-[#d4943a]', bg: 'bg-[#fdf6ec]', border: 'border-[#d4943a]', dot: 'bg-[#d4943a]' },
  green: { text: 'text-[#006d5a]', bg: 'bg-[#e8f5f1]', border: 'border-[#006d5a]', dot: 'bg-[#006d5a]' },
}

export const PERISHABLE_CATEGORIES = new Set<StockCategoryValue>([
  'bebidas',
  'lacteos',
  'carnes',
  'verduras',
  'frutas',
  'panaderia',
])

export const PRIORITY_STYLES: Record<StockPriority, string> = {
  high: 'bg-[#fef2f2] text-[#ea504c]',
  medium: 'bg-[#fdf6ec] text-[#d4943a]',
  low: 'bg-[#f3efe9] text-[#7d6c64]',
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function getSemaphore(item: StockItem): SemaphoreColor {
  if (item.current_qty === 0) return 'red'
  if (item.current_qty <= item.min_qty) return 'red'
  if (item.current_qty <= item.min_qty * 1.5) return 'yellow'
  return 'green'
}

export function isPerishableForUi(item: StockItem) {
  return Boolean(item.fudo_product_id) || PERISHABLE_CATEGORIES.has(item.category)
}

export function getStockSource(item: StockItem) {
  if (item.fudo_product_id) {
    return { label: 'Fudo producto', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true, kind: 'fudo' as const }
  }
  if (item.fudo_ingredient_id) {
    return { label: 'Fudo insumo', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true, kind: 'fudo' as const }
  }
  if (item.fudo_skip === true) {
    return { label: 'Local LVE', tone: 'bg-[#f3efe9] text-[#7d6c64]', actionable: true, kind: 'local' as const }
  }
  return { label: 'Sin mapeo Fudo', tone: 'bg-[#fef2f2] text-[#ea504c]', actionable: false, kind: 'unmapped' as const }
}

export function formatPriority(priority: StockPriority) {
  if (priority === 'high') return 'Alta'
  if (priority === 'medium') return 'Media'
  return 'Baja'
}

export function lotTone(expiresInDays: number) {
  if (expiresInDays < 0) return {
    pill: 'bg-[#fef2f2] text-[#ea504c]',
    panel: 'border-[#ea504c]/20 bg-[#fff7f7]',
  }
  if (expiresInDays <= 2) return {
    pill: 'bg-[#fdf6ec] text-[#d4943a]',
    panel: 'border-[#d4943a]/20 bg-[#fffaf2]',
  }
  return {
    pill: 'bg-[#e8f5f1] text-[#006d5a]',
    panel: 'border-[#dcefe8] bg-[#f7fcfa]',
  }
}

export function priorityFromAnomaly(anomaly: StockAnomalyItem): StockReviewCard['priority'] {
  if (anomaly.severity === 'critical') return 'critico'
  if (anomaly.severity === 'high') return 'accion'
  return 'revisar'
}

export function formatLotCountdown(expiresInDays: number) {
  if (expiresInDays < 0) return `Vencido hace ${Math.abs(expiresInDays)}d`
  if (expiresInDays === 0) return 'Vence hoy'
  if (expiresInDays === 1) return 'Vence mañana'
  return `Vence en ${expiresInDays}d`
}

export function formatQty(qty: number) {
  if (Number.isInteger(qty)) return String(qty)
  return qty.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

export function getVariance(item: StockItem, countedQty: number) {
  const diff = countedQty - item.current_qty
  const abs = Math.abs(diff)
  const pct = item.current_qty > 0 ? abs / item.current_qty : abs > 0 ? 1 : 0
  return { diff, abs, pct }
}

export function needsVarianceNote(item: StockItem, countedQty: number) {
  const { abs, pct } = getVariance(item, countedQty)
  const unit = item.unit.toLowerCase()
  const threshold = unit.includes('kg') || unit.includes('kilo')
    ? Math.max(0.5, item.current_qty * 0.12)
    : Math.max(2, item.current_qty * 0.15)
  return abs >= threshold || pct >= 0.25
}

export function getQuantityReview(item: StockItem): StockReviewCard | null {
  const source = getStockSource(item)

  if (source.kind === 'unmapped') {
    return {
      id: `unmapped:${item.id}`,
      item,
      priority: 'critico',
      title: `${item.name}: falta vínculo Fudo`,
      detail: 'No se puede corregir stock hasta vincularlo a Fudo o marcarlo como Local LVE.',
      primaryAction: 'map',
    }
  }

  if (item.current_qty < 0) {
    return {
      id: `negative:${item.id}`,
      item,
      priority: 'critico',
      title: `${item.name}: stock negativo`,
      detail: `Figura ${formatQty(item.current_qty)} ${item.unit}. Contá físicamente y corregí contra Fudo.`,
      primaryAction: 'count',
    }
  }

  if (getSemaphore(item) === 'red') {
    return {
      id: `low:${item.id}`,
      item,
      priority: 'critico',
      title: `${item.name}: stock crítico`,
      detail: `Hay ${formatQty(item.current_qty)} ${item.unit}; mínimo operativo ${formatQty(item.min_qty)}.`,
      primaryAction: 'count',
    }
  }

  const unit = item.unit.toLowerCase()
  if (item.fudo_ingredient_id && unit.includes('unidad') && !Number.isInteger(item.current_qty)) {
    return {
      id: `unit:${item.id}`,
      item,
      priority: 'revisar',
      title: `${item.name}: unidad sospechosa`,
      detail: `Figura ${formatQty(item.current_qty)} unidad. Si es fiambre/carne/lácteo por peso debería estar en kg.`,
      primaryAction: 'configure',
    }
  }

  const highStockThreshold = Math.max(item.min_qty * 4, isPerishableForUi(item) ? 12 : 80)
  if (item.current_qty >= highStockThreshold && item.current_qty > 0) {
    return {
      id: `high:${item.id}`,
      item,
      priority: isPerishableForUi(item) ? 'accion' : 'revisar',
      title: `${item.name}: cantidad alta`,
      detail: `Hay ${formatQty(item.current_qty)} ${item.unit}. Confirmá si es normal o si hay que accionar.`,
      primaryAction: 'count',
    }
  }

  return null
}
