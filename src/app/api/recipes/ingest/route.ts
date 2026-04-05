import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RECIPE_CORPUS, IMPLICIT_SUB_RECIPES, normalizeIngredient, getCorpusStats } from '@/lib/recipes/corpus'
import { matchIngredientToStock } from '@/lib/recipes/stock-match'

// GET /api/recipes/ingest — return full corpus analysis + stock matching
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()

    // Get stock items for matching
    const { data: stockItems } = await admin
      .from('stock_items')
      .select('id, name, category')
      .eq('is_active', true)

    // Get FUDO menu items for bridge
    const { data: menuItems } = await admin
      .from('menu_items')
      .select('id, name, fudo_product_id, recipe_id')

    const items = stockItems ?? []
    const stats = getCorpusStats()

    // Normalize all ingredients and match to stock
    const allMatches = RECIPE_CORPUS.flatMap(recipe => {
      const allIngredients = [
        ...recipe.ingredientes,
        ...recipe.variantes.flatMap(v => v.ingredientes_extra ?? []),
      ]
      return allIngredients.map(ing => {
        const normalized = normalizeIngredient(ing, recipe.slug)
        const match = matchIngredientToStock(ing.producto, normalized.normalized_name, recipe.slug, items)
        return {
          ...normalized,
          stock_match: match,
        }
      })
    })

    // Deduplicate by normalized_name for summary
    const uniqueIngredients = new Map<string, typeof allMatches[0]>()
    allMatches.forEach(m => {
      const key = m.normalized_name
      if (!uniqueIngredients.has(key) || (m.stock_match.confidence_score > (uniqueIngredients.get(key)!.stock_match.confidence_score))) {
        uniqueIngredients.set(key, m)
      }
    })

    // FUDO bridge: match recipe names to FUDO products
    const fudoBridge = RECIPE_CORPUS.map(recipe => {
      const match = (menuItems ?? []).find(mi => {
        const rNorm = recipe.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const mNorm = mi.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        return rNorm === mNorm || mNorm.includes(rNorm) || rNorm.includes(mNorm)
      })
      return {
        recipe_slug: recipe.slug,
        recipe_name: recipe.nombre,
        fudo_match: match ? { id: match.id, name: match.name, fudo_product_id: match.fudo_product_id, already_linked: !!match.recipe_id } : null,
      }
    })

    // Match stats
    const matchStats = {
      total: uniqueIngredients.size,
      exacto: [...uniqueIngredients.values()].filter(m => m.stock_match.confidence === 'exacto').length,
      probable: [...uniqueIngredients.values()].filter(m => m.stock_match.confidence === 'probable').length,
      ambiguo: [...uniqueIngredients.values()].filter(m => m.stock_match.confidence === 'ambiguo').length,
      sin_match: [...uniqueIngredients.values()].filter(m => m.stock_match.confidence === 'sin_match').length,
    }

    return NextResponse.json({
      stats,
      recipes: RECIPE_CORPUS.map(r => ({
        slug: r.slug,
        nombre: r.nombre,
        categoria: r.categoria,
        estado: r.estado,
        ingredientes_count: r.ingredientes.length,
        variantes_count: r.variantes.length,
        depends_on: r.depends_on ?? [],
        is_base: r.is_base_preparation ?? false,
        guarnicion: r.guarnicion,
      })),
      implicit_sub_recipes: IMPLICIT_SUB_RECIPES,
      ingredients: [...uniqueIngredients.values()].sort((a, b) =>
        a.stock_match.confidence_score - b.stock_match.confidence_score
      ),
      match_stats: matchStats,
      fudo_bridge: fudoBridge,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/recipes/ingest]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
