import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RECIPE_CORPUS } from '@/lib/recipes/corpus'

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

function words(s: string): string[] {
  return norm(s).split(/\s+/).filter(w => w.length > 2)
}

// ---------------------------------------------------------------------------
// Name-based match score between a recipe name and a menu_item name
// Returns 0-100
// ---------------------------------------------------------------------------

function scoreNames(recipeName: string, menuItemName: string): number {
  const rn = norm(recipeName)
  const mn = norm(menuItemName)

  if (rn === mn) return 100

  // One fully contains the other
  if (rn.includes(mn) || mn.includes(rn)) return 80

  // Word overlap
  const rw = words(recipeName)
  const mw = words(menuItemName)
  const overlap = rw.filter(w => mw.includes(w)).length
  if (overlap === 0) return 0

  const pct = overlap / Math.max(rw.length, mw.length)
  return Math.round(pct * 60)
}

type LinkResult = {
  recipe_slug: string
  recipe_name: string
  recipe_id: number | null
  menu_item_id: number | null
  menu_item_name: string | null
  score: number
  action: 'linked' | 'already_linked' | 'no_match' | 'skipped' | 'dry_run' | 'error'
  note: string
}

// ---------------------------------------------------------------------------
// POST /api/recipes/link-menu-items
// ---------------------------------------------------------------------------
// Vincula menu_items.recipe_id con las recetas de la BD usando matching por nombre.
//
// Flujo:
//   1. Para cada receta del corpus, busca la receta en `recipes` por slug
//   2. Para cada `menu_item` activo, calcula score de similitud de nombres
//   3. Si score >= min_score Y el menu_item no tiene recipe_id → UPDATE
//   4. Si ya tiene recipe_id → reporta como 'already_linked' (no sobreescribe)
//
// Parámetros body (todos opcionales):
//   dry_run    (bool, default false) — analiza sin escribir
//   min_score  (int, default 70)     — umbral mínimo para vincular
//   overwrite  (bool, default false) — sobreescribe recipe_id existentes
//
// Retorna: informe detallado de vinculaciones realizadas y pendientes.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    // --- Auth ---
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Solo encargado o socio puede vincular menu items' }, { status: 403 })
    }

    // --- Params ---
    const body = await request.json().catch(() => ({}))
    const dryRun: boolean = body?.dry_run ?? false
    const minScore: number = body?.min_score ?? 70
    const overwrite: boolean = body?.overwrite ?? false

    const admin = createAdminClient()

    // --- Fetch all menu_items ---
    const { data: menuItems, error: menuError } = await admin
      .from('menu_items')
      .select('id, name, fudo_product_id, recipe_id, is_active')

    if (menuError) throw menuError

    const activeMenuItems = (menuItems ?? []).filter(mi => mi.is_active)

    // --- Fetch all recipes in DB (with slug) ---
    const { data: dbRecipes } = await admin
      .from('recipes')
      .select('id, name, slug')
      .eq('is_active', true)

    const results: LinkResult[] = []
    let totalLinked = 0
    let totalAlready = 0
    let totalNoMatch = 0

    for (const corpusRecipe of RECIPE_CORPUS) {
      // Skip base preparations that aren't sold as menu items
      if (corpusRecipe.is_base_preparation) {
        results.push({
          recipe_slug: corpusRecipe.slug,
          recipe_name: corpusRecipe.nombre,
          recipe_id: null,
          menu_item_id: null,
          menu_item_name: null,
          score: 0,
          action: 'skipped',
          note: 'Preparación base — no corresponde a un item de menú vendible',
        })
        continue
      }

      // Find recipe in DB by slug
      const dbRecipe = (dbRecipes ?? []).find(
        r => r.slug === corpusRecipe.slug || norm(r.name) === norm(corpusRecipe.nombre)
      )

      if (!dbRecipe) {
        results.push({
          recipe_slug: corpusRecipe.slug,
          recipe_name: corpusRecipe.nombre,
          recipe_id: null,
          menu_item_id: null,
          menu_item_name: null,
          score: 0,
          action: 'error',
          note: 'Receta no encontrada en DB. Ejecutá primero POST /api/recipes/ingest',
        })
        continue
      }

      // Find best matching menu_item by name
      let bestItem: (typeof activeMenuItems)[0] | null = null
      let bestScore = 0

      for (const mi of activeMenuItems) {
        const s = scoreNames(corpusRecipe.nombre, mi.name)
        if (s > bestScore) {
          bestScore = s
          bestItem = mi
        }
      }

      if (!bestItem || bestScore < minScore) {
        results.push({
          recipe_slug: corpusRecipe.slug,
          recipe_name: corpusRecipe.nombre,
          recipe_id: dbRecipe.id,
          menu_item_id: null,
          menu_item_name: null,
          score: bestScore,
          action: 'no_match',
          note: bestItem
            ? `Mejor candidato: "${bestItem.name}" (score ${bestScore}) — por debajo del umbral ${minScore}`
            : 'Sin menu_items activos que coincidan',
        })
        totalNoMatch++
        continue
      }

      // Already linked?
      if (bestItem.recipe_id !== null && !overwrite) {
        results.push({
          recipe_slug: corpusRecipe.slug,
          recipe_name: corpusRecipe.nombre,
          recipe_id: dbRecipe.id,
          menu_item_id: bestItem.id,
          menu_item_name: bestItem.name,
          score: bestScore,
          action: 'already_linked',
          note: `Menu item ya tiene recipe_id=${bestItem.recipe_id}. Usá overwrite=true para reemplazar.`,
        })
        totalAlready++
        continue
      }

      // → Link
      if (!dryRun) {
        const { error: updateError } = await admin
          .from('menu_items')
          .update({ recipe_id: dbRecipe.id })
          .eq('id', bestItem.id)

        if (updateError) {
          results.push({
            recipe_slug: corpusRecipe.slug,
            recipe_name: corpusRecipe.nombre,
            recipe_id: dbRecipe.id,
            menu_item_id: bestItem.id,
            menu_item_name: bestItem.name,
            score: bestScore,
            action: 'error',
            note: `Error al actualizar: ${updateError.message}`,
          })
          continue
        }
      }

      results.push({
        recipe_slug: corpusRecipe.slug,
        recipe_name: corpusRecipe.nombre,
        recipe_id: dbRecipe.id,
        menu_item_id: bestItem.id,
        menu_item_name: bestItem.name,
        score: bestScore,
        action: dryRun ? 'dry_run' : 'linked',
        note: dryRun
          ? `DRY RUN — vincularía recipe_id=${dbRecipe.id} a menu_item "${bestItem.name}" (score ${bestScore})`
          : `Vinculado: "${bestItem.name}" ← recipe "${corpusRecipe.nombre}" (score ${bestScore})`,
      })
      if (!dryRun) totalLinked++
    }

    // --- Check menu_items with no recipe match (orphaned) ---
    const linkedMenuItemIds = new Set(results.filter(r => r.menu_item_id).map(r => r.menu_item_id))
    const orphanedMenuItems = activeMenuItems.filter(
      mi => !linkedMenuItemIds.has(mi.id) && mi.recipe_id === null
    )

    console.log(`[/api/recipes/link-menu-items] ${dryRun ? 'DRY RUN' : 'WRITTEN'} | linked=${totalLinked}, already=${totalAlready}, no_match=${totalNoMatch}`)

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      min_score: minScore,
      overwrite,
      summary: {
        corpus_recipes: RECIPE_CORPUS.length,
        linked: totalLinked,
        already_linked: totalAlready,
        no_match: totalNoMatch,
        orphaned_menu_items: orphanedMenuItems.length,
      },
      results,
      orphaned_menu_items: orphanedMenuItems.map(mi => ({
        id: mi.id,
        name: mi.name,
        fudo_product_id: mi.fudo_product_id,
        note: 'Menu item activo sin recipe_id — vincular manualmente o creando receta',
      })),
      note: totalNoMatch > 0
        ? `${totalNoMatch} recetas del corpus sin match en menu_items. Revisá nombres o ajustá min_score.`
        : null,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/recipes/link-menu-items]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// GET /api/recipes/link-menu-items
