import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

// GET /api/stock/demand?stock_item_id=UUID&days=14
//
// Encuentra qué platos del menú consumen este insumo y cuánto se vendió.
// Tres rutas, de más precisa a más aproximada:
//
// Ruta A — recipe chain: stock_item → recipe_ingredients → recipes → menu_items → fudo_sales
//           (requiere que menu_items.recipe_id esté configurado)
//
// Ruta B — name match: busca menu_items cuyo nombre contenga el nombre del insumo
//           (fallback cuando las recetas no están vinculadas)
//
// Ruta C — fudo ingredient sync: stock_movements[reason='sale'] (consumo real del sync de Fudo)

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!isManagerOrAbove(profile?.role)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const stockItemId = searchParams.get('stock_item_id')
  const days = Math.min(parseInt(searchParams.get('days') ?? '14'), 90)

  if (!stockItemId) return NextResponse.json({ error: 'stock_item_id requerido' }, { status: 400 })

  const admin = createAdminClient()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffISO = cutoff.toISOString()

  // Datos del insumo
  const { data: stockItem } = await admin
    .from('stock_items')
    .select('id, name, unit, current_qty, min_qty, fudo_ingredient_id')
    .eq('id', stockItemId)
    .single()

  if (!stockItem) return NextResponse.json({ error: 'Item no encontrado' }, { status: 404 })

  // -------------------------------------------------------------------------
  // RUTA A — vía recipe_ingredients → menu_items con recipe_id asignado
  // -------------------------------------------------------------------------
  type SaleRow = { menu_item: string; fudo_product_id: string; units_sold: number; via: 'recipe' | 'name' }
  let salesRows: SaleRow[] = []

  const { data: riRows } = await admin
    .from('recipe_ingredients')
    .select('recipe_id, qty_per_portion, ingredient_unit')
    .eq('stock_item_id', stockItemId)

  const recipeIds = (riRows ?? []).map(r => r.recipe_id)

  if (recipeIds.length > 0) {
    const { data: menuItemsViaRecipe } = await admin
      .from('menu_items')
      .select('id, name, recipe_id, fudo_product_id')
      .in('recipe_id', recipeIds)
      .eq('is_active', true)
      .not('fudo_product_id', 'is', null)

    const fudoIds = (menuItemsViaRecipe ?? []).map(m => m.fudo_product_id as string).filter(Boolean)
    if (fudoIds.length > 0) {
      const { data: fudoSales } = await admin
        .from('fudo_sales')
        .select('fudo_product_id, quantity')
        .in('fudo_product_id', fudoIds)
        .gte('sold_at', cutoffISO)

      const totals: Record<string, number> = {}
      for (const s of fudoSales ?? []) {
        totals[s.fudo_product_id] = (totals[s.fudo_product_id] ?? 0) + s.quantity
      }

      salesRows = (menuItemsViaRecipe ?? [])
        .filter(m => m.fudo_product_id && totals[m.fudo_product_id as string] > 0)
        .map(m => ({
          menu_item: m.name,
          fudo_product_id: m.fudo_product_id as string,
          units_sold: Math.round(totals[m.fudo_product_id as string] ?? 0),
          via: 'recipe' as const,
        }))
    }
  }

  // -------------------------------------------------------------------------
  // RUTA B — name match cuando recipe chain no encontró nada
  // -------------------------------------------------------------------------
  // Extrae palabras del nombre del insumo (≥ 3 letras) y busca menu_items
  // que las contengan. Ejemplo: "Lomo" → busca menu_items ILIKE '%lomo%'
  if (salesRows.length === 0) {
    const words = stockItem.name
      .split(/\s+/)
      .filter(w => w.length >= 3)
      .map(w => w.toLowerCase())

    if (words.length > 0) {
      // Consulta con OR sobre las palabras más representativas (top 2)
      const keyWords = words.slice(0, 2)
      const conditions = keyWords.map(w => `name.ilike.%${w}%`).join(',')

      const { data: menuItemsByName } = await admin
        .from('menu_items')
        .select('id, name, fudo_product_id')
        .or(conditions)
        .eq('is_active', true)
        .not('fudo_product_id', 'is', null)

      const fudoIds = (menuItemsByName ?? []).map(m => m.fudo_product_id as string).filter(Boolean)
      if (fudoIds.length > 0) {
        const { data: fudoSales } = await admin
          .from('fudo_sales')
          .select('fudo_product_id, quantity')
          .in('fudo_product_id', fudoIds)
          .gte('sold_at', cutoffISO)

        const totals: Record<string, number> = {}
        for (const s of fudoSales ?? []) {
          totals[s.fudo_product_id] = (totals[s.fudo_product_id] ?? 0) + s.quantity
        }

        salesRows = (menuItemsByName ?? [])
          .filter(m => m.fudo_product_id && (totals[m.fudo_product_id as string] ?? 0) > 0)
          .map(m => ({
            menu_item: m.name,
            fudo_product_id: m.fudo_product_id as string,
            units_sold: Math.round(totals[m.fudo_product_id as string] ?? 0),
            via: 'name' as const,
          }))
      }
    }
  }

  // Ordenar por más vendido
  salesRows.sort((a, b) => b.units_sold - a.units_sold)

  // -------------------------------------------------------------------------
  // RUTA C — consumo real de Fudo sync en stock_movements
  // -------------------------------------------------------------------------
  const { data: movements } = await admin
    .from('stock_movements')
    .select('qty')
    .eq('stock_item_id', stockItemId)
    .eq('movement_type', 'out')
    .eq('reason', 'sale')
    .gte('created_at', cutoffISO)

  const consumedFromSync = Math.round(
    (movements ?? []).reduce((sum, m) => sum + m.qty, 0) * 100
  ) / 100

  // -------------------------------------------------------------------------
  // Construir respuesta
  // -------------------------------------------------------------------------
  const totalUnitsSold = salesRows.reduce((s, r) => s + r.units_sold, 0)

  // Para consumo estimado: si hay recipe_ingredients con qty_per_portion usa eso,
  // sino muestra "X platos vendidos" sin estimación en kg
  const riForItem = riRows?.find(r => r.qty_per_portion > 0)
  const qtyPerPortion = riForItem?.qty_per_portion ?? null
  const portionUnit = riForItem?.ingredient_unit ?? stockItem.unit

  const estimatedConsumed = qtyPerPortion
    ? Math.round(totalUnitsSold * qtyPerPortion * 100) / 100
    : null

  const totalConsumed = consumedFromSync > 0
    ? consumedFromSync
    : estimatedConsumed ?? 0

  const dailyRate = totalConsumed > 0
    ? Math.round((totalConsumed / days) * 100) / 100
    : null

  const daysOfStock = dailyRate && dailyRate > 0
    ? Math.round((Number(stockItem.current_qty) / dailyRate) * 10) / 10
    : null

  const dataSource: 'recipe' | 'name' | 'sync' | 'none' =
    consumedFromSync > 0 ? 'sync'
    : salesRows[0]?.via === 'recipe' ? 'recipe'
    : salesRows[0]?.via === 'name' ? 'name'
    : 'none'

  return NextResponse.json({
    stock_item: {
      id: stockItem.id,
      name: stockItem.name,
      unit: stockItem.unit,
      current_qty: Number(stockItem.current_qty),
      min_qty: Number(stockItem.min_qty),
    },
    days,
    sales: salesRows,
    total_units_sold: totalUnitsSold,
    qty_per_portion: qtyPerPortion,
    portion_unit: portionUnit,
    estimated_consumed: estimatedConsumed,
    consumed_from_sync: consumedFromSync,
    total_consumed: totalConsumed,
    daily_rate: dailyRate,
    days_of_stock: daysOfStock,
    data_source: dataSource,
  })
}
