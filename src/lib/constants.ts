import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type RoleConfig = {
  color: string
  emoji: string
  label: string
}

export const ROLES: Record<AppRole, RoleConfig> = {
  encargado: { color: '#8B4513', emoji: '☕', label: 'Encargado' },
  chef: { color: '#D2691E', emoji: '👨‍🍳', label: 'Chef' },
  barista: { color: '#CD853F', emoji: '🧋', label: 'Barista' },
  runner: { color: '#DEB887', emoji: '🏃', label: 'Runner' },
  cocina: { color: '#F4A460', emoji: '🍳', label: 'Cocina' },
} as const

export const ROLE_OPTIONS = Object.entries(ROLES).map(([value, config]) => ({
  value: value as AppRole,
  label: `${config.emoji} ${config.label}`,
  color: config.color,
}))

// ---------------------------------------------------------------------------
// Announcement types
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_TYPES = {
  general: { label: 'General', icon: '📢' },
  urgent: { label: 'Urgente', icon: '🚨' },
  menu: { label: 'Menú', icon: '📋' },
  event: { label: 'Evento', icon: '🎉' },
  maintenance: { label: 'Mantenimiento', icon: '🔧' },
} as const

export type AnnouncementType = keyof typeof ANNOUNCEMENT_TYPES

export const ANNOUNCEMENT_TYPE_OPTIONS = Object.entries(ANNOUNCEMENT_TYPES).map(
  ([value, config]) => ({
    value: value as AnnouncementType,
    label: `${config.icon} ${config.label}`,
  }),
)

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

export const PRIORITIES = {
  low: { label: 'Baja', color: '#22c55e' },
  medium: { label: 'Media', color: '#f59e0b' },
  high: { label: 'Alta', color: '#ef4444' },
  critical: { label: 'Crítica', color: '#dc2626' },
} as const

export type Priority = keyof typeof PRIORITIES

export const PRIORITY_OPTIONS = Object.entries(PRIORITIES).map(
  ([value, config]) => ({
    value: value as Priority,
    label: config.label,
    color: config.color,
  }),
)

// ---------------------------------------------------------------------------
// Stock categories
// ---------------------------------------------------------------------------

export const STOCK_CATEGORIES = {
  bebidas: { label: 'Bebidas', icon: '🥤' },
  lacteos: { label: 'Lácteos', icon: '🥛' },
  carnes: { label: 'Carnes', icon: '🥩' },
  verduras: { label: 'Verduras', icon: '🥬' },
  frutas: { label: 'Frutas', icon: '🍎' },
  panaderia: { label: 'Panadería', icon: '🍞' },
  condimentos: { label: 'Condimentos', icon: '🧂' },
  limpieza: { label: 'Limpieza', icon: '🧹' },
  desechables: { label: 'Desechables', icon: '🥡' },
  otros: { label: 'Otros', icon: '📦' },
} as const

export type StockCategory = keyof typeof STOCK_CATEGORIES

export const STOCK_CATEGORY_OPTIONS = Object.entries(STOCK_CATEGORIES).map(
  ([value, config]) => ({
    value: value as StockCategory,
    label: `${config.icon} ${config.label}`,
  }),
)

// ---------------------------------------------------------------------------
// Stock units
// ---------------------------------------------------------------------------

export const STOCK_UNITS = [
  { value: 'kg', label: 'Kilogramos' },
  { value: 'g', label: 'Gramos' },
  { value: 'l', label: 'Litros' },
  { value: 'ml', label: 'Mililitros' },
  { value: 'unidad', label: 'Unidades' },
  { value: 'paquete', label: 'Paquetes' },
  { value: 'caja', label: 'Cajas' },
  { value: 'bolsa', label: 'Bolsas' },
] as const

// ---------------------------------------------------------------------------
// Alert types
// ---------------------------------------------------------------------------

export const ALERT_TYPES = {
  low_stock: { label: 'Stock bajo', color: '#f59e0b' },
  out_of_stock: { label: 'Sin stock', color: '#ef4444' },
  expiring_soon: { label: 'Por vencer', color: '#f97316' },
} as const

export type AlertType = keyof typeof ALERT_TYPES
