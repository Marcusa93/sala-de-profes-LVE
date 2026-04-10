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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FudoIngredient = {
  id: string
  name: string
  stock: number
  cost: number
  stockControl: boolean
  categoryId?: string
  categoryName?: string
  providerId?: string
}

export type SyncResult = {
  read: { synced: number; total: number; errors: string[] }
  write?: { pushed: number; errors: string[] }
  timestamp: string
}

type StockItemRow = {
  id: string
  name: string
  fudo_ingredient_id: string | null
  current_qty: number
  min_qty: number
  category: string
}

// ---------------------------------------------------------------------------
// Fudo Auth — get JWT token
// ---------------------------------------------------------------------------

let cachedToken: string | null = null
let tokenExpiry = 0

async function getFudoToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  const login = process.env.FUDO_LOGIN
  const password = process.env.FUDO_PASSWORD
  if (!login || !password) throw new Error('FUDO_LOGIN/FUDO_PASSWORD not configured')

  const res = await fetch('https://auth.fu.do/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  })

  if (!res.ok) throw new Error(`Fudo auth failed: ${res.status}`)

  const { token } = await res.json()
  cachedToken = token
  tokenExpiry = Date.now() + 20 * 60 * 60 * 1000 // 20 hours
  return token
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
        stock: item.attributes.stock ?? 0,
        cost: item.attributes.cost ?? 0,
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

// ---------------------------------------------------------------------------
// SYNC READ: Pull Fudo stock → update Supabase stock_items
// ---------------------------------------------------------------------------

export async function syncFromFudo(admin: SupabaseClient): Promise<SyncResult['read']> {
  const result = { synced: 0, total: 0, errors: [] as string[] }

  try {
    // 1. Read all Fudo ingredients (now includes cost + providerId)
    const fudoItems = await readFudoStock()

    // 2. Read Fudo products (for finished goods like empanadas)
    let fudoProducts: { id: string; stock: number; cost: number | null; stockControl: boolean }[] = []
    try {
      const { fudo } = await import('@/lib/fudoClient')
      const products = await fudo.getProducts()
      fudoProducts = products
        .filter(p => p.stockControl && p.stock != null)
        .map(p => ({ id: p.id, stock: p.stock!, cost: p.cost, stockControl: true }))
    } catch {
      result.errors.push('Warning: no se pudieron traer productos de Fudo')
    }

    result.total = fudoItems.length + fudoProducts.length

    // 3. Get all stock_items (ingredient-linked AND product-linked)
    //    Exclude items marked as fudo_skip — those are local-only
    const { data: stockItems } = await admin
      .from('stock_items')
      .select('id, fudo_ingredient_id, fudo_product_id, current_qty, cost_per_unit, supplier_id')
      .eq('is_active', true)
      .neq('fudo_skip', true)

    if (!stockItems) return result

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

    const fudoProdMap = new Map<string, { stock: number; cost: number | null }>()
    for (const fp of fudoProducts) {
      fudoProdMap.set(fp.id, fp)
    }

    // 6. Update each stock_item with Fudo's current stock, cost, and provider
    for (const si of stockItems) {
      let fudoQty: number | null = null
      let fudoCost: number | null = null
      let fudoProviderId: string | undefined

      // Check ingredient link first
      if (si.fudo_ingredient_id) {
        const fudoItem = fudoIngMap.get(si.fudo_ingredient_id)
        if (fudoItem?.stockControl) {
          fudoQty = Math.round(fudoItem.stock * 100) / 100
        }
        if (fudoItem) {
          fudoCost = fudoItem.cost > 0 ? fudoItem.cost : null
          fudoProviderId = fudoItem.providerId
        }
      }

      // Then check product link (product takes precedence for finished goods)
      if (si.fudo_product_id) {
        const fudoProd = fudoProdMap.get(si.fudo_product_id)
        if (fudoProd) {
          fudoQty = Math.round(fudoProd.stock * 100) / 100
          if (fudoProd.cost && fudoProd.cost > 0) {
            fudoCost = fudoProd.cost
          }
        }
      }

      if (fudoQty === null && fudoCost === null && !fudoProviderId) continue

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
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : 'Error de sync')
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

  // 2. Update in Supabase first
  const { error: dbError } = await admin
    .from('stock_items')
    .update({ current_qty: newQty, updated_at: new Date().toISOString() })
    .eq('id', stockItemId)

  if (dbError) return { success: false, fudoSynced: false, error: dbError.message }

  // 3. Log the change
  await admin.from('stock_logs').insert({
    stock_item_id: stockItemId,
    user_id: userId ?? null,
    action: 'update',
    old_qty: item.current_qty,
    new_qty: newQty,
  })

  // 4. If has Fudo link (ingredient or product) AND not skipped, push to Fudo
  const fudoLink = item.fudo_ingredient_id || item.fudo_product_id
  if (fudoLink && !skipFudo) {
    let fudoResult: { success: boolean; error?: string }

    if (item.fudo_ingredient_id) {
      fudoResult = await writeFudoStock(item.fudo_ingredient_id, newQty)
    } else {
      // Product-linked item
      try {
        const { fudo: fudoClient } = await import('@/lib/fudoClient')
        await fudoClient.updateProductStock(item.fudo_product_id!, newQty)
        fudoResult = { success: true }
      } catch (err) {
        fudoResult = { success: false, error: err instanceof Error ? err.message : 'Error' }
      }
    }

    if (!fudoResult.success) {
      console.error(`[FudoSync] Write failed for ${item.name}: ${fudoResult.error}`)
      await admin.from('audit_trail').insert({
        user_id: userId ?? null,
        action: 'fudo_sync_error',
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: stockItemId,
        description: `Error al sincronizar ${item.name} con Fudo: ${fudoResult.error}`,
        metadata: { fudo_id: fudoLink, attempted_qty: newQty },
      })

      return { success: true, fudoSynced: false, error: fudoResult.error }
    }

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
      .select('id, name, fudo_ingredient_id, fudo_product_id, current_qty')
      .eq('id', itemId)
      .single()

    if (!item?.fudo_ingredient_id && !item?.fudo_product_id) continue // No Fudo link — skip

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
  }
}
