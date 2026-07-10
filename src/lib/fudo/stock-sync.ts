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
import {
  createFudoSyncEvent,
  finishFudoSyncEvent,
  recordFudoIncident,
  type FudoEntityType,
} from '@/lib/fudo/sync-events'

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

export type SyncResult = {
  read: { synced: number; total: number; errors: string[] }
  write?: { pushed: number; errors: string[] }
  timestamp: string
  fudoConnected: boolean
}

type FudoWriteContext = {
  admin: SupabaseClient
  operation: string
  stockItemId?: string | number | null
  userId?: string | null
  entityType?: string | null
  entityId?: string | number | null
  fudoType: FudoEntityType
  fudoId: string
  oldQty?: number | null
  newQty: number
  reason?: string | null
  note?: string | null
  idempotencyKey?: string | null
}

type StockWriteOptions = {
  reason?: 'physical_count' | 'manual_adjustment'
  note?: string | null
}

function stockWriteNeedsNote(currentQty: number, newQty: number, unit?: string | null) {
  const abs = Math.abs(newQty - currentQty)
  const pct = currentQty > 0 ? abs / currentQty : abs > 0 ? 1 : 0
  const normalizedUnit = (unit ?? '').toLowerCase()
  const threshold = normalizedUnit.includes('kg') || normalizedUnit.includes('kilo')
    ? Math.max(0.5, currentQty * 0.12)
    : Math.max(2, currentQty * 0.15)
  return abs >= threshold || pct >= 0.25
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
  context?: FudoWriteContext,
): Promise<{ success: boolean; error?: string }> {
  const eventId = context
    ? await createFudoSyncEvent(context.admin, {
      operation: context.operation,
      direction: 'lve_to_fudo',
      entityType: context.entityType ?? 'stock_item',
      entityId: context.entityId ?? context.stockItemId,
      stockItemId: context.stockItemId,
      fudoType: 'ingredient',
      fudoId: fudoIngredientId,
      idempotencyKey: context.idempotencyKey ?? null,
      requestPayload: {
        old_qty: context.oldQty ?? null,
        new_qty: newQty,
        reason: context.reason ?? null,
        note: context.note ?? null,
      },
      createdBy: context.userId ?? null,
    })
    : null

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
      const error = `Fudo ${res.status}: ${text.slice(0, 100)}`
      if (context) {
        await finishFudoSyncEvent(context.admin, eventId, 'failed', { errorMessage: error })
        await recordFudoIncident(context.admin, {
          source: 'write_stock',
          code: 'fudo_write_failed',
          severity: 'critical',
          entityType: context.entityType ?? 'stock_item',
          entityId: context.entityId ?? context.stockItemId,
          stockItemId: context.stockItemId,
          fudoType: 'ingredient',
          fudoId: fudoIngredientId,
          title: 'Fudo rechazó una escritura de stock',
          detail: error,
          payload: { operation: context.operation, new_qty: newQty },
        })
      }
      return { success: false, error }
    }

    const data = await res.json()
    const actualStock = data.data?.attributes?.stock

    // Verify the write
    if (typeof actualStock === 'number' && Math.abs(actualStock - newQty) > 0.01) {
      const error = `Fudo aceptó pero stock quedó en ${actualStock} (esperado: ${newQty})`
      if (context) {
        await finishFudoSyncEvent(context.admin, eventId, 'failed', {
          responsePayload: { actual_stock: actualStock },
          errorMessage: error,
        })
        await recordFudoIncident(context.admin, {
          source: 'write_stock',
          code: 'fudo_write_verification_failed',
          severity: 'critical',
          entityType: context.entityType ?? 'stock_item',
          entityId: context.entityId ?? context.stockItemId,
          stockItemId: context.stockItemId,
          fudoType: 'ingredient',
          fudoId: fudoIngredientId,
          title: 'Fudo no confirmó la cantidad esperada',
          detail: error,
          payload: { operation: context.operation, expected_qty: newQty, actual_stock: actualStock },
        })
      }
      return { success: false, error }
    }

    if (context) {
      await finishFudoSyncEvent(context.admin, eventId, 'success', {
        responsePayload: { actual_stock: typeof actualStock === 'number' ? actualStock : newQty },
      })
    }

    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error desconocido'
    if (context) {
      await finishFudoSyncEvent(context.admin, eventId, 'failed', { errorMessage: error })
      await recordFudoIncident(context.admin, {
        source: 'write_stock',
        code: 'fudo_write_exception',
        severity: 'critical',
        entityType: context.entityType ?? 'stock_item',
        entityId: context.entityId ?? context.stockItemId,
        stockItemId: context.stockItemId,
        fudoType: 'ingredient',
        fudoId: fudoIngredientId,
        title: 'No se pudo escribir stock en Fudo',
        detail: error,
        payload: { operation: context.operation, new_qty: newQty },
      })
    }
    return { success: false, error }
  }
}

