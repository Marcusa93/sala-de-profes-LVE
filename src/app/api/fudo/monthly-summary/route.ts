import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fudo } from '@/lib/fudoClient'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, min } from 'date-fns'

// ---------------------------------------------------------------------------
// GET /api/fudo/monthly-summary?month=2026-03
// Fetches all sales for a month and aggregates top products + daily totals
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const monthParam = request.nextUrl.searchParams.get('month')
    const refDate = monthParam ? new Date(monthParam + '-15') : new Date()
    const start = startOfMonth(refDate)
    const end = min([endOfMonth(refDate), new Date()])
    const days = eachDayOfInterval({ start, end })

    // Fetch sales page by page until we cover all days in the month
    const allSales: Array<{
      id: string
      total: number
      state: string
      createdAt: string
      items: Array<{ name: string; qty: number; price: number }>
    }> = []

    const startStr = format(start, 'yyyy-MM-dd')
    const endStr = format(end, 'yyyy-MM-dd')

    type JsonApiRow = { type: string; id: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data: unknown }> }

    let page = 1
    const maxPages = 20
    while (page <= maxPages) {
      try {
        const res = await fudo.fetch<{ data?: JsonApiRow[]; included?: JsonApiRow[] }>(
          `/sales?include=items.product&sort=-createdAt&page[size]=200&page[number]=${page}`
        )

        const salesData = res.data ?? []
        const included = res.included ?? []

        // Build maps
        const itemMap = new Map<string, Record<string, unknown>>()
        const productMap = new Map<string, Record<string, unknown>>()
        for (const r of included) {
          if (r.type === 'Item') itemMap.set(r.id, r)
          if (r.type === 'Product') productMap.set(r.id, r)
        }

        let foundBefore = false
        for (const sale of salesData) {
          const createdAt = String(sale.attributes?.createdAt ?? '')
          // Convert to Argentina date
          const argDate = new Date(createdAt).toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)

          if (argDate < startStr) { foundBefore = true; continue }
          if (argDate > endStr) continue

          // Extract items
          const saleItems: Array<{ name: string; qty: number; price: number }> = []
          const itemRefs = (sale.relationships?.items?.data ?? []) as Array<{ id: string }>
          for (const ref of itemRefs) {
            const item = itemMap.get(ref.id) as Record<string, unknown> | undefined
            if (!item) continue
            const attrs = item.attributes as Record<string, unknown> | undefined
            if (attrs?.canceled) continue

            const prodRef = ((item.relationships as Record<string, unknown>)?.product as Record<string, unknown>)?.data as Record<string, unknown> | undefined
            const product = prodRef?.id ? productMap.get(String(prodRef.id)) as Record<string, unknown> | undefined : undefined
            const prodAttrs = product?.attributes as Record<string, unknown> | undefined

            saleItems.push({
              name: String(prodAttrs?.name ?? 'Desconocido'),
              qty: Number(attrs?.quantity ?? 1),
              price: Number(attrs?.price ?? 0),
            })
          }

          allSales.push({
            id: String(sale.id),
            total: Number(sale.attributes?.total ?? 0),
            state: String(sale.attributes?.saleState ?? 'UNKNOWN'),
            createdAt: argDate,
            items: saleItems,
          })
        }

        if (foundBefore || salesData.length < 200) break
        page++
      } catch (err) {
        console.error('[monthly-summary] page fetch error:', err)
        break
      }
    }

    // Only count closed sales for totals
    const closedSales = allSales.filter(s => s.state === 'CLOSED')

    // Daily totals
    const dailyMap = new Map<string, { total: number; tickets: number }>()
    for (const day of days) {
      dailyMap.set(format(day, 'yyyy-MM-dd'), { total: 0, tickets: 0 })
    }
    for (const sale of closedSales) {
      const d = dailyMap.get(sale.createdAt)
      if (d) {
        d.total += sale.total
        d.tickets++
      }
    }

    const dailyData = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Top products across the whole month
    const productAgg = new Map<string, { qty: number; revenue: number }>()
    for (const sale of closedSales) {
      for (const item of sale.items) {
        const ex = productAgg.get(item.name)
        if (ex) {
          ex.qty += item.qty
          ex.revenue += item.price
        } else {
          productAgg.set(item.name, { qty: item.qty, revenue: item.price })
        }
      }
    }

    const topProducts = Array.from(productAgg.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.qty - a.qty)

    // Summary
    const totalFacturado = closedSales.reduce((s, t) => s + t.total, 0)
    const totalTickets = closedSales.length
    const activeDays = dailyData.filter(d => d.total > 0).length

    return NextResponse.json({
      month: format(refDate, 'yyyy-MM'),
      totalFacturado,
      totalTickets,
      activeDays,
      avgPerDay: activeDays > 0 ? Math.round(totalFacturado / activeDays) : 0,
      avgTicket: totalTickets > 0 ? Math.round(totalFacturado / totalTickets) : 0,
      dailyData,
      topProducts: topProducts.slice(0, 30),
      topByRevenue: [...topProducts].sort((a, b) => b.revenue - a.revenue).slice(0, 30),
    })
  } catch (error) {
    console.error('[monthly-summary] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
