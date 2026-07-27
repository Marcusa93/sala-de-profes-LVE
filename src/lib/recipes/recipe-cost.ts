import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// recipe-cost.ts — costo por porción de recetas, con canonicalización de
// unidades y expansión nivel-2 de elaborados intermedios.
//
// LECCIÓN CRÍTICA: recipe_ingredients.ingredient_unit viene MEZCLADO entre
// filas del mismo insumo ('kg', 'gramos', 'g', 'ml', 'l', 'unidad'...).
// SIEMPRE canonicalizar cada fila (g/gr/gramos → ÷1000 kg, ml/cc → ÷1000 l)
// ANTES de sumar o multiplicar por stock_items.cost_per_unit.
//
// Nivel 2: si un ingrediente es un stock_item producido por otra receta
// (ej: "Milanesa cruda"), su costo se toma del costo por porción de esa
// receta. El vínculo se resuelve PRIMERO por recipes.output_stock_item_id
// (explícito, robusto a renombres) y recién si es null cae al match por
// nombre exacto (comportamiento histórico).
// ---------------------------------------------------------------------------

/** Canonicaliza una cantidad: g→kg, ml→l. Devuelve qty + unidad canónica. */
export function canon(qty: number, unit: string | null): { qty: number; unit: string | null } {
  const u = unit?.trim().toLowerCase() ?? null
  if (u === 'g' || u === 'gr' || u === 'gramos') return { qty: qty / 1000, unit: 'kg' }
  if (u === 'ml' || u === 'cc') return { qty: qty / 1000, unit: 'l' }
  if (u === 'lt' || u === 'litro' || u === 'litros') return { qty, unit: 'l' }
  if (u === 'kilo' || u === 'kilos') return { qty, unit: 'kg' }
  return { qty, unit: u }
}

/** Convierte qty de una unidad (ya canónica) a la unidad del stock_item. */
export function toStockUnit(qty: number, fromUnit: string | null, toUnit: string): number {
  if (!fromUnit) return qty
  const f = fromUnit.trim().toLowerCase()
  const t = toUnit.trim().toLowerCase()
  if (f === t) return qty
  if ((f === 'g' || f === 'gr' || f === 'gramos') && (t === 'kg' || t === 'kilo' || t === 'kilos')) return qty / 1000
  if ((t === 'g' || t === 'gr' || t === 'gramos') && (f === 'kg' || f === 'kilo' || f === 'kilos')) return qty * 1000
  if ((f === 'ml' || f === 'cc') && (t === 'l' || t === 'lt' || t === 'litro' || t === 'litros')) return qty / 1000
  if ((t === 'ml' || t === 'cc') && (f === 'l' || f === 'lt' || f === 'litro' || f === 'litros')) return qty * 1000
  return qty
}

type IngredientRow = {
  recipe_id: string
  stock_item_id: string
  qty_per_portion: number | null
  ingredient_unit: string | null
}

type StockItemRow = {
  id: string
  name: string
  unit: string
  cost_per_unit: number | null
}

export type RecipeCost = {
  /** Costo por porción en $ (redondeado a 2 decimales). 0 si no se pudo costear. */
  cost: number
  /** Cantidad de ingredientes de la receta. */
  ingredients: number
  /** Ingredientes sin costo conocido (cost_per_unit nulo y sin receta intermedia). */
  missing: number
}

/**
 * Costea un conjunto de recetas: costo por porción = Σ ingredientes
 * (canonicalizados) × cost_per_unit del stock_item, con expansión nivel-2
 * de intermedios (ingrediente cuyo nombre matchea otra receta → usar el
 * costo por porción de esa receta).
 */
