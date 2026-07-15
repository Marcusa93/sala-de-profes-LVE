import { SupabaseClient } from '@supabase/supabase-js'
import { fudo } from '@/lib/fudoClient'
import {
  createFudoSyncEvent,
  finishFudoSyncEvent,
  recordFudoIncident,
} from '@/lib/fudo/sync-events'

type ImportSalesOptions = {
  from?: string
  to?: string
  limit?: number
  userId?: string | null
  operation?: string
}

type FudoSaleRow = {
  fudo_sale_item_id: string
  fudo_ticket_id: string
  fudo_product_id: string
  quantity: number
  sold_at: string
  raw_payload: Record<string, unknown>
}

export type FudoSalesImportResult = {
  imported: number
  totalSales: number
  totalItems: number
  errors: string[]
}

export async function importFudoSales(
  admin: SupabaseClient,
  options: ImportSalesOptions = {},
): Promise<FudoSalesImportResult> {
  const result: FudoSalesImportResult = {
    imported: 0,
    totalSales: 0,
    totalItems: 0,
    errors: [],
  }

  const eventId = await createFudoSyncEvent(admin, {
    operation: options.operation ?? 'sales_import',
    direction: 'fudo_to_lve',
    entityType: 'fudo_sales',
    entityId: options.from ?? 'latest',
    fudoType: 'sale',
    requestPayload: {
      from: options.from ?? null,
      to: options.to ?? null,
      limit: options.limit ?? null,
    },
    createdBy: options.userId ?? null,
  })

  try {
    // Una sola pasada paginada con include=items.product: el endpoint
    // /sales/{id}/items devuelve 404 en la API real de Fudo (verificado
    // 2026-07-14) y además hacía N+1 requests que superaban el timeout.
    const flatRows: FudoSaleRow[] = []
    let salesCount = 0

    type JsonApiRow = { type: string; id: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data: unknown }> }

    let page = 1
    while (page <= 30) {
      const res = await fudo.fetch<{ data?: JsonApiRow[]; included?: JsonApiRow[] }>(
        `/sales?include=items.product&sort=-createdAt&page[size]=200&page[number]=${page}`
      )
      const salesData = res.data ?? []
      const included = res.included ?? []

      const itemMap = new Map<string, JsonApiRow>()
      for (const r of included) {
        if (r.type === 'Item') itemMap.set(r.id, r)
      }

      let allBeforeRange = salesData.length > 0
      for (const sale of salesData) {
        const createdAt = String(sale.attributes?.createdAt ?? '')
        const argDate = new Date(createdAt).toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)

        if (options.from && argDate >= options.from) allBeforeRange = false
        if (options.from && argDate < options.from) continue
        if (!options.from) allBeforeRange = false
        if (options.to && argDate > options.to) continue
        if (String(sale.attributes?.saleState) !== 'CLOSED') continue

        salesCount++
        const refs = (sale.relationships?.items?.data ?? []) as Array<{ id: string }>
        for (const ref of refs) {
          const item = itemMap.get(ref.id)
          if (!item || item.attributes?.canceled) continue
          const prodRef = (item.relationships as Record<string, { data: unknown }> | undefined)?.product?.data as { id?: string } | undefined
          flatRows.push({
            fudo_sale_item_id: item.id,
            fudo_ticket_id: sale.id,
            fudo_product_id: String(prodRef?.id ?? item.id),
            quantity: Number(item.attributes?.quantity ?? 1) || 1,
            sold_at: createdAt || new Date().toISOString(),
            raw_payload: {
              sale_id: sale.id,
              sale_item_id: item.id,
              item_name: item.attributes?.name ?? null,
              price: Number(item.attributes?.price ?? 0),
              sale_type: sale.attributes?.saleType ?? null,
              operation: options.operation ?? 'sales_import',
            },
          })
        }
      }

      if (allBeforeRange || salesData.length < 200) break
      page++
    }

    result.totalSales = salesCount

    if (salesCount === 0) {
      await finishFudoSyncEvent(admin, eventId, 'success', { responsePayload: result })
      return result
    }

    result.totalItems = flatRows.length
    if (flatRows.length === 0) {
      await finishFudoSyncEvent(admin, eventId, result.errors.length > 0 ? 'failed' : 'success', {
        responsePayload: result,
        errorMessage: result.errors.join('; ') || null,
      })
      return result
    }

    let query = admin
      .from('fudo_sales')
      .select('fudo_sale_item_id')
      .not('fudo_sale_item_id', 'is', null)

    if (options.from) query = query.gte('sold_at', options.from)
    if (options.to) query = query.lte('sold_at', options.to)

    const { data: existing, error: existingError } = await query
    if (existingError) throw existingError

    const existingSet = new Set((existing ?? []).map((row) => row.fudo_sale_item_id).filter(Boolean))
    const newRows = flatRows.filter((row) => !existingSet.has(row.fudo_sale_item_id))

    for (let i = 0; i < newRows.length; i += 50) {
      const batch = newRows.slice(i, i + 50)
      const { error } = await admin.from('fudo_sales').insert(batch)
      if (error) result.errors.push(error.message)
      else result.imported += batch.length
    }

    await finishFudoSyncEvent(admin, eventId, result.errors.length > 0 ? 'failed' : 'success', {
      responsePayload: result,
      errorMessage: result.errors.join('; ') || null,
    })

    if (result.errors.length > 0) {
      await recordFudoIncident(admin, {
        source: 'sales_import',
        code: 'fudo_sales_import_partial_failure',
        severity: 'high',
        entityType: 'fudo_sales',
        entityId: options.from ?? 'latest',
        fudoType: 'sale',
        title: 'Importación de ventas Fudo con errores',
        detail: result.errors.join('; '),
        payload: result as unknown as Record<string, unknown>,
      })
    }

    return result
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error al importar ventas Fudo'
    result.errors.push(error)
    await finishFudoSyncEvent(admin, eventId, 'failed', { responsePayload: result, errorMessage: error })
    await recordFudoIncident(admin, {
      source: 'sales_import',
      code: 'fudo_sales_import_failed',
      severity: 'critical',
      entityType: 'fudo_sales',
      entityId: options.from ?? 'latest',
      fudoType: 'sale',
      title: 'No se pudieron importar ventas desde Fudo',
      detail: error,
      payload: {
        from: options.from ?? null,
        to: options.to ?? null,
      },
    })
    throw err
  }
}
