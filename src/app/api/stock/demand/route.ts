import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

// GET /api/stock/demand?stock_item_id=UUID&days=14
// Devuelve qué menú items consumen este insumo y cuánto se vendió en los últimos N días.

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

  // 1. Datos del insumo
  const { data: stockItem } = await admin
    .from('stock_items')
    .select('id, name, unit, current_qty, min_qty, fudo_ingredient_id')
    .eq('id', stockItemId)
    .single()

  if (!stockItem) return NextResponse.json({ error: 'Item no encontrado' }, { status: 404 })

  // 2. Recetas que usan este insumo
  const { data: riRows } = await admin
    .from('recipe_ingredients')
    .select('recipe_id, qty_per_portion, ingredient_unit')
    .eq('stock_item_id', stockItemId)

  const recipeIds = (riRows ?? []).map(r => r.recipe_id)

  // 3. Menu items ligados a esas recetas (con fudo_product_id)
  type MenuItemRow = { id: string; name: string; recipe_id: string; fudo_product_id: string }
  let menuItems: MenuItemRow[] = []
  if (recipeIds.length > 0) {
    const { data } = await admin
      .from('menu_items')
      .select('id, name, recipe_id, fudo_product_id')
      .in('recipe_id', recipeIds)
      .eq('is_active', true)
      .not('fudo_product_id', 'is', null)
    menuItems = (data ?? []) as MenuItemRow[]
  }

  const fudoProductIds = menuItems.map(m => m.fudo_product_id).filter(Boolean)

  // 4. Ventas Fudo de esos productos en el período
  type SaleRow = { fudo_product_id: string; quantity: number }
  let salesRows: SaleRow[] = []
  if (fudoProductIds.length > 0) {
    const { data } = await admin
      .from('fudo_sales')
      .select('fudo_product_id, quantity')
      .in('fudo_product_id', fudoProductIds)
      .gte('sold_at', cutoffISO)
    salesRows = (data ?? []) as SaleRow[]
  }

  // Agregar ventas por producto
  const salesByProduct: Record<string, number> = {}
  for (const s of salesRows) {
    salesByProduct[s.fudo_product_id] = (salesByProduct[s.fudo_product_id] ?? 0) + s.quantity
  }

  // 5. Construir respuesta: una línea por menu_item, con ventas y consumo estimado
  const viaRecipes = menuItems
    .map(mi => {
      const ri = riRows?.find(r => r.recipe_id === mi.recipe_id)
      const unitsSold = Math.round(salesByProduct[mi.fudo_product_id] ?? 0)
      const qtyPerPortion = ri?.qty_per_portion ?? 0
      const unit = ri?.ingredient_unit ?? stockItem.unit
      const estimatedConsumed = Math.round(unitsSold * qtyPerPortion * 100) / 100
      return { menu_item: mi.name, units_sold: unitsSold, qty_per_portion: qtyPerPortion, unit, estimated_consumed: estimatedConsumed }
    })
    .filter(r => r.units_sold > 0)
    .sort((a, b) => b.units_sold - a.units_sold)

  // 6. Consumo real registrado en stock_movements (razón 'sale' = sync Fudo)
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

  // Consumo total: usar el mayor entre la estimación por recetas y el real del sync
  const estimatedViaRecipes = viaRecipes.reduce((s, r) => s + r.estimated_consumed, 0)
  const totalConsumed = consumedFromSync > 0 ? consumedFromSync : Math.round(estimatedViaRecipes * 100) / 100

  // Días de stock restantes al ritmo actual
  const dailyRate = totalConsumed / days
  const daysOfStock = dailyRate > 0
    ? Math.round((Number(stockItem.current_qty) / dailyRate) * 10) / 10
    : null

  return NextResponse.json({
    stock_item: {
      id: stockItem.id,
      name: stockItem.name,
      unit: stockItem.unit,
      current_qty: Number(stockItem.current_qty),
      min_qty: Number(stockItem.min_qty),
    },
    days,
    via_recipes: viaRecipes,
    consumed_from_sync: consumedFromSync,
    total_consumed: totalConsumed,
    daily_rate: Math.round(dailyRate * 100) / 100,
    days_of_stock: daysOfStock,
    has_recipe_data: viaRecipes.length > 0,
    has_sync_data: consumedFromSync > 0,
  })
}
