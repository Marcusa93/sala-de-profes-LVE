import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// GET /api/insights/sales-stock — Cross ventas de hoy con stock actual
// Informativo — no descuenta nada
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // 1. Get today's top products from Fudo
    let topProducts: { name: string; qty: number; revenue: number }[] = []
    try {
      const today = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
      const res = await fudo(`/sales?include=items.product&sort=-createdAt&page[size]=200&page[number]=1`)
      const included = res.included ?? []

      const itemMap = new Map<string, Record<string, unknown>>()
      const productMap = new Map<string, Record<string, unknown>>()
      for (const r of included) {
        if (r.type === 'Item') itemMap.set(r.id, r)
        if (r.type === 'Product') productMap.set(r.id, r)
      }

      const productAgg = new Map<string, { qty: number; revenue: number }>()
      for (const sale of (res.data ?? [])) {
        const createdAt = String(sale.attributes?.createdAt ?? '')
        const argDate = new Date(createdAt).toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
        if (argDate !== today) continue
        if (sale.attributes?.saleState !== 'CLOSED') continue

        for (const ref of ((sale.relationships?.items?.data ?? []) as Array<{ id: string }>)) {
          const item = itemMap.get(ref.id) as Record<string, unknown> | undefined
          if (!item) continue
          const attrs = item.attributes as Record<string, unknown> | undefined
          if (attrs?.canceled) continue
          const prodRef = ((item.relationships as Record<string, unknown>)?.product as Record<string, unknown>)?.data as Record<string, unknown> | undefined
          const product = prodRef?.id ? productMap.get(String(prodRef.id)) as Record<string, unknown> | undefined : undefined
          const name = String((product?.attributes as Record<string, unknown>)?.name ?? 'Desconocido')
          const qty = Number(attrs?.quantity ?? 1)
          const price = Number(attrs?.price ?? 0)
          const ex = productAgg.get(name)
          if (ex) { ex.qty += qty; ex.revenue += price }
          else productAgg.set(name, { qty, revenue: price })
        }
      }
      topProducts = Array.from(productAgg.entries())
        .map(([name, d]) => ({ name, ...d }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 20)
    } catch { /* Fudo unavailable */ }

    // 2. Get stock items + recipe_ingredients
    const [stockRes, recipeIngsRes, recipesRes] = await Promise.all([
      admin.from('stock_items').select('id, name, current_qty, min_qty, unit, category').eq('is_active', true),
      admin.from('recipe_ingredients').select('recipe_id, stock_item_id, qty_per_portion'),
      admin.from('recipes').select('id, name'),
    ])

    const stockItems = stockRes.data ?? []
    const recipeIngs = recipeIngsRes.data ?? []
    const recipes = recipesRes.data ?? []

    // 3. Map recipe name → stock consumption
    // recipe name → { stock_item_id, qty_per_portion }[]
    const recipeByName = new Map<string, typeof recipeIngs>()
    for (const ri of recipeIngs) {
      const recipe = recipes.find(r => r.id === ri.recipe_id)
      if (!recipe) continue
      const name = recipe.name.toLowerCase()
      if (!recipeByName.has(name)) recipeByName.set(name, [])
      recipeByName.get(name)!.push(ri)
    }

    // 4. Cross: for each top product, estimate stock consumption
    const insights: Array<{
      product: string
      soldQty: number
      soldRevenue: number
      stockImpact: Array<{
        stockItemName: string
        estimatedUsed: number
        currentQty: number
        unit: string
        status: 'ok' | 'low' | 'critical'
      }>
    }> = []

    for (const prod of topProducts) {
      // Try to find matching recipe
      const prodLower = prod.name.toLowerCase()
      let matchedRecipe: typeof recipeIngs | null = null

      for (const [recipeName, ings] of recipeByName) {
        if (prodLower.includes(recipeName) || recipeName.includes(prodLower)) {
          matchedRecipe = ings
          break
        }
        // Partial match — main words
        const prodWords = prodLower.split(/\s+/).filter(w => w.length > 3)
        const recipeWords = recipeName.split(/\s+/).filter(w => w.length > 3)
        const overlap = prodWords.filter(w => recipeWords.some(rw => rw.includes(w) || w.includes(rw)))
        if (overlap.length >= 1 && overlap.length >= Math.min(prodWords.length, recipeWords.length) * 0.5) {
          matchedRecipe = ings
          break
        }
      }

      const stockImpact: typeof insights[0]['stockImpact'] = []
      if (matchedRecipe) {
        for (const ri of matchedRecipe) {
          const stockItem = stockItems.find(s => s.id === ri.stock_item_id)
          if (!stockItem || ri.qty_per_portion === 0) continue

          const estimated = ri.qty_per_portion * prod.qty
          const remaining = stockItem.current_qty - estimated
          const status = remaining <= 0 ? 'critical' : remaining <= stockItem.min_qty ? 'low' : 'ok'

          stockImpact.push({
            stockItemName: stockItem.name,
            estimatedUsed: Math.round(estimated * 10) / 10,
            currentQty: stockItem.current_qty,
            unit: stockItem.unit ?? '',
            status,
          })
        }
      }

      insights.push({
        product: prod.name,
        soldQty: prod.qty,
        soldRevenue: prod.revenue,
        stockImpact,
      })
    }

    // 5. Critical items — stock items that are below min regardless of sales
    const criticalItems = stockItems
      .filter(s => s.current_qty <= s.min_qty && s.min_qty > 0)
      .map(s => ({ name: s.name, qty: s.current_qty, min: s.min_qty, unit: s.unit ?? '', category: s.category }))
      .sort((a, b) => (a.qty / Math.max(a.min, 1)) - (b.qty / Math.max(b.min, 1)))
      .slice(0, 10)

    return NextResponse.json({
      insights: insights.filter(i => i.stockImpact.length > 0).slice(0, 10),
      topSold: topProducts.slice(0, 10),
      criticalStock: criticalItems,
      meta: {
        recipesMatched: insights.filter(i => i.stockImpact.length > 0).length,
        totalProducts: topProducts.length,
      },
    })
  } catch (error) {
    console.error('[insights/sales-stock]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
