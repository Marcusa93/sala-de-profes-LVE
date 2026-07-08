// ---------------------------------------------------------------------------
// Fudo Stock Sync Engine — Bidirectional
// ---------------------------------------------------------------------------
// READS from Fudo: gets real-time stock quantities
// WRITES to Fudo: pushes changes made in the webapp
//
// Source of truth: FUDO for items with fudo_ingredient_id
//                  SUPABASE for items without (local-only)
//
// This is the bridge between the webapp and Fudo POS.
// ---------------------------------------------------------------------------

import { SupabaseClient } from '@supabase/supabase-js'
import { getFudoToken } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FudoIngredient = {
  id: string
  name: string
  stock: number | null
  cost: number | null
  stockControl: boolean
  categoryId?: string
  categoryName?: string
  providerId?: string
}

type FudoProductStock = {
  id: string
  name: string
  stock: number
  cost: number | null
  stockControl: boolean
}

type StockItemRow = {
  id: number | string
  name: string
  unit: string
  category: string
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  current_qty: number
  shelf_life_days?: number | null
  cost_per_unit: number | null
  supplier_id: number | null
  fudo_skip?: boolean | null
}

export type SyncResult = {
  read: { synced: number; total: number; created: number; linked: number; errors: string[] }
  write?: { pushed: number; errors: string[] }
  timestamp: string
  fudoConnected: boolean
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function findDuplicateIds(ids: Array<string | null | undefined>): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const id of ids) {
    if (!id) continue
    if (seen.has(id)) duplicates.add(id)
    else seen.add(id)
  }

  return duplicates
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function inferStockCategoryFromProductName(name: string) {
  const text = normalizeName(name)

  if (/\b(budin|budin|cuadrado|cookie|galleta|alfajor|roll|rosca|rosquita|brownie|medialuna|chipa|pastafrola|pepa|bombita)\b/.test(text)) {
    return 'panaderia'
  }

  if (/\b(empanada|pizza|tortilla|sanguche|ciabatta|baguetin)\b/.test(text)) {
    return 'panaderia'
  }

  if (/\b(coca|pepsi|sprite|fanta|schweppes|aquarius|agua|benedicto|cerveza|vino|fernet|vermut|trumpeter|malbec|lata|botella)\b/.test(text)) {
    return 'bebidas'
  }

  if (/\b(yerba|te|cafe)\b/.test(text)) {
    return 'condimentos'
  }

  return 'otros'
}

function inferShelfLifeDaysFromProductName(name: string): number | null {
  const text = normalizeName(name)

  if (/\b(budin|cuadrado|cookie|galleta|alfajor|roll|rosca|rosquita|brownie|medialuna|chipa|pastafrola|pepa|bombita)\b/.test(text)) {
    return 7
  }

  if (/\b(empanada|tortilla|sanguche|ciabatta|baguetin)\b/.test(text)) {
    return 3
  }

  return null
}

function inferStockCategoryFromIngredientName(name: string) {
  const text = normalizeName(name)

  if (/\b(caja|cajas|carton|sorbete|bolsa|servilleta|vaso|tapa|film|papel)\b/.test(text)) return 'desechables'
  if (/\b(jamon|crudo|cocido|lomo|carne|molida|pollo|filet|panceta|mortadela|ternera|bondiola|chorizo|milanesa|tira)\b/.test(text)) return 'carnes'
  if (/\b(leche|queso|crema|manteca|yogur|helado|cremoso|mozzarella|tybo|azul|cremette)\b/.test(text)) return 'lacteos'
  if (/\b(banana|manzana|limon|naranja|palta|frutilla|pera)\b/.test(text)) return 'frutas'
  if (/\b(papa|tomate|cebolla|lechuga|repollo|verdeo|zanahoria|rucula|berenjena|morron|pepino)\b/.test(text)) return 'verduras'
  if (/\b(harina|azucar|cacao|chocolate|levadura|budin|cookie|alfajor|roll|chipa|medialuna|pan|pimenton|canela|sal|yerba|cafe)\b/.test(text)) return 'panaderia'
  if (/\b(aceite|vinagre|salsa|mayonesa|mostaza|ketchup|condimento)\b/.test(text)) return 'condimentos'

  return 'otros'
}

