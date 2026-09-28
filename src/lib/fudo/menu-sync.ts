import type { SupabaseClient } from '@supabase/supabase-js'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// Menú desde Fudo: categorías y productos → menu_categories / menu_items
// ---------------------------------------------------------------------------
// Fudo manda en nombre, precio, categoría y si está activo. La app conserva
// receta, costo interno y cómo descuenta stock. Solo se escribe lo que cambió.
// Lo usan el botón de /admin/fudo y el pulso diario (precios al día solos).
// ---------------------------------------------------------------------------

export type MenuSyncResult = { importedCategories: number; importedProducts: number; cambiados: number; nuevos: number; platosVinculados: unknown }

const igual = (a: unknown, b: unknown) => (a == null && b == null) || String(a) === String(b)

export async function sincronizarMenu(supabase: SupabaseClient): Promise<MenuSyncResult> {
  const [fudoCategories, fudoProducts] = await Promise.all([fudo.getCategories(), fudo.getProducts()])

  // Categorías
  let importedCategories = 0
  if (fudoCategories.length > 0) {
    const { data: existingCats } = await supabase.from('menu_categories').select('id, fudo_category_id, name, sort_order')
    const existing = new Map((existingCats ?? []).filter((c) => c.fudo_category_id).map((c) => [String(c.fudo_category_id), c]))
    for (const [idx, cat] of fudoCategories.entries()) {
      const ex = existing.get(String(cat.id))
      if (ex) {
        if (!igual(ex.name, cat.name) || !igual(ex.sort_order, idx)) {
          await supabase.from('menu_categories').update({ name: cat.name, sort_order: idx }).eq('id', ex.id)
        }
      } else {
        await supabase.from('menu_categories').insert({ name: cat.name, fudo_category_id: cat.id, sort_order: idx })
      }
      importedCategories++
    }
  }

  const { data: allCategories } = await supabase.from('menu_categories').select('id, fudo_category_id')
  const catIdMap = new Map((allCategories ?? []).filter((c) => c.fudo_category_id).map((c) => [String(c.fudo_category_id), c.id]))

  // Productos
  let importedProducts = 0
  let cambiados = 0
  let nuevos = 0
  if (fudoProducts.length > 0) {
    const { data: existingItems } = await supabase.from('menu_items')
      .select('id, fudo_product_id, name, sale_price, menu_category_id, is_active, cost_price, fudo_code')
    type Ex = { id: string; fudo_product_id: string | null; name: string; sale_price: number | null; menu_category_id: string | null; is_active: boolean; cost_price: number | null; fudo_code: string | null }
    const existing = new Map(((existingItems ?? []) as Ex[]).filter((m) => m.fudo_product_id).map((m) => [String(m.fudo_product_id), m]))

    for (const product of fudoProducts) {
      const catRel = product._relationships?.productCategory?.data as { id: string } | null
      const menuCategoryId = catRel?.id ? catIdMap.get(String(catRel.id)) ?? null : null
      const ex = existing.get(String(product.id))

      if (ex) {
        const updateData: Record<string, unknown> = {}
        if (!igual(ex.name, product.name)) updateData.name = product.name
        if (!igual(ex.sale_price, product.price)) updateData.sale_price = product.price
        if (!igual(ex.menu_category_id, menuCategoryId)) updateData.menu_category_id = menuCategoryId
        if (ex.is_active !== (product.active ?? true)) updateData.is_active = product.active ?? true
        if (product.cost != null && !igual(ex.cost_price, product.cost)) updateData.cost_price = product.cost
        if (product.code != null && !igual(ex.fudo_code, product.code)) updateData.fudo_code = product.code
        if (Object.keys(updateData).length > 0) {
          const { error } = await supabase.from('menu_items').update(updateData).eq('id', ex.id)
          if (error) console.error(`Update failed for ${product.name}:`, error.message)
          else cambiados++
        }
        importedProducts++
      } else {
        const row: Record<string, unknown> = {
          name: product.name,
          fudo_product_id: product.id,
          sale_price: product.price,
          category: 'otros',
          menu_category_id: menuCategoryId,
          is_active: product.active ?? true,
        }
        if (product.cost != null) row.cost_price = product.cost
        if (product.code != null) row.fudo_code = product.code
        const { error } = await supabase.from('menu_items').insert(row)
        if (error) {
          delete row.cost_price
          delete row.fudo_code
          const { error: err2 } = await supabase.from('menu_items').insert(row)
          if (err2) { console.error(`Insert failed for ${product.name}:`, err2.message); continue }
        }
        importedProducts++
        nuevos++
      }
    }
  }

  // Platos nuevos → su receta, si el nombre coincide exacto (ej. versión PedidosYa)
  const platosVinculados = await import('@/lib/ventas/vinculos-recetas')
    .then(({ autoVincularPlatos }) => autoVincularPlatos(supabase))
    .catch(() => null)

  return { importedCategories, importedProducts, cambiados, nuevos, platosVinculados }
}
