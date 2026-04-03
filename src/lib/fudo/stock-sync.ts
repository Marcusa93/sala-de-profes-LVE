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
      allIngredients.push({
        id: item.id,
        name: item.attributes.name,
        stock: item.attributes.stock ?? 0,
        cost: item.attributes.cost ?? 0,
        stockControl: item.attributes.stockControl ?? false,
        categoryId: catRef?.id,
        categoryName: catRef?.id ? catMap.get(catRef.id) : undefined,
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
    // 1. Read all Fudo ingredients
    const fudoItems = await readFudoStock()
    result.total = fudoItems.length

    // 2. Get all stock_items with fudo_ingredient_id
    const { data: stockItems } = await admin
      .from('stock_items')
      .select('id, fudo_ingredient_id, current_qty')
      .not('fudo_ingredient_id', 'is', null)
      .eq('is_active', true)

    if (!stockItems) return result

    // 3. Build Fudo map
    const fudoMap = new Map<string, FudoIngredient>()
    for (const fi of fudoItems) {
      fudoMap.set(fi.id, fi)
    }

    // 4. Update each stock_item with Fudo's current stock
    for (const si of stockItems) {
      const fudoItem = fudoMap.get(si.fudo_ingredient_id!)
      if (!fudoItem) continue
      if (!fudoItem.stockControl) continue

      // Only update if different (avoid unnecessary writes)
      const fudoQty = Math.round(fudoItem.stock * 100) / 100
      if (Math.abs(si.current_qty - fudoQty) < 0.01) {
        result.synced++
        continue
      }

      const { error } = await admin
        .from('stock_items')
        .update({
          current_qty: fudoQty,
          updated_at: new Date().toISOString(),
        })
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
  // 1. Get the stock_item to find fudo_ingredient_id
  const { data: item } = await admin
    .from('stock_items')
    .select('id, name, fudo_ingredient_id, current_qty')
    .eq('id', stockItemId)
    .single()

  if (!item) return { success: false, fudoSynced: false, error: 'Item no encontrado' }

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
  }).catch(() => {}) // Non-blocking

  // 4. If has Fudo ID, push to Fudo
  if (item.fudo_ingredient_id) {
    const fudoResult = await writeFudoStock(item.fudo_ingredient_id, newQty)

    if (!fudoResult.success) {
      // Supabase updated but Fudo failed — log the desync
      console.error(`[FudoSync] Write failed for ${item.name}: ${fudoResult.error}`)
      await admin.from('audit_trail').insert({
        user_id: userId ?? null,
        action: 'fudo_sync_error',
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: stockItemId,
        description: `Error al sincronizar ${item.name} con Fudo: ${fudoResult.error}`,
        metadata: { fudo_ingredient_id: item.fudo_ingredient_id, attempted_qty: newQty },
      }).catch(() => {})

      return { success: true, fudoSynced: false, error: fudoResult.error }
    }

    // Audit success
    await admin.from('audit_trail').insert({
      user_id: userId ?? null,
      action: 'fudo_stock_sync',
      module: 'stock',
      entity_type: 'stock_item',
      entity_id: stockItemId,
      description: `${item.name}: ${item.current_qty} → ${newQty} (sincronizado con Fudo)`,
      metadata: { fudo_ingredient_id: item.fudo_ingredient_id, old_qty: item.current_qty, new_qty: newQty, synced: true },
    }).catch(() => {})

    return { success: true, fudoSynced: true }
  }

  // No Fudo ID — local only
  return { success: true, fudoSynced: false }
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