function inferUnitFromIngredientName(name: string, category: string) {
  const text = normalizeName(name)

  if (/\b(caja|cajas|carton|sorbete|bolsa|servilleta|vaso|tapa|rollo|unidad|unid)\b/.test(text)) return 'unidad'
  if (/\b(leche|aceite|vinagre|jugo|almibar)\b/.test(text)) return 'l'
  if (/\b(jamon|crudo|cocido|lomo|carne|molida|pollo|filet|panceta|mortadela|ternera|bondiola|chorizo|milanesa|tira)\b/.test(text)) return 'kg'
  if (/\b(queso|crema|manteca|cremoso|mozzarella|tybo|azul|cremette|helado)\b/.test(text)) return 'kg'
  if (/\b(harina|azucar|cacao|chocolate|pimenton|canela|sal|yerba|cafe|papas en chips)\b/.test(text)) return 'kg'
  if (/\b(papa|tomate|cebolla|lechuga|repollo|verdeo|zanahoria|rucula|berenjena|morron|pepino)\b/.test(text)) return 'kg'
  if (/\b(banana|manzana|palta|limon|naranja|pera)\b/.test(text)) return 'unidad'
  if (category === 'carnes' || category === 'lacteos' || category === 'verduras') return 'kg'
  if (category === 'frutas') return 'unidad'

  return 'unidad'
}

function inferShelfLifeDaysFromIngredientName(name: string, category: string): number | null {
  if (category === 'carnes') return 3
  if (category === 'lacteos') return 5
  if (category === 'verduras' || category === 'frutas') return 4

  const text = normalizeName(name)
  if (/\b(budin|cuadrado|cookie|galleta|alfajor|roll|rosca|brownie|medialuna|chipa|pastafrola|pepa|bombita)\b/.test(text)) return 7

  return null
}

function stockItemSelect() {
  return 'id, name, unit, category, fudo_ingredient_id, fudo_product_id, current_qty, shelf_life_days, cost_per_unit, supplier_id, fudo_skip'
}