async function writeFudoProductStock(
  fudoProductId: string,
  newQty: number,
  context?: FudoWriteContext,
): Promise<{ success: boolean; error?: string }> {
  const eventId = context
    ? await createFudoSyncEvent(context.admin, {
      operation: context.operation,
      direction: 'lve_to_fudo',
      entityType: context.entityType ?? 'stock_item',
      entityId: context.entityId ?? context.stockItemId,
      stockItemId: context.stockItemId,
      fudoType: 'product',
      fudoId: fudoProductId,
      idempotencyKey: context.idempotencyKey ?? null,
      requestPayload: {
        old_qty: context.oldQty ?? null,
        new_qty: newQty,
        reason: context.reason ?? null,
        note: context.note ?? null,
      },
      createdBy: context.userId ?? null,
    })
    : null

  try {
    const { fudo: fudoClient } = await import('@/lib/fudoClient')
    await fudoClient.updateProductStock(fudoProductId, newQty)
    const products = await fudoClient.getProducts()
    const product = products.find((item) => String(item.id) === String(fudoProductId))
    const actualStock = product?.stock

    if (typeof actualStock === 'number' && Math.abs(actualStock - newQty) > 0.01) {
      const error = `Fudo aceptó producto pero stock quedó en ${actualStock} (esperado: ${newQty})`
      if (context) {
        await finishFudoSyncEvent(context.admin, eventId, 'failed', {
          responsePayload: { actual_stock: actualStock },
          errorMessage: error,
        })
        await recordFudoIncident(context.admin, {
          source: 'write_stock',
          code: 'fudo_product_write_verification_failed',
          severity: 'critical',
          entityType: context.entityType ?? 'stock_item',
          entityId: context.entityId ?? context.stockItemId,
          stockItemId: context.stockItemId,
          fudoType: 'product',
          fudoId: fudoProductId,
          title: 'Fudo producto no confirmó la cantidad esperada',
          detail: error,
          payload: { operation: context.operation, expected_qty: newQty, actual_stock: actualStock },
        })
      }
      return { success: false, error }
    }

    if (context) {
      await finishFudoSyncEvent(context.admin, eventId, 'success', {
        responsePayload: { actual_stock: typeof actualStock === 'number' ? actualStock : newQty },
      })
    }

    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error desconocido'
    if (context) {
      await finishFudoSyncEvent(context.admin, eventId, 'failed', { errorMessage: error })
      await recordFudoIncident(context.admin, {
        source: 'write_stock',
        code: 'fudo_product_write_exception',
        severity: 'critical',
        entityType: context.entityType ?? 'stock_item',
        entityId: context.entityId ?? context.stockItemId,
        stockItemId: context.stockItemId,
        fudoType: 'product',
        fudoId: fudoProductId,
        title: 'No se pudo escribir stock de producto en Fudo',
        detail: error,
        payload: { operation: context.operation, new_qty: newQty },
      })
    }
    return { success: false, error }
  }
}

