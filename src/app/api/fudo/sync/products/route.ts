import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/products
// ---------------------------------------------------------------------------
// Sincroniza categorías y productos desde Fudo hacia Supabase.
//
// - Upsert de categorías en `menu_categories` (match por fudo_category_id).
// - Upsert de productos en `menu_items` (match por fudo_product_id).
// - Fudo es source of truth para nombre, precio y categoría.
// - Sala de Profes mantiene recipe_id, costo interno, etc.
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await userSupabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['encargado', 'socio', 'chef'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: 'Sin permisos' }, { status: 403 })
    }

    const supabase = createAdminClient()

    // 1) Obtener datos de Fudo
    const [fudoCategories, fudoProducts] = await Promise.all([
      fudo.getCategories(),
      fudo.getProducts(),
    ])

    // 2) Upsert categorías en menu_categories
    //    Usamos fudo_category_id como clave de match.
    let importedCategories = 0

    if (fudoCategories.length > 0) {
      const categoryRows = fudoCategories.map((cat, idx) => ({
        name: cat.name,
        fudo_category_id: cat.id,
        sort_order: idx,
      }))

      // Supabase no soporta upsert con ON CONFLICT en columnas no-unique
      // por defecto. Necesitamos un unique index en fudo_category_id.
      // Como lo hacemos por batches, primero buscamos existentes.
      const { data: existingCats } = await supabase
        .from('menu_categories')
        .select('id, fudo_category_id')

      const existingMap = new Map(
        (existingCats ?? [])
          .filter((c) => c.fudo_category_id)
          .map((c) => [c.fudo_category_id!, c.id]),
      )

      for (const row of categoryRows) {
        const existingId = existingMap.get(row.fudo_category_id!)

        if (existingId) {
          // Update
          await supabase
            .from('menu_categories')
            .update({ name: row.name, sort_order: row.sort_order })
            .eq('id', existingId)
        } else {
          // Insert
          await supabase.from('menu_categories').insert(row)
        }
        importedCategories++
      }
    }

    // 3) Refetch categorías para tener el mapeo fudo_category_id → id interno
    const { data: allCategories } = await supabase
      .from('menu_categories')
      .select('id, fudo_category_id')

    const catIdMap = new Map(
      (allCategories ?? [])
        .filter((c) => c.fudo_category_id)
        .map((c) => [c.fudo_category_id!, c.id]),
    )

    // 4) Upsert productos en menu_items
    let importedProducts = 0

    if (fudoProducts.length > 0) {
      // Buscar existentes por fudo_product_id
      const { data: existingItems } = await supabase
        .from('menu_items')
        .select('id, fudo_product_id')

      const existingItemMap = new Map(
        (existingItems ?? [])
          .filter((m) => m.fudo_product_id)
          .map((m) => [m.fudo_product_id!, m.id]),
      )

      for (const product of fudoProducts) {
        // Extract category from JSON:API relationships
        const catRel = product._relationships?.productCategory?.data as { id: string } | null
        const menuCategoryId = catRel?.id
          ? catIdMap.get(catRel.id) ?? null
          : null

        const row: Record<string, unknown> = {
          name: product.name,
          fudo_product_id: product.id,
          sale_price: product.price,
          category: 'otros',
          menu_category_id: menuCategoryId,
          is_active: product.active ?? true,
        }

        // Optional columns (may not exist yet)
        if (product.cost != null) row.cost_price = product.cost
        if (product.code != null) row.fudo_code = product.code

        const existingId = existingItemMap.get(product.id)

        if (existingId) {
          const updateData: Record<string, unknown> = {
            name: row.name,
            sale_price: row.sale_price,
            menu_category_id: row.menu_category_id,
            is_active: row.is_active,
          }
          if (row.cost_price !== undefined) updateData.cost_price = row.cost_price
          if (row.fudo_code !== undefined) updateData.fudo_code = row.fudo_code

          const { error } = await supabase
            .from('menu_items')
            .update(updateData)
            .eq('id', existingId)
          if (error) console.error(`Update failed for ${product.name}:`, error.message)
          else importedProducts++
        } else {
          const { error } = await supabase.from('menu_items').insert(row)
          if (error) {
            // Retry without optional columns
            delete row.cost_price
            delete row.fudo_code
            const { error: err2 } = await supabase.from('menu_items').insert(row)
            if (err2) console.error(`Insert failed for ${product.name}:`, err2.message)
            else importedProducts++
          } else {
            importedProducts++
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      importedCategories,
      importedProducts,
    })
  } catch (error) {
    console.error('[/api/fudo/sync/products] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 },
    )
  }
}
