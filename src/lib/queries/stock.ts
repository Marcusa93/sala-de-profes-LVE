import { createAdminClient } from '@/lib/supabase/admin'

// Field presets
const FIELDS = {
  minimal: 'id, name, unit, current_qty' as const,
  summary: 'id, name, unit, current_qty, min_qty, category' as const,
  full: 'id, name, unit, current_qty, min_qty, category, is_active, is_produced, supplier_id, fudo_ingredient_id, fudo_product_id, fudo_skip, cost_per_unit, shelf_life_days, purchase_lead_time_days, notes, updated_at' as const,
  withSupplier: 'id, name, unit, current_qty, min_qty, category, is_active, supplier_id, fudo_ingredient_id, fudo_product_id, fudo_skip, shelf_life_days, purchase_lead_time_days, notes, updated_at, suppliers(id, name, phone, email)' as const,
} as const

type FieldPreset = keyof typeof FIELDS

/**
 * Centralized stock items query.
 * Avoids duplicating .from('stock_items').select(...) across 15+ files.
 *
 * @param preset - Field set to select: 'minimal' | 'summary' | 'full' | 'withSupplier'
 * @param options.activeOnly - Filter to is_active=true (default: true)
 */
export async function getStockItems(
  preset: FieldPreset = 'summary',
  options: { activeOnly?: boolean } = {},
) {
  const { activeOnly = true } = options
  const admin = createAdminClient()
  let query = admin.from('stock_items').select(FIELDS[preset])
  if (activeOnly) query = query.eq('is_active', true)
  query = query.order('name')
  return query
}

/**
 * Get a single stock item by ID.
 */
export async function getStockItem(id: string, preset: FieldPreset = 'summary') {
  const admin = createAdminClient()
  return admin.from('stock_items').select(FIELDS[preset]).eq('id', id).single()
}

/**
 * Get stock items by IDs.
 */
export async function getStockItemsByIds(ids: string[], preset: FieldPreset = 'summary') {
  if (ids.length === 0) return { data: [], error: null }
  const admin = createAdminClient()
  return admin.from('stock_items').select(FIELDS[preset]).in('id', ids)
}

export { FIELDS as STOCK_FIELDS }