// Returns current linkage status (no writes)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    const { data: menuItems } = await admin
      .from('menu_items')
      .select('id, name, recipe_id, fudo_product_id, is_active')
      .eq('is_active', true)

    const { data: recipes } = await admin
      .from('recipes')
      .select('id, name, slug')
      .eq('is_active', true)

    const recipeMap = new Map((recipes ?? []).map(r => [r.id, r]))

    const linked = (menuItems ?? []).filter(mi => mi.recipe_id !== null)
    const unlinked = (menuItems ?? []).filter(mi => mi.recipe_id === null)

    return NextResponse.json({
      total_active_menu_items: (menuItems ?? []).length,
      linked_count: linked.length,
      unlinked_count: unlinked.length,
      linked: linked.map(mi => ({
        menu_item_id: mi.id,
        menu_item_name: mi.name,
        recipe_id: mi.recipe_id,
        recipe_name: mi.recipe_id ? recipeMap.get(mi.recipe_id)?.name : null,
        recipe_slug: mi.recipe_id ? recipeMap.get(mi.recipe_id)?.slug : null,
      })),
      unlinked: unlinked.map(mi => ({
        menu_item_id: mi.id,
        menu_item_name: mi.name,
        fudo_product_id: mi.fudo_product_id,
      })),
    })
  } catch (error) {
    console.error('[/api/recipes/link-menu-items GET]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
