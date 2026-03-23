import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// GET /api/fudo/auto-sync — Lightweight sync for dashboard polling
// Syncs sales + products, returns today's sales data for the dashboard
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const admin = createAdminClient()
    const today = new Date().toISOString().slice(0, 10)

    // 1) Try to sync sales from Fudo (graceful if rate-limited)
    let newSalesCount = 0
    let syncError: string | null = null
    try {
      const fudoSales = await fudo.getSales()
      const todaySales = fudoSales.filter((s) => {
        const d = (s.createdAt || s.closedAt || '').slice(0, 10)
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

        for (const sale of todaySales.slice(0, 100)) {
          try {
            const items = await fudo.getSaleItems(sale.id)
            if (items.length > 0) {
              for (const item of items) {
                const prodRel = (item._relationships?.product?.data ?? {}) as { id?: string }
                flatRows.push({
                  fudo_ticket_id: sale.id,
                  fudo_product_id: String(prodRel?.id ?? item.id),
                  quantity: Number(item.quantity) || 1,
                  sold_at: String(sale.createdAt ?? sale.closedAt ?? new Date().toISOString()),
                  raw_payload: {
                    sale_id: sale.id,
                    item_name: item.name,
                    price: item.price,
                    sale_type: sale.saleType,
                    total: sale.total,
                  },
                })
              }
            } else {
              // No item detail — register the ticket itself with total
              flatRows.push({
                fudo_ticket_id: sale.id,
                fudo_product_id: 'ticket_total',
                quantity: 1,
                sold_at: String(sale.createdAt ?? sale.closedAt ?? new Date().toISOString()),
                raw_payload: {
                  sale_id: sale.id,
                  item_name: `Ticket #${sale.id}`,
                  price: sale.total,
                  sale_type: sale.saleType,
                  total: sale.total,
                  sale_state: sale.saleState,
                },
              })
            }
          } catch { /* skip failed sale */ }
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

          for (let i = 0; i < newRows.length; i += 50) {
            const batch = newRows.slice(i, i + 50)
            const { error } = await admin.from('fudo_sales').insert(batch)
            if (!error) newSalesCount += batch.length
          }
        }
      }
    } catch (e) {
      syncError = e instanceof Error ? e.message : 'Error de sync'
    }

    // 2) Read today's sales from DB for dashboard
    const { data: todayDbSales } = await admin
      .from('fudo_sales')
      .select('fudo_ticket_id, fudo_product_id, quantity, sold_at, raw_payload')
      .gte('sold_at', today + 'T00:00:00')
      .order('sold_at', { ascending: false })

    // 3) Get product names from menu_items
    const productIds = [...new Set((todayDbSales ?? []).map((s) => s.fudo_product_id))]
    const { data: menuItems } = productIds.length > 0
      ? await admin
          .from('menu_items')
          .select('fudo_product_id, name, price, category_id')
          .in('fudo_product_id', productIds)
      : { data: [] }

    const productMap = new Map(
      (menuItems ?? []).map((m) => [m.fudo_product_id, m]),
    )

    // 4) Get category names
    const categoryIds = [...new Set((menuItems ?? []).map((m) => m.category_id).filter(Boolean))]
    const { data: categories } = categoryIds.length > 0
      ? await admin
          .from('menu_categories')
          .select('id, name')
          .in('id', categoryIds)
      : { data: [] }

    const categoryMap = new Map(
      (categories ?? []).map((c) => [c.id, c.name]),
    )

    // 5) Build dashboard data
    const sales = (todayDbSales ?? []).map((s) => {
      const product = productMap.get(s.fudo_product_id)
      const rawName = (s.raw_payload as Record<string, unknown>)?.item_name
      const rawPrice = (s.raw_payload as Record<string, unknown>)?.price
      return {
        ticketId: s.fudo_ticket_id,
        productId: s.fudo_product_id,
        productName: product?.name ?? String(rawName ?? `Producto #${s.fudo_product_id}`),
        category: product?.category_id ? categoryMap.get(product.category_id) ?? 'Sin categoría' : 'Sin categoría',
        quantity: s.quantity,
        price: product?.price ?? Number(rawPrice ?? 0),
        total: s.quantity * (product?.price ?? Number(rawPrice ?? 0)),
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

    // By category
    const categoryAgg = new Map<string, { qty: number; revenue: number }>()
    for (const s of sales) {
      const existing = categoryAgg.get(s.category)
      if (existing) {
        existing.qty += s.quantity
        existing.revenue += s.total
      } else {
        categoryAgg.set(s.category, { qty: s.quantity, revenue: s.total })
      }
    }
    const byCategory = [...categoryAgg.entries()]
      .map(([name, data]) => ({ name, ...data }))
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

    // Recent sales (last 10 unique tickets)
    const recentTickets = [...new Set(sales.map((s) => s.ticketId))].slice(0, 10)
    const recentSales = recentTickets.map((tid) => {
      const ticketItems = sales.filter((s) => s.ticketId === tid)
      return {
        ticketId: tid,
        time: ticketItems[0]?.soldAt ?? '',
        items: ticketItems.map((i) => ({ name: i.productName, qty: i.quantity, total: i.total })),
        total: ticketItems.reduce((s, i) => s + i.total, 0),
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
        topProducts,
        byCategory,
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
