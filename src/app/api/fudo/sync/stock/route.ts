import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/stock
// ---------------------------------------------------------------------------
// Sync bidireccional de ingredientes Y productos Fudo ↔ stock_items.
//
// 1) Trae ingredientes de Fudo (materias primas con stock real).
// 2) Trae productos de Fudo (productos terminados con stock — empanadas, etc).
// 3) Para cada item:
//    - Si ya existe un stock_item con ese fudo_ingredient_id o fudo_product_id
//      → actualiza qty en la dirección indicada.
//    - Si no existe → crea un stock_item nuevo con los datos de Fudo.
// 4) `direction`:
//    - "fudo_to_app" (default): Fudo es source of truth → actualiza stock_items
//    - "app_to_fudo": Webapp es source of truth → PATCH stock en Fudo
//    - "both": Trae nuevos de Fudo, pero no sobreescribe qty existentes
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const direction: string = body?.direction ?? 'fudo_to_app'

    const supabase = createAdminClient()

    // 1) Fetch Fudo ingredients AND products in parallel
    const [fudoIngredients, fudoProducts] = await Promise.all([
      fudo.getIngredients(),
      fudo.getProducts(),
    ])

    // 2) Fetch existing stock_items (both ingredient-linked and product-linked)
    const { data: existingItems } = await supabase
      .from('stock_items')
      .select('id, name, current_qty, fudo_ingredient_id, fudo_product_id')

    const byIngredientId = new Map(
      (existingItems ?? [])
        .filter((i) => i.fudo_ingredient_id)
        .map((i) => [i.fudo_ingredient_id!, i]),
    )

    const byProductId = new Map(
      (existingItems ?? [])
        .filter((i) => i.fudo_product_id)
        .map((i) => [i.fudo_product_id!, i]),
    )

    let synced = 0
    let created = 0
    let pushed = 0
    let errors = 0
    let productsSynced = 0

    // ── Sync ingredients (materias primas) ──
    for (const ingredient of fudoIngredients) {
      const existing = byIngredientId.get(ingredient.id)

      if (existing) {
        if (direction === 'fudo_to_app') {
          if (ingredient.stock != null) {
            const { error } = await supabase
              .from('stock_items')
              .update({ current_qty: ingredient.stock })
              .eq('id', existing.id)
            if (error) errors++
            else synced++
          }
        } else if (direction === 'app_to_fudo') {
          try {
            await fudo.updateIngredientStock(ingredient.id, existing.current_qty)
            pushed++
          } catch {
            errors++
          }
        }
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

    // ── Sync products (productos terminados: empanadas, etc.) ──
    // Solo sincroniza productos que tienen stockControl habilitado en Fudo
    for (const product of fudoProducts) {
      if (!product.stockControl || product.stock == null) continue

      const existing = byProductId.get(product.id)

      if (existing) {
        if (direction === 'fudo_to_app') {
          // Fudo es source of truth → sobreescribir qty
          const fudoQty = Math.round((product.stock ?? 0) * 100) / 100
          if (Math.abs(existing.current_qty - fudoQty) < 0.01) {
            productsSynced++
            continue
          }
          const { error } = await supabase
            .from('stock_items')
            .update({ current_qty: fudoQty })
            .eq('id', existing.id)
          if (error) errors++
          else productsSynced++
        } else if (direction === 'app_to_fudo') {
          try {
            await fudo.updateProductStock(product.id, existing.current_qty)
            pushed++
          } catch {
            errors++
          }
        }
      }
      // No creamos stock_items para productos nuevos automáticamente
      // — eso se hace via /api/fudo/sync/products → menu_items
    }

    return NextResponse.json({
      success: true,
      direction,
      totalIngredients: fudoIngredients.length,
      totalProducts: fudoProducts.filter(p => p.stockControl).length,
      synced,
      productsSynced,
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
