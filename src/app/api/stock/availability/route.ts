import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/stock/availability
// ---------------------------------------------------------------------------
// Calcula cuántas porciones de una receta se pueden preparar con el stock actual.
// Llama a la RPC stock_availability(p_recipe_id).
//
// Query params:
//   recipe_id (required) — ID de la receta
//
// Ejemplos:
//   /api/stock/availability?recipe_id=3
//   → { available_portions: 27.7, limiting_ingredient: "nalga", ... }
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const recipeId = request.nextUrl.searchParams.get('recipe_id')
    if (!recipeId || isNaN(Number(recipeId))) {
      return NextResponse.json({ error: 'Parámetro recipe_id requerido (número)' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('stock_availability', {
      p_recipe_id: Number(recipeId),
    })

    if (error) throw error

    return NextResponse.json(data)
  } catch (error) {
    console.error('[/api/stock/availability]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// GET /api/stock/availability?all=true
// Lista disponibilidad de TODAS las recetas activas con ingredientes vinculados.
// ---------------------------------------------------------------------------

// Note: handled within the GET above by checking all=true param
// If all=true, calls recipes_at_risk with threshold 0 to get all recipes
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const threshold: number = body?.threshold ?? 0

    const admin = createAdminClient()

    // Get all recipes with linked ingredients
    const { data: recipeIds } = await admin
      .from('recipe_ingredients')
      .select('recipe_id')

    const uniqueIds = [...new Set((recipeIds ?? []).map(r => r.recipe_id))]

    if (uniqueIds.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No hay recetas con ingredientes vinculados. Ejecutá POST /api/recipes/ingest primero.',
        recipes: [],
      })
    }

    // Fetch availability for each recipe
    const results = await Promise.all(
      uniqueIds.map(async (recipeId) => {
        const { data } = await admin.rpc('stock_availability', { p_recipe_id: recipeId })
        return data
      })
    )

    const valid = results.filter(Boolean)
    const atRisk = valid.filter(r => (r as { available_portions: number }).available_portions <= threshold)
    const ok = valid.filter(r => (r as { available_portions: number }).available_portions > threshold)

    // Sort: at-risk first, then by available_portions ascending
    const sorted = [...valid].sort((a, b) => {
      const aa = (a as { available_portions: number }).available_portions
      const bb = (b as { available_portions: number }).available_portions
      return aa - bb
    })

    return NextResponse.json({
      success: true,
      threshold,
      total_recipes: valid.length,
      at_risk_count: atRisk.length,
      ok_count: ok.length,
      recipes: sorted,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/stock/availability POST]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