// ---------------------------------------------------------------------------
// SYNC READ: Pull Fudo stock → update Supabase stock_items
// ---------------------------------------------------------------------------

export async function syncFromFudo(admin: SupabaseClient): Promise<SyncResult['read']> {
  const result = { synced: 0, total: 0, errors: [] as string[] }
  const eventId = await createFudoSyncEvent(admin, {
    operation: 'stock_read_sync',
    direction: 'fudo_to_lve',
    entityType: 'stock',
    entityId: 'all',
    requestPayload: { source: 'syncFromFudo' },
  })

  try {

  // 1. Read all Fudo ingredients (now includes cost + providerId)
  // Transport/auth failures must bubble up. Stock cannot pretend it synced.
  const fudoItems = await readFudoStock()

  // 2. Read Fudo products (for finished goods like empanadas)
  const { fudo } = await import('@/lib/fudoClient')
  const products = await fudo.getProducts()
  const fudoProducts: { id: string; name: string; stock: number; cost: number | null; stockControl: boolean }[] = products
    .filter(p => p.stockControl && p.stock != null)
    .map(p => ({ id: p.id, name: p.name, stock: p.stock!, cost: p.cost, stockControl: true }))

  result.total = fudoItems.length + fudoProducts.length

  // 3. Get all stock_items (ingredient-linked AND product-linked)
  //    Exclude items marked as fudo_skip — those are local-only
  const { data: stockItems } = await admin
    .from('stock_items')
    .select('id, fudo_ingredient_id, fudo_product_id, current_qty, cost_per_unit, supplier_id')
    .eq('is_active', true)
    .neq('fudo_skip', true)

  if (!stockItems) {
    await finishFudoSyncEvent(admin, eventId, 'success', {
      responsePayload: { synced: result.synced, total: result.total, errors: result.errors },
    })
    return result
  }

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
    if (!fudoItem.stockControl) continue
    if (!linkedIngredientIds.has(fudoItem.id)) {
      result.errors.push(`Unmapped Fudo ingredient: ${fudoItem.name} (${fudoItem.id})`)
    }
  }

  for (const fudoProduct of fudoProducts) {
    if (!linkedProductIds.has(fudoProduct.id)) {
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

  await finishFudoSyncEvent(admin, eventId, result.errors.length > 0 ? 'failed' : 'success', {
    responsePayload: { synced: result.synced, total: result.total, errors: result.errors },
    errorMessage: result.errors.length > 0 ? `${result.errors.length} inconsistencias Fudo` : null,
  })

  return result
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error desconocido'
    await finishFudoSyncEvent(admin, eventId, 'failed', { errorMessage: error })
    await recordFudoIncident(admin, {
      source: 'stock_read_sync',
      code: 'fudo_read_failed',
      severity: 'critical',
      entityType: 'stock',
      entityId: 'all',
      title: 'No se pudo leer stock desde Fudo',
      detail: error,
      payload: { operation: 'stock_read_sync' },
    })
    throw err
  }
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
  options: StockWriteOptions = {},
): Promise<{ success: boolean; fudoSynced: boolean; error?: string }> {
  // 1. Get the stock_item to find fudo link
  const { data: item } = await admin
    .from('stock_items')
    .select('id, name, unit, fudo_ingredient_id, fudo_product_id, fudo_skip, current_qty')
    .eq('id', stockItemId)
    .single()

  if (!item) return { success: false, fudoSynced: false, error: 'Item no encontrado' }

  // If item is marked as fudo_skip, treat as local-only
  const skipFudo = (item as Record<string, unknown>).fudo_skip === true

  const fudoLink = item.fudo_ingredient_id || item.fudo_product_id
  const writeReason = options.reason ?? 'physical_count'
  const writeOperation = writeReason === 'physical_count' ? 'physical_stock_count' : 'manual_stock_write'
  const note = options.note?.trim() || null

  if (writeReason === 'physical_count' && stockWriteNeedsNote(item.current_qty, newQty, item.unit) && !note) {
    return {
      success: false,
      fudoSynced: false,
      error: 'La diferencia de conteo es relevante. Agregá una nota para auditoría.',
    }
  }

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
      ? await writeFudoStock(item.fudo_ingredient_id, newQty, {
        admin,
        operation: writeOperation,
        stockItemId,
        userId,
        entityType: 'stock_item',
        entityId: stockItemId,
        fudoType: 'ingredient',
        fudoId: item.fudo_ingredient_id,
        oldQty: item.current_qty,
        newQty,
        reason: writeReason,
        note,
      })
      : await writeFudoProductStock(item.fudo_product_id!, newQty, {
        admin,
        operation: writeOperation,
        stockItemId,
        userId,
        entityType: 'stock_item',
        entityId: stockItemId,
        fudoType: 'product',
        fudoId: item.fudo_product_id!,
        oldQty: item.current_qty,
        newQty,
        reason: writeReason,
        note,
      })

    if (!fudoResult.success) {
      console.error(`[FudoSync] Write failed for ${item.name}: ${fudoResult.error}`)
      await admin.from('audit_trail').insert({
        user_id: userId ?? null,
        action: 'fudo_sync_error',
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: stockItemId,
        description: `Stock NO actualizado en LVE porque Fudo falló para ${item.name}: ${fudoResult.error}`,
        metadata: { fudo_id: fudoLink, attempted_qty: newQty, local_qty_kept: item.current_qty, reason: writeReason, note },
      })

      return { success: false, fudoSynced: false, error: fudoResult.error }
    }
  }

  // 3. Update Supabase only after Fudo accepted the change, or for local-only items.
  const { error: dbError } = await admin
    .from('stock_items')
    .update({ current_qty: newQty, updated_at: new Date().toISOString() })
    .eq('id', stockItemId)

  if (dbError) {
    await recordFudoIncident(admin, {
      source: 'write_stock',
      code: 'lve_update_after_fudo_failed',
      severity: 'critical',
      entityType: 'stock_item',
      entityId: stockItemId,
      stockItemId,
      fudoType: item.fudo_ingredient_id ? 'ingredient' : 'product',
      fudoId: fudoLink,
      title: 'Fudo cambió pero LVE no pudo guardar el nuevo stock',
      detail: dbError.message,
      payload: { old_qty: item.current_qty, new_qty: newQty },
    })

    return { success: false, fudoSynced: false, error: dbError.message }
  }

  // 4. Log the change
  await admin.from('stock_logs').insert({
    stock_item_id: stockItemId,
    user_id: userId ?? null,
    action: writeReason,
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
      metadata: { fudo_id: fudoLink, old_qty: item.current_qty, new_qty: newQty, synced: true, reason: writeReason, note },
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
      fudoResult = await writeFudoStock(item.fudo_ingredient_id, item.current_qty, {
        admin,
        operation: 'production_stock_write',
        stockItemId: itemId,
        userId,
        entityType: 'production_movement',
        entityId: itemId,
        fudoType: 'ingredient',
        fudoId: item.fudo_ingredient_id,
        newQty: item.current_qty,
      })
    } else {
      fudoResult = await writeFudoProductStock(item.fudo_product_id!, item.current_qty, {
        admin,
        operation: 'production_stock_write',
        stockItemId: itemId,
        userId,
        entityType: 'production_movement',
        entityId: itemId,
        fudoType: 'product',
        fudoId: item.fudo_product_id!,
        newQty: item.current_qty,
      })
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
        metadata: {
          fudo_ingredient_id: item.fudo_ingredient_id,
          fudo_product_id: item.fudo_product_id,
          qty: item.current_qty,
        },
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
        metadata: {
          fudo_ingredient_id: item.fudo_ingredient_id,
          fudo_product_id: item.fudo_product_id,
          attempted_qty: item.current_qty,
        },
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
