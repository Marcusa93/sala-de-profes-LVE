import { SupabaseClient } from '@supabase/supabase-js'
import { fudo, type FudoSale } from '@/lib/fudoClient'
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
    const fudoSales: FudoSale[] = await fudo.getSales({ from: options.from, to: options.to })
    result.totalSales = fudoSales.length

    if (fudoSales.length === 0) {
      await finishFudoSyncEvent(admin, eventId, 'success', { responsePayload: result })
      return result
    }

    const flatRows: FudoSaleRow[] = []

    for (const sale of fudoSales.slice(0, options.limit ?? 300)) {
      try {
        const items = await fudo.getSaleItems(sale.id)
        for (const item of items) {
          const prodRel = (item._relationships?.product?.data ?? {}) as { id?: string }
          flatRows.push({
            fudo_sale_item_id: item.id,
            fudo_ticket_id: sale.id,
            fudo_product_id: String(prodRel?.id ?? item.id),
            quantity: Number(item.quantity) || 1,
            sold_at: String(sale.createdAt ?? sale.closedAt ?? new Date().toISOString()),
            raw_payload: {
              sale_id: sale.id,
              sale_item_id: item.id,
              item_name: item.name,
              price: item.price,
              sale_type: sale.saleType,
              operation: options.operation ?? 'sales_import',
            },
          })
        }
      } catch (err) {
        result.errors.push(`Venta ${sale.id}: ${err instanceof Error ? err.message : 'error al leer items'}`)
      }
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
