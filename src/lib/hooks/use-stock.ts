'use client'

import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { SWR_KEYS } from '@/lib/swr/keys'
import type { StockCategoryValue } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StockItem = {
  id: string
  name: string
  category: StockCategoryValue
  unit: string
  current_qty: number
  min_qty: number
  shelf_life_days: number | null
  purchase_lead_time_days: number | null
  is_active: boolean
  notes: string | null
  updated_at: string
  supplier_id: string | null
  last_counted_at: string | null
  fudo_product_id?: string | null
  fudo_ingredient_id?: string | null
  fudo_skip?: boolean | null
  suppliers: { id: number; name: string; phone: string | null; contact_name: string | null } | null
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchStockItems(active: boolean): Promise<StockItem[]> {
  const supabase = createClient()
  let query = supabase
    .from('stock_items')
    .select('id, name, category, unit, current_qty, min_qty, shelf_life_days, purchase_lead_time_days, is_active, notes, updated_at, supplier_id, last_counted_at, fudo_product_id, fudo_ingredient_id, fudo_skip, suppliers(id, name, phone, contact_name)')
    .order('category')
    .order('name')

  if (active) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as StockItem[]
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStockItems(activeOnly = true) {
  const { data, error, isLoading, mutate } = useSWR(
    SWR_KEYS.stockItems(activeOnly),
    () => fetchStockItems(activeOnly),
    {
      revalidateOnFocus: true,
      dedupingInterval: 30_000,
    },
  )

  return {
    items: data ?? [],
    error,
    isLoading,
    mutate,
  }
}