export async function costRecipes(
  admin: SupabaseClient,
  recipeIds: string[],
): Promise<Map<string, RecipeCost>> {
  const result = new Map<string, RecipeCost>()
  if (recipeIds.length === 0) return result

  // 1. Ingredientes directos de las recetas pedidas
  const { data: riRows, error: riError } = await admin
    .from('recipe_ingredients')
    .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
    .in('recipe_id', recipeIds)
  if (riError) throw new Error(riError.message)
  const ingredients = (riRows ?? []) as IngredientRow[]

  const directItemIds = [...new Set(ingredients.map(r => r.stock_item_id))]
  if (directItemIds.length === 0) return result

  // 2. Detectar intermedios: stock_items usados que son producidos por otra
  //    receta. Vínculo explícito (output_stock_item_id) primero; match por
  //    nombre solo como fallback para recetas sin vincular.
  const [{ data: directItems, error: siError }, recipesRes] = await Promise.all([
    admin.from('stock_items').select('id, name, unit, cost_per_unit').in('id', directItemIds),
    admin.from('recipes').select('id, name, output_stock_item_id'),
  ])
  if (siError) throw new Error(siError.message)

  type RecipeRow = { id: string; name: string; output_stock_item_id?: string | null }
  let allRecipes: RecipeRow[]
  if (recipesRes.error) {
    // Fallback: columna output_stock_item_id todavía no migrada
    const legacy = await admin.from('recipes').select('id, name')
    if (legacy.error) throw new Error(legacy.error.message)
    allRecipes = (legacy.data ?? []) as RecipeRow[]
  } else {
    allRecipes = (recipesRes.data ?? []) as RecipeRow[]
  }

  const recipeIdByName = new Map<string, string>()
  const recipeIdByOutputItemId = new Map<string, string>()
  for (const r of allRecipes) {
    recipeIdByName.set(r.name.trim().toLowerCase(), r.id)
    if (r.output_stock_item_id) recipeIdByOutputItemId.set(r.output_stock_item_id, r.id)
  }

  // stock_item intermedio → receta L1 que lo produce (explícito > nombre)
  const l1RecipeByItemId = new Map<string, string>()
  for (const item of (directItems ?? []) as StockItemRow[]) {
    const rid = recipeIdByOutputItemId.get(item.id)
      ?? recipeIdByName.get(item.name.trim().toLowerCase())
    if (rid) l1RecipeByItemId.set(item.id, rid)
  }

  // 3. Ingredientes crudos de las recetas intermedias (nivel 2, sin recursión)
  const l1RecipeIds = [...new Set(l1RecipeByItemId.values())].filter(id => !result.has(id))
  let l1Ingredients: IngredientRow[] = []
  if (l1RecipeIds.length > 0) {
    const { data: l1Ris, error: l1Error } = await admin
      .from('recipe_ingredients')
      .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
      .in('recipe_id', l1RecipeIds)
    if (l1Error) throw new Error(l1Error.message)
    l1Ingredients = (l1Ris ?? []) as IngredientRow[]
  }

  // 4. Catálogo de stock_items involucrados (directos + crudos de intermedios)
  const allItemIds = [...new Set([...directItemIds, ...l1Ingredients.map(r => r.stock_item_id)])]
  const { data: allItems, error: aiError } = await admin
    .from('stock_items')
    .select('id, name, unit, cost_per_unit')
    .in('id', allItemIds)
  if (aiError) throw new Error(aiError.message)
  const itemById = new Map<string, StockItemRow>()
  for (const it of (allItems ?? []) as StockItemRow[]) itemById.set(it.id, it)

  /** Costo en $ de una fila de ingrediente contra el costo del stock_item. */
  const rowCost = (ri: IngredientRow): { cost: number; known: boolean } => {
    const item = itemById.get(ri.stock_item_id)
    if (!item || item.cost_per_unit == null) return { cost: 0, known: false }
    const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
    const qtyInStockUnit = toStockUnit(c.qty, c.unit, item.unit)
    return { cost: qtyInStockUnit * Number(item.cost_per_unit), known: true }
  }

  // 5. Costo por porción de cada receta intermedia (solo crudos)
  const l1CostByRecipeId = new Map<string, number>()
  for (const rid of l1RecipeIds) {
    let total = 0
    for (const ri of l1Ingredients.filter(r => r.recipe_id === rid)) {
      total += rowCost(ri).cost
    }
    l1CostByRecipeId.set(rid, total)
  }

  // 6. Costo por porción de cada receta pedida, expandiendo intermedios
  for (const rid of recipeIds) {
    const rows = ingredients.filter(r => r.recipe_id === rid)
    let total = 0
    let missing = 0
    for (const ri of rows) {
      const l1Recipe = l1RecipeByItemId.get(ri.stock_item_id)
      // Intermedio (y no auto-referencia): costo de esa receta × qty canónica
      if (l1Recipe && l1Recipe !== rid) {
        const perUnit = l1CostByRecipeId.get(l1Recipe) ?? 0
        if (perUnit > 0) {
          const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
          total += c.qty * perUnit
          continue
        }
        // Receta intermedia sin costo → caer al costo directo del item
      }
      const { cost, known } = rowCost(ri)
      if (!known) missing += 1
      total += cost
    }
    result.set(rid, {
      cost: Math.round(total * 100) / 100,
      ingredients: rows.length,
      missing,
    })
  }

  return result
}
