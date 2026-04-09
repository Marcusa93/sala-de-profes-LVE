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
  is_active: boolean
  supplier_id: string | null
  fudo_ingredient_id?: string | null
  suppliers: { name: string } | null
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchStockItems(active: boolean): Promise<StockItem[]> {
  const supabase = createClient()
  let query = supabase
    .from('stock_items')
    .select('id, name, category, unit, current_qty, min_qty, is_active, supplier_id, fudo_ingredient_id, suppliers(name)')
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
