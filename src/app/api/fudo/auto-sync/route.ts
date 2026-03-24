import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// GET /api/fudo/auto-sync — Lightweight sync for dashboard polling
// Uses include=items.product to fetch sales + items + product names in ONE request
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const revalidate = 0

type IncludedResource = {
  type: string
  id: string
  attributes: Record<string, unknown>
  relationships?: Record<string, { data: unknown }>
}

export async function GET() {
  try {
    const admin = createAdminClient()
    // Use Argentina timezone for "today"
    const now = new Date()
    const argDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const today = argDate.toISOString().slice(0, 10)

    // 1) Fetch sales with items.product included (single request!)
    let newSalesCount = 0
    let syncError: string | null = null

    try {
      const response = await fudo.fetch<{
        data: IncludedResource[]
        included?: IncludedResource[]
      }>('/sales?include=items.product&sort=-closedAt&page[size]=100&page[number]=1')

      const salesData = Array.isArray(response.data) ? response.data : []
      const included = response.included ?? []


      // Build lookup maps for included resources
      const itemMap = new Map<string, IncludedResource>()
      const productMap = new Map<string, IncludedResource>()
      for (const r of included) {
        if (r.type === 'Item') itemMap.set(r.id, r)
        if (r.type === 'Product') productMap.set(r.id, r)
      }

      // Filter today's sales
      const todaySales = salesData.filter((s) => {
        const d = (String(s.attributes.createdAt ?? s.attributes.closedAt ?? '')).slice(0, 10)
        return d === today
      })


      if (todaySales.length > 0) {
        const flatRows: {
          fudo_ticket_id: string
          fudo_product_id: string
          quantity: number
          sold_at: string
          raw_payload: Record<string, unknown>
        }[] = []

        for (const sale of todaySales) {
          const saleItemRefs = ((sale.relationships?.items?.data ?? []) as { type: string; id: string }[])

          if (saleItemRefs.length > 0) {
            for (const ref of saleItemRefs) {
              const item = itemMap.get(ref.id)
              if (!item) continue

              // Get product from item relationship
              const productRef = (item.relationships?.product?.data ?? {}) as { id?: string }
              const product = productRef?.id ? productMap.get(productRef.id) : null

              flatRows.push({
                fudo_ticket_id: sale.id,
                fudo_product_id: String(productRef?.id ?? item.id),
                quantity: Number(item.attributes.quantity) || 1,
                sold_at: String(sale.attributes.createdAt ?? sale.attributes.closedAt ?? new Date().toISOString()),
                raw_payload: {
                  sale_id: sale.id,
                  item_name: String(product?.attributes?.name ?? `Item #${item.id}`),
                  price: Number(item.attributes.price ?? 0),
                  sale_type: String(sale.attributes.saleType ?? ''),
                  total: Number(sale.attributes.total ?? 0),
                  sale_state: String(sale.attributes.saleState ?? ''),
                },
              })
            }
          } else {
            // No items — register ticket total
            flatRows.push({
              fudo_ticket_id: sale.id,
              fudo_product_id: 'ticket_total',
              quantity: 1,
              sold_at: String(sale.attributes.createdAt ?? sale.attributes.closedAt ?? new Date().toISOString()),
              raw_payload: {
                sale_id: sale.id,
                item_name: `Ticket #${sale.id}`,
                price: Number(sale.attributes.total ?? 0),
                sale_type: String(sale.attributes.saleType ?? ''),
                total: Number(sale.attributes.total ?? 0),
                sale_state: String(sale.attributes.saleState ?? ''),
              },
            })
          }
        }

        if (flatRows.length > 0) {
          // Dedup against existing
          const { data: existing } = await admin
            .from('fudo_sales')
            .select('fudo_ticket_id, fudo_product_id')
            .gte('sold_at', today + 'T00:00:00')

          const existingSet = new Set(
            (existing ?? []).map((s) => `${s.fudo_ticket_id}__${s.fudo_product_id}`),
          )
          const newRows = flatRows.filter(
            (r) => !existingSet.has(`${r.fudo_ticket_id}__${r.fudo_product_id}`),
          )


          // Deduplicate within batch (same ticket can have same product multiple times — merge quantities)
          const deduped = new Map<string, typeof newRows[0]>()
          for (const row of newRows) {
            const key = `${row.fudo_ticket_id}__${row.fudo_product_id}`
            const existing = deduped.get(key)
            if (existing) {
              existing.quantity += row.quantity
            } else {
              deduped.set(key, { ...row })
            }
          }
          const dedupedRows = [...deduped.values()]

          for (let i = 0; i < dedupedRows.length; i += 50) {
            const batch = dedupedRows.slice(i, i + 50)
            const { error } = await admin.from('fudo_sales').upsert(batch, {
              onConflict: 'fudo_ticket_id,fudo_product_id',
            })
            if (error) {
              console.error('[auto-sync] Upsert error:', error.message)
            } else {
              newSalesCount += batch.length
            }
          }
        }
      }
    } catch (e) {
      syncError = e instanceof Error ? e.message : 'Error de sync'
    }

    // 2) Read today's sales from DB
    const { data: todayDbSales } = await admin
      .from('fudo_sales')
      .select('fudo_ticket_id, fudo_product_id, quantity, sold_at, raw_payload')
      .gte('sold_at', today + 'T00:00:00')
      .order('sold_at', { ascending: false })

    // 3) Build dashboard data directly from raw_payload (no extra DB lookups needed)
    const sales = (todayDbSales ?? []).map((s) => {
      const raw = (s.raw_payload ?? {}) as Record<string, unknown>
      return {
        ticketId: s.fudo_ticket_id,
        productId: s.fudo_product_id,
        productName: String(raw.item_name ?? `Producto #${s.fudo_product_id}`),
        saleType: String(raw.sale_type ?? ''),
        quantity: s.quantity,
        price: Number(raw.price ?? 0),
        total: s.quantity * Number(raw.price ?? 0),
        soldAt: s.sold_at,
      }
    })

    // Aggregations
    const totalRevenue = sales.reduce((s, i) => s + i.total, 0)
    const totalItems = sales.reduce((s, i) => s + i.quantity, 0)
    const uniqueTickets = new Set(sales.map((s) => s.ticketId)).size

    // Top products
    const productAgg = new Map<string, { name: string; qty: number; revenue: number }>()
    for (const s of sales) {
      if (s.productId === 'ticket_total') continue
      const existing = productAgg.get(s.productId)
      if (existing) {
        existing.qty += s.quantity
        existing.revenue += s.total
      } else {
        productAgg.set(s.productId, { name: s.productName, qty: s.quantity, revenue: s.total })
      }
    }
    const topProducts = [...productAgg.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 15)

    // By sale type (EAT-IN, TAKEAWAY, DELIVERY)
    const typeAgg = new Map<string, { tickets: Set<string>; revenue: number }>()
    for (const s of sales) {
      const t = s.saleType || 'Otro'
      const existing = typeAgg.get(t)
      if (existing) {
        existing.tickets.add(s.ticketId)
        existing.revenue += s.total
      } else {
        typeAgg.set(t, { tickets: new Set([s.ticketId]), revenue: s.total })
      }
    }
    const typeLabels: Record<string, string> = {
      'EAT-IN': 'En local',
      'TAKEAWAY': 'Para llevar',
      'DELIVERY': 'Delivery',
    }
    const bySaleType = [...typeAgg.entries()]
      .map(([type, data]) => ({
        name: typeLabels[type] ?? type,
        tickets: data.tickets.size,
        revenue: data.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue)

    // By hour
    const hourAgg = new Map<number, { tickets: Set<string>; revenue: number; items: number }>()
    for (const s of sales) {
      const hour = new Date(s.soldAt).getHours()
      const existing = hourAgg.get(hour)
      if (existing) {
        existing.tickets.add(s.ticketId)
        existing.revenue += s.total
        existing.items += s.quantity
      } else {
        hourAgg.set(hour, { tickets: new Set([s.ticketId]), revenue: s.total, items: s.quantity })
      }
    }
    const byHour = Array.from({ length: 24 }, (_, h) => {
      const data = hourAgg.get(h)
      return {
        hour: `${String(h).padStart(2, '0')}:00`,
        tickets: data?.tickets.size ?? 0,
        revenue: data?.revenue ?? 0,
        items: data?.items ?? 0,
      }
    }).filter((h) => h.tickets > 0 || (h.hour >= '08:00' && h.hour <= '23:00'))

    // Recent tickets (last 10)
    const recentTicketIds = [...new Set(sales.map((s) => s.ticketId))].slice(0, 10)
    const recentSales = recentTicketIds.map((tid) => {
      const ticketItems = sales.filter((s) => s.ticketId === tid && s.productId !== 'ticket_total')
      const ticketTotal = sales.filter((s) => s.ticketId === tid)
      return {
        ticketId: tid,
        time: ticketItems[0]?.soldAt ?? ticketTotal[0]?.soldAt ?? '',
        saleType: ticketItems[0]?.saleType ?? ticketTotal[0]?.saleType ?? '',
        items: ticketItems.map((i) => ({ name: i.productName, qty: i.quantity, price: i.price })),
        total: ticketTotal.reduce((s, i) => s + i.total, 0),
      }
    })

    return NextResponse.json({
      synced: newSalesCount,
      syncError,
      lastSync: new Date().toISOString(),
      today: {
        totalRevenue,
        totalItems,
        uniqueTickets,
        avgTicket: uniqueTickets > 0 ? Math.round(totalRevenue / uniqueTickets) : 0,
        topProducts,
        bySaleType,
        byHour,
        recentSales,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error', today: null },
      { status: 500 },
    )
  }
}
