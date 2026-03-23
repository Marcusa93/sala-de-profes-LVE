'use server'

import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockMovementResult = {
  movement_id: number
  stock_item_id: number
  change: number
  new_qty: number
  reason: string
}

type ProduceRecipeRpcResult = {
  success: boolean
  recipe_id?: number
  recipe_name?: string
  portions?: number
  ingredients_affected?: number
  movements?: Array<{
    stock_item_id: number
    stock_item_name: string
    qty_deducted: number
    previous_qty: number
    new_qty: number
  }>
  error?: string
}

// ---------------------------------------------------------------------------
// produceRecipe — Usa la RPC `produce_recipe` (transaccional en la DB)
// ---------------------------------------------------------------------------
// Descuenta insumos del stock según una receta y cantidad de porciones.
// Toda la lógica corre dentro de una función PL/pgSQL (transacción atómica).
//
// Uso típico: al confirmar la cocina diaria, se llama por cada receta usada.
// ---------------------------------------------------------------------------

export async function produceRecipe(
  recipeId: number,
  portions: number,
  referenceId?: string,
): Promise<ProduceRecipeRpcResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('produce_recipe', {
    p_recipe_id: recipeId,
    p_portions: portions,
    p_reference_id: referenceId ?? null,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return data as ProduceRecipeRpcResult
}

// ---------------------------------------------------------------------------
// adjustStock — ajuste manual de stock (recepción, desperdicio, corrección)
// ---------------------------------------------------------------------------

export async function adjustStock(
  stockItemId: number,
  change: number,
  reason: 'received' | 'waste' | 'expired' | 'manual_adjustment',
): Promise<{ success: boolean; data?: StockMovementResult; error?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('register_stock_movement', {
    p_stock_item_id: stockItemId,
    p_change: change,
    p_reason: reason,
    p_reference_type: 'manual',
    p_reference_id: null,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, data: data as StockMovementResult }
}

// ---------------------------------------------------------------------------
// deductStockOnSale — aplica deducción de stock por una venta de Fudo
// ---------------------------------------------------------------------------
// Normalmente el trigger lo hace automáticamente.
// Esta función es para re-procesar o testing.
// ---------------------------------------------------------------------------

export async function deductStockOnSale(
  saleId: number,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('deduct_stock_on_sale', {
    p_sale_id: saleId,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, data: data as Record<string, unknown> }
}