async function markStaleFudoLinksLocal(
  admin: SupabaseClient,
  stockItems: StockItemRow[],
  fudoIngredientIds: Set<string>,
  fudoProductIds: Set<string>,
): Promise<{ stockItems: StockItemRow[]; marked: number; errors: string[] }> {
  const result = {
    stockItems: [] as StockItemRow[],
    marked: 0,
    errors: [] as string[],
  }

  for (const item of stockItems) {
    const staleIngredient = Boolean(item.fudo_ingredient_id && !fudoIngredientIds.has(item.fudo_ingredient_id))
    const staleProduct = Boolean(item.fudo_product_id && !fudoProductIds.has(item.fudo_product_id))

    if (!staleIngredient && !staleProduct) {
      result.stockItems.push(item)
      continue
    }

    const staleId = item.fudo_ingredient_id ?? item.fudo_product_id
    const staleType = item.fudo_ingredient_id ? 'ingrediente' : 'producto'

    const { error } = await admin
      .from('stock_items')
      .update({
        fudo_ingredient_id: staleIngredient ? null : item.fudo_ingredient_id,
        fudo_product_id: staleProduct ? null : item.fudo_product_id,
        fudo_skip: true,
        notes: `Local LVE: tenia vinculo Fudo ${staleType} ${staleId}, pero ese ID ya no existe en Fudo actual.`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    if (error) {
      result.errors.push(`Could not mark stale Fudo link local for ${item.name}: ${error.message}`)
      result.stockItems.push(item)
      continue
    }

    result.marked++
  }

  return result
}

async function ensureFudoProductStockItems(
  admin: SupabaseClient,
  fudoProducts: FudoProductStock[],
  stockItems: StockItemRow[],
): Promise<{ stockItems: StockItemRow[]; created: number; linked: number; errors: string[] }> {
  const result = {
    stockItems: [...stockItems],
    created: 0,
    linked: 0,
    errors: [] as string[],
  }

  const linkedProductIds = new Set(
    result.stockItems
      .map((item) => item.fudo_product_id)
      .filter((id): id is string => Boolean(id)),
  )

  const unlinkedByName = new Map<string, StockItemRow[]>()
  for (const item of result.stockItems) {
    if (item.fudo_skip === true) continue
    if (item.fudo_product_id || item.fudo_ingredient_id) continue
    const key = normalizeName(item.name)
    if (!key) continue
    const group = unlinkedByName.get(key) ?? []
    group.push(item)
    unlinkedByName.set(key, group)
  }

  for (const product of fudoProducts) {
    if (linkedProductIds.has(product.id)) continue

    const exactLocalMatches = unlinkedByName.get(normalizeName(product.name)) ?? []
    if (exactLocalMatches.length === 1) {
      const existing = exactLocalMatches[0]
      const { data, error } = await admin
        .from('stock_items')
        .update({
          fudo_product_id: product.id,
          fudo_ingredient_id: null,
          current_qty: product.stock,
          unit: 'unidad',
          category: inferStockCategoryFromProductName(product.name),
          shelf_life_days: inferShelfLifeDaysFromProductName(product.name),
          cost_per_unit: product.cost ?? existing.cost_per_unit ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select(stockItemSelect())
        .single()

      if (error || !data) {
        result.errors.push(`Could not link Fudo product ${product.name} (${product.id}): ${error?.message ?? 'no row returned'}`)
        continue
      }

      linkedProductIds.add(product.id)
      result.linked++
      result.stockItems = result.stockItems.map((item) => item.id === existing.id ? data as StockItemRow : item)
      continue
    }

    const category = inferStockCategoryFromProductName(product.name)
    const shelfLifeDays = inferShelfLifeDaysFromProductName(product.name)

    const { data, error } = await admin
      .from('stock_items')
      .insert({
        name: product.name,
        unit: 'unidad',
        min_qty: 0,
        current_qty: product.stock,
        cost_per_unit: product.cost ?? 0,
        shelf_life_days: shelfLifeDays,
        supplier_id: null,
        fudo_product_id: product.id,
        fudo_ingredient_id: null,
        fudo_skip: false,
        is_active: true,
        category,
        notes: 'Importado automáticamente desde Fudo producto con control de stock.',
        updated_at: new Date().toISOString(),
      })
      .select(stockItemSelect())
      .single()

    if (error || !data) {
      result.errors.push(`Could not create stock item for Fudo product ${product.name} (${product.id}): ${error?.message ?? 'no row returned'}`)
      continue
    }

    linkedProductIds.add(product.id)
    result.created++
    result.stockItems.push(data as StockItemRow)
  }

  return result
}

async function ensureFudoIngredientStockItems(
  admin: SupabaseClient,
  fudoIngredients: FudoIngredient[],
  stockItems: StockItemRow[],
): Promise<{ stockItems: StockItemRow[]; created: number; linked: number; errors: string[] }> {
  const result = {
    stockItems: [...stockItems],
    created: 0,
    linked: 0,
    errors: [] as string[],
  }

  const linkedIngredientIds = new Set(
    result.stockItems
      .map((item) => item.fudo_ingredient_id)
      .filter((id): id is string => Boolean(id)),
  )

  const unlinkedByName = new Map<string, StockItemRow[]>()
  for (const item of result.stockItems) {
    if (item.fudo_skip === true) continue
    if (item.fudo_product_id || item.fudo_ingredient_id) continue
    const key = normalizeName(item.name)
    if (!key) continue
    const group = unlinkedByName.get(key) ?? []
    group.push(item)
    unlinkedByName.set(key, group)
  }

  for (const ingredient of fudoIngredients) {
    if (!ingredient.stockControl || typeof ingredient.stock !== 'number') continue
    if (linkedIngredientIds.has(ingredient.id)) continue

    const category = inferStockCategoryFromIngredientName(ingredient.name)
    const unit = inferUnitFromIngredientName(ingredient.name, category)
    const shelfLifeDays = inferShelfLifeDaysFromIngredientName(ingredient.name, category)

    const exactLocalMatches = unlinkedByName.get(normalizeName(ingredient.name)) ?? []
    if (exactLocalMatches.length === 1) {
      const existing = exactLocalMatches[0]
      const { data, error } = await admin
        .from('stock_items')
        .update({
          fudo_ingredient_id: ingredient.id,
          fudo_product_id: null,
          current_qty: ingredient.stock,
          unit,
          category,
          shelf_life_days: shelfLifeDays,
          cost_per_unit: ingredient.cost ?? existing.cost_per_unit ?? 0,
          supplier_id: existing.supplier_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select(stockItemSelect())
        .single()

      if (error || !data) {
        result.errors.push(`Could not link Fudo ingredient ${ingredient.name} (${ingredient.id}): ${error?.message ?? 'no row returned'}`)
        continue
      }

      linkedIngredientIds.add(ingredient.id)
      result.linked++
      result.stockItems = result.stockItems.map((item) => item.id === existing.id ? data as StockItemRow : item)
      continue
    }

    const { data, error } = await admin
      .from('stock_items')
      .insert({
        name: ingredient.name,
        unit,
        min_qty: 0,
        current_qty: ingredient.stock,
        cost_per_unit: ingredient.cost ?? 0,
        shelf_life_days: shelfLifeDays,
        supplier_id: null,
        fudo_ingredient_id: ingredient.id,
        fudo_product_id: null,
        fudo_skip: false,
        is_active: true,
        category,
        notes: 'Importado automáticamente desde Fudo ingrediente con control de stock.',
        updated_at: new Date().toISOString(),
      })
      .select(stockItemSelect())
      .single()

    if (error || !data) {
      result.errors.push(`Could not create stock item for Fudo ingredient ${ingredient.name} (${ingredient.id}): ${error?.message ?? 'no row returned'}`)
      continue
    }

    linkedIngredientIds.add(ingredient.id)
    result.created++
    result.stockItems.push(data as StockItemRow)
  }

  return result
}

// ---------------------------------------------------------------------------
// READ: Fetch all ingredients from Fudo with stock
// ---------------------------------------------------------------------------

export async function readFudoStock(): Promise<FudoIngredient[]> {
  const token = await getFudoToken()
  const allIngredients: FudoIngredient[] = []
  let page = 1

  while (page <= 10) {
    const res = await fetch(
      `https://api.fu.do/v1alpha1/ingredients?include=ingredientCategory&page[size]=200&page[number]=${page}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    )

    if (!res.ok) {
      if (res.status === 429) {
        // Rate limited — wait and retry
        await new Promise(r => setTimeout(r, 2000))
        continue
      }
      throw new Error(`Fudo API error: ${res.status}`)
    }

    const data = await res.json()
    const items = data.data ?? []
    const included = data.included ?? []

    // Build category map
    const catMap = new Map<string, string>()
    for (const inc of included) {
      if (inc.type === 'IngredientCategory') {
        catMap.set(inc.id, inc.attributes?.name ?? '')
      }
    }

    for (const item of items) {
      const catRef = item.relationships?.ingredientCategory?.data
      const provRef = item.relationships?.provider?.data as { id?: string } | null | undefined
      allIngredients.push({
        id: item.id,
        name: item.attributes.name,
        stock: asNullableNumber(item.attributes.stock),
        cost: asNullableNumber(item.attributes.cost),
        stockControl: item.attributes.stockControl ?? false,
        categoryId: catRef?.id,
        categoryName: catRef?.id ? catMap.get(catRef.id) : undefined,
        providerId: provRef?.id,
      })
    }

    if (items.length < 200) break
    page++
  }

  return allIngredients
}

// ---------------------------------------------------------------------------
// WRITE: Push a single stock change to Fudo
// ---------------------------------------------------------------------------

export async function writeFudoStock(
  fudoIngredientId: string,
  newQty: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getFudoToken()

    const res = await fetch(`https://api.fu.do/v1alpha1/ingredients/${fudoIngredientId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'Ingredient',
          id: fudoIngredientId,
          attributes: { stock: newQty },
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { success: false, error: `Fudo ${res.status}: ${text.slice(0, 100)}` }
    }

    const data = await res.json()
    const actualStock = data.data?.attributes?.stock

    // Verify the write
    if (typeof actualStock === 'number' && Math.abs(actualStock - newQty) > 0.01) {
      return { success: false, error: `Fudo aceptó pero stock quedó en ${actualStock} (esperado: ${newQty})` }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

async function writeFudoProductStock(
  fudoProductId: string,
  newQty: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { fudo: fudoClient } = await import('@/lib/fudoClient')
    await fudoClient.updateProductStock(fudoProductId, newQty)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error desconocido' }
  }
}

// ---------------------------------------------------------------------------
// SYNC READ: Pull Fudo stock → update Supabase stock_items
// ---------------------------------------------------------------------------

export async function syncFromFudo(admin: SupabaseClient): Promise<SyncResult['read']> {
  const result = { synced: 0, total: 0, created: 0, linked: 0, errors: [] as string[] }

  // 1. Read all Fudo ingredients (now includes cost + providerId)
  // Transport/auth failures must bubble up. Stock cannot pretend it synced.
  const fudoItems = await readFudoStock()

  // 2. Read Fudo products (for finished goods like empanadas)
  const { fudo } = await import('@/lib/fudoClient')
  const products = await fudo.getProducts()
  const fudoProducts: FudoProductStock[] = products
    .filter(p => p.active === true && p.stockControl === true && typeof p.stock === 'number')
    .map(p => ({ id: p.id, name: p.name, stock: p.stock!, cost: p.cost, stockControl: true }))

  result.total = fudoItems.length + fudoProducts.length

  // 3. Get all stock_items (ingredient-linked AND product-linked)
  //    Exclude items marked as fudo_skip — those are local-only
  const { data: initialStockItems } = await admin
    .from('stock_items')
    .select(stockItemSelect())
    .eq('is_active', true)
    .neq('fudo_skip', true)

  if (!initialStockItems) return result

  const fudoIngredientIds = new Set(fudoItems.map((item) => item.id))
  const fudoProductIds = new Set(fudoProducts.map((item) => item.id))
  const staleResult = await markStaleFudoLinksLocal(
    admin,
    initialStockItems as StockItemRow[],
    fudoIngredientIds,
    fudoProductIds,
  )
  result.linked += staleResult.marked
  result.errors.push(...staleResult.errors)

  const importResult = await ensureFudoProductStockItems(
    admin,
    fudoProducts,
    staleResult.stockItems,
  )
  const ingredientImportResult = await ensureFudoIngredientStockItems(
    admin,
    fudoItems,
    importResult.stockItems,
  )
  const stockItems = ingredientImportResult.stockItems
  result.created += importResult.created
  result.created += ingredientImportResult.created
  result.linked += importResult.linked
  result.linked += ingredientImportResult.linked
  result.synced += importResult.created + importResult.linked + ingredientImportResult.created + ingredientImportResult.linked
  result.errors.push(...importResult.errors)
  result.errors.push(...ingredientImportResult.errors)

  // 4. Build supplier map: fudo_provider_id → supplier.id
  const { data: suppliers } = await admin
    .from('suppliers')
    .select('id, fudo_provider_id')
    .not('fudo_provider_id', 'is', null)

  const providerToSupplier = new Map(
    (suppliers ?? []).map(s => [s.fudo_provider_id!, s.id]),
  )

  // 5. Build Fudo maps
  const fudoIngMap = new Map<string, FudoIngredient>()
  for (const fi of fudoItems) {
    fudoIngMap.set(fi.id, fi)
  }

  const fudoProdMap = new Map<string, { name: string; stock: number; cost: number | null }>()
  for (const fp of fudoProducts) {
    fudoProdMap.set(fp.id, fp)
  }

  const duplicateIngredientIds = findDuplicateIds(
    stockItems.map((item) => item.fudo_ingredient_id),
  )
  const duplicateProductIds = findDuplicateIds(
    stockItems.map((item) => item.fudo_product_id),
  )

  for (const id of duplicateIngredientIds) {
    result.errors.push(`Duplicate Fudo ingredient link detected: ${id}`)
  }
  for (const id of duplicateProductIds) {
    result.errors.push(`Duplicate Fudo product link detected: ${id}`)
  }

  const linkedIngredientIds = new Set(
    stockItems
      .map((item) => item.fudo_ingredient_id)
      .filter((id): id is string => Boolean(id)),
  )
  const linkedProductIds = new Set(
    stockItems
      .map((item) => item.fudo_product_id)
      .filter((id): id is string => Boolean(id)),
  )

  for (const fudoItem of fudoItems) {
    if (!fudoItem.stockControl || typeof fudoItem.stock !== 'number') continue
    if (!linkedIngredientIds.has(fudoItem.id)) {
      const importError = ingredientImportResult.errors.some((error) => error.includes(`(${fudoItem.id})`))
      if (!importError) result.errors.push(`Unmapped Fudo ingredient: ${fudoItem.name} (${fudoItem.id})`)
    }
  }

  for (const fudoProduct of fudoProducts) {
    if (!linkedProductIds.has(fudoProduct.id) && !importResult.errors.some((error) => error.includes(`(${fudoProduct.id})`))) {
      result.errors.push(`Unmapped Fudo product with stock control: ${fudoProduct.name} (${fudoProduct.id})`)
    }
  }

  // 6. Update each stock_item with Fudo's current stock, cost, and provider
  for (const si of stockItems) {
    if (
      (si.fudo_ingredient_id && duplicateIngredientIds.has(si.fudo_ingredient_id))
      || (si.fudo_product_id && duplicateProductIds.has(si.fudo_product_id))
    ) {
      continue
    }

    let fudoQty: number | null = null
    let fudoCost: number | null = null
    let fudoProviderId: string | undefined

    // Check ingredient link first
    if (si.fudo_ingredient_id) {
      const fudoItem = fudoIngMap.get(si.fudo_ingredient_id)
      if (!fudoItem) {
        result.errors.push(`Missing Fudo ingredient ${si.fudo_ingredient_id} for stock item ${si.id}`)
      }
      if (fudoItem?.stockControl && typeof fudoItem.stock === 'number') {
        fudoQty = Math.round(fudoItem.stock * 100) / 100
      }
      if (fudoItem?.stockControl && fudoItem.stock === null) {
        result.errors.push(`Fudo ingredient ${si.fudo_ingredient_id} has null stock for stock item ${si.id}`)
      }
      if (fudoItem) {
        fudoCost = typeof fudoItem.cost === 'number' && fudoItem.cost > 0 ? fudoItem.cost : null
        fudoProviderId = fudoItem.providerId
      }
    }

    // Then check product link (product takes precedence for finished goods)
    if (si.fudo_product_id) {
      const fudoProd = fudoProdMap.get(si.fudo_product_id)
      if (!fudoProd) {
        result.errors.push(`Missing Fudo product ${si.fudo_product_id} for stock item ${si.id}`)
      }
      if (fudoProd) {
        fudoQty = Math.round(fudoProd.stock * 100) / 100
        if (fudoProd.cost && fudoProd.cost > 0) {
          fudoCost = fudoProd.cost
        }
      }
    }

    // Build update payload — only include fields that changed
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    let hasChanges = false

    if (fudoQty !== null && Math.abs(si.current_qty - fudoQty) >= 0.01) {
      update.current_qty = fudoQty
      hasChanges = true
    }

    if (fudoCost !== null && si.cost_per_unit !== fudoCost) {
      update.cost_per_unit = fudoCost
      hasChanges = true
    }

    // Link supplier if not already set and Fudo has provider
    if (!si.supplier_id && fudoProviderId) {
      const supplierId = providerToSupplier.get(fudoProviderId)
      if (supplierId) {
        update.supplier_id = supplierId
        hasChanges = true
      }
    }

    if (si.fudo_ingredient_id) {
      const fudoItem = fudoIngMap.get(si.fudo_ingredient_id)
      if (fudoItem) {
        const inferredCategory = inferStockCategoryFromIngredientName(fudoItem.name)
        const inferredUnit = inferUnitFromIngredientName(fudoItem.name, inferredCategory)
        const inferredShelfLife = inferShelfLifeDaysFromIngredientName(fudoItem.name, inferredCategory)

        if (si.unit !== inferredUnit) {
          update.unit = inferredUnit
          hasChanges = true
        }
        if (si.category !== inferredCategory) {
          update.category = inferredCategory
          hasChanges = true
        }
        if (inferredShelfLife !== null && si.shelf_life_days !== inferredShelfLife) {
          update.shelf_life_days = inferredShelfLife
          hasChanges = true
        }
      }
    }

    if (si.fudo_product_id) {
      const fudoProduct = fudoProdMap.get(si.fudo_product_id)
      if (fudoProduct) {
        const inferredCategory = inferStockCategoryFromProductName(fudoProduct.name)
        const inferredShelfLife = inferShelfLifeDaysFromProductName(fudoProduct.name)

        if (si.unit !== 'unidad') {
          update.unit = 'unidad'
          hasChanges = true
        }
        if (si.category !== inferredCategory) {
          update.category = inferredCategory
          hasChanges = true
        }
        if (inferredShelfLife !== null && si.shelf_life_days !== inferredShelfLife) {
          update.shelf_life_days = inferredShelfLife
          hasChanges = true
        }
      }
    }

    if (!hasChanges) {
      result.synced++
      continue
    }

    const { error } = await admin
      .from('stock_items')
      .update(update)
      .eq('id', si.id)

    if (error) {
      result.errors.push(`${si.id}: ${error.message}`)
    } else {
      result.synced++
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// SYNC WRITE: Push Supabase change → Fudo
// Called when a user updates stock in the webapp
// ---------------------------------------------------------------------------

export async function syncToFudo(
  admin: SupabaseClient,
  stockItemId: string,
  newQty: number,
  userId?: string,
): Promise<{ success: boolean; fudoSynced: boolean; error?: string }> {
  // 1. Get the stock_item to find fudo link
  const { data: item } = await admin
    .from('stock_items')
    .select('id, name, fudo_ingredient_id, fudo_product_id, fudo_skip, current_qty')
    .eq('id', stockItemId)
    .single()

  if (!item) return { success: false, fudoSynced: false, error: 'Item no encontrado' }

  // If item is marked as fudo_skip, treat as local-only
  const skipFudo = (item as Record<string, unknown>).fudo_skip === true

  const fudoLink = item.fudo_ingredient_id || item.fudo_product_id

  if (!fudoLink && !skipFudo) {
    return {
      success: false,
      fudoSynced: false,
      error: 'Item sin mapeo Fudo. Mapealo o marcalo como local explícito antes de actualizar stock.',
    }
  }

  // 2. Fudo-linked stock must write to Fudo first. If Fudo fails, local stock stays unchanged.
  if (fudoLink && !skipFudo) {
    const fudoResult = item.fudo_ingredient_id
      ? await writeFudoStock(item.fudo_ingredient_id, newQty)
      : await writeFudoProductStock(item.fudo_product_id!, newQty)

    if (!fudoResult.success) {
      console.error(`[FudoSync] Write failed for ${item.name}: ${fudoResult.error}`)
      await admin.from('audit_trail').insert({
        user_id: userId ?? null,
        action: 'fudo_sync_error',
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: stockItemId,
        description: `Stock NO actualizado en LVE porque Fudo falló para ${item.name}: ${fudoResult.error}`,
        metadata: { fudo_id: fudoLink, attempted_qty: newQty, local_qty_kept: item.current_qty },
      })

      return { success: false, fudoSynced: false, error: fudoResult.error }
    }
  }

  // 3. Update Supabase only after Fudo accepted the change, or for local-only items.
  const { error: dbError } = await admin
    .from('stock_items')
    .update({ current_qty: newQty, updated_at: new Date().toISOString() })
    .eq('id', stockItemId)

  if (dbError) return { success: false, fudoSynced: false, error: dbError.message }

  // 4. Log the change
  await admin.from('stock_logs').insert({
    stock_item_id: stockItemId,
    user_id: userId ?? null,
    action: 'update',
    old_qty: item.current_qty,
    new_qty: newQty,
  })

  if (fudoLink && !skipFudo) {
    await admin.from('audit_trail').insert({
      user_id: userId ?? null,
      action: 'fudo_stock_sync',
      module: 'stock',
      entity_type: 'stock_item',
      entity_id: stockItemId,
      description: `${item.name}: ${item.current_qty} → ${newQty} (sincronizado con Fudo)`,
      metadata: { fudo_id: fudoLink, old_qty: item.current_qty, new_qty: newQty, synced: true },
    })

    return { success: true, fudoSynced: true }
  }

  // No Fudo ID — local only
  return { success: true, fudoSynced: false }
}

// ---------------------------------------------------------------------------
// SYNC PRODUCTION: Push updated stock to Fudo after production completes
// The RPC already updated stock_items — this only pushes to Fudo API
// ---------------------------------------------------------------------------

export async function syncProductionToFudo(
  admin: SupabaseClient,
  movements: { stock_item_id: number | string; change: number }[],
  userId?: string,
): Promise<{ synced: number; errors: string[] }> {
  const result = { synced: 0, errors: [] as string[] }

  // Unique stock item IDs from movements
  const itemIds = [...new Set(movements.map((m) => m.stock_item_id))]

  for (const itemId of itemIds) {
    const { data: item } = await admin
      .from('stock_items')
      .select('id, name, fudo_ingredient_id, fudo_product_id, fudo_skip, current_qty')
      .eq('id', itemId)
      .single()

    if (!item) {
      result.errors.push(`${itemId}: item de stock no encontrado`)
      continue
    }

    // Skip items flagged as local-only
    if ((item as Record<string, unknown>).fudo_skip === true) continue

    if (!item.fudo_ingredient_id && !item.fudo_product_id) {
      result.errors.push(`${item.name}: sin mapeo Fudo ni local explícito`)
      continue
    }

    let fudoResult: { success: boolean; error?: string }

    if (item.fudo_ingredient_id) {
      fudoResult = await writeFudoStock(item.fudo_ingredient_id, item.current_qty)
    } else {
      // Product-linked item — push via product endpoint
      try {
        const { fudo: fudoClient } = await import('@/lib/fudoClient')
        await fudoClient.updateProductStock(item.fudo_product_id!, item.current_qty)
        fudoResult = { success: true }
      } catch (err) {
        fudoResult = { success: false, error: err instanceof Error ? err.message : 'Error' }
      }
    }

    if (fudoResult.success) {
      result.synced++
      await admin.from('audit_trail').insert({
        user_id: userId ?? null,
        action: 'fudo_production_sync',
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: String(itemId),
        description: `Producción: ${item.name} → ${item.current_qty} (sincronizado con Fudo)`,
        metadata: { fudo_ingredient_id: item.fudo_ingredient_id, qty: item.current_qty },
      })
    } else {
      result.errors.push(`${item.name}: ${fudoResult.error}`)
      await admin.from('audit_trail').insert({
        user_id: userId ?? null,
        action: 'fudo_sync_error',
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: String(itemId),
        description: `Error sync producción ${item.name} con Fudo: ${fudoResult.error}`,
        metadata: { fudo_ingredient_id: item.fudo_ingredient_id, attempted_qty: item.current_qty },
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// FULL BIDIRECTIONAL SYNC
// Reads from Fudo first, then returns current state
// ---------------------------------------------------------------------------

export async function fullSync(admin: SupabaseClient): Promise<SyncResult> {
  const readResult = await syncFromFudo(admin)

  return {
    read: readResult,
    timestamp: new Date().toISOString(),
    fudoConnected: true,
  }
}
