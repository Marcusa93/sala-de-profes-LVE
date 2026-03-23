import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/stock
// ---------------------------------------------------------------------------
// Sync bidireccional de ingredientes Fudo ↔ stock_items.
//
// 1) Trae ingredientes de Fudo (181 items con stock real).
// 2) Para cada ingrediente:
//    - Si ya existe un stock_item con ese fudo_ingredient_id → actualiza qty
//      en la dirección indicada por `direction` param.
//    - Si no existe → crea un stock_item nuevo con los datos de Fudo.
// 3) `direction`:
//    - "fudo_to_app" (default): Fudo es source of truth → actualiza stock_items
//    - "app_to_fudo": Webapp es source of truth → PATCH stock en Fudo
//    - "both": Trae nuevos de Fudo, pero no sobreescribe qty existentes
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const direction: string = body?.direction ?? 'fudo_to_app'

    const supabase = createAdminClient()

    // 1) Fetch Fudo ingredients
    const fudoIngredients = await fudo.getIngredients()

    // 2) Fetch existing stock_items with fudo_ingredient_id
    const { data: existingItems } = await supabase
      .from('stock_items')
      .select('id, name, current_qty, fudo_ingredient_id')

    const existingMap = new Map(
      (existingItems ?? [])
        .filter((i) => i.fudo_ingredient_id)
        .map((i) => [i.fudo_ingredient_id!, i]),
    )

    let synced = 0
    let created = 0
    let pushed = 0
    let errors = 0

    for (const ingredient of fudoIngredients) {
      const existing = existingMap.get(ingredient.id)

      if (existing) {
        // Item already linked
        if (direction === 'fudo_to_app') {
          // Update webapp from Fudo
          if (ingredient.stock != null) {
            const { error } = await supabase
              .from('stock_items')
              .update({ current_qty: ingredient.stock })
              .eq('id', existing.id)
            if (error) errors++
            else synced++
          }
        } else if (direction === 'app_to_fudo') {
          // Push webapp qty to Fudo
          try {
            await fudo.updateIngredientStock(ingredient.id, existing.current_qty)
            pushed++
          } catch {
            errors++
          }
        }
        // direction === 'both': skip existing, only create new
      } else {
        // New ingredient — create stock_item
        const categoryGuess = guessCategory(ingredient.name)
        const row: Record<string, unknown> = {
          name: ingredient.name,
          category: categoryGuess,
          unit: 'unidad',
          current_qty: ingredient.stock ?? 0,
          min_qty: 0,
          cost_per_unit: ingredient.cost ?? 0,
          fudo_ingredient_id: ingredient.id,
          is_active: true,
        }

        const { error } = await supabase.from('stock_items').insert(row)
        if (error) {
          console.error(`Failed to create stock item for ${ingredient.name}:`, error.message)
          errors++
        } else {
          created++
        }
      }
    }

    return NextResponse.json({
      success: true,
      direction,
      totalIngredients: fudoIngredients.length,
      synced,
      created,
      pushed,
      errors,
    })
  } catch (error) {
    console.error('[/api/fudo/sync/stock] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// Category guesser based on ingredient name
// ---------------------------------------------------------------------------

function guessCategory(name: string): string {
  const n = name.toLowerCase()

  if (/leche|crema|manteca|queso|mozzarella|sardo|yogurt|dulce de leche|cheddar/i.test(n)) return 'lacteos'
  if (/cerveza|vino|fernet|gin|carpano|coca|agua|jugo|limon|naranja|mora/i.test(n)) return 'bebidas'
  if (/jamon|lomo|nalga|falda|molida|bondiola|panceta|mortadela|pollo|lengua|osobuco/i.test(n)) return 'carnes'
  if (/tomate|lechuga|papa|cebolla|pimiento|zapall|ajo|apio|acelga|perejil|rucula|zanahoria|berenjena|palta/i.test(n)) return 'verduras'
  if (/banana|manzana|pera|frutilla|arandano|mora|frutos rojos/i.test(n)) return 'frutas'
  if (/harina|levadura|pan |ciabatta|baguetin|brioche|medialuna|brownie|alfajor/i.test(n)) return 'panaderia'
  if (/sal |oregano|aji|pimienta|mostaza|ketchup|salsa|aceite|vinagre|condimento|mermelada|miel/i.test(n)) return 'condimentos'
  if (/detergente|lavandina|servilleta|toalla|bolsa/i.test(n)) return 'limpieza'
  if (/vaso|bolsa dely|caja|filtro|lamina|micro boule/i.test(n)) return 'desechables'
  if (/cafe|cacao|azucar|te |arroz|polenta|avena|granola|cereales|hielo/i.test(n)) return 'otros'

  return 'otros'
}
