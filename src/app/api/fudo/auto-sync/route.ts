import { NextResponse } from 'next/server'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// GET /api/fudo/auto-sync — Real-time sales from Fudo
// Fetches directly from Fudo API with include=items.product,table
// Returns live data: mesas en curso, cerradas, productos vendidos
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
    // Use Argentina timezone for "today"
    const now = new Date()
    const argDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const today = argDate.toISOString().slice(0, 10)

    // Fetch sales with items, products, and tables — paginate to get all of today
    let salesData: IncludedResource[] = []
    let included: IncludedResource[] = []
    let page = 1

    while (page <= 5) { // safety limit: max 5 pages (500 sales)
      const response = await fudo.fetch<{
        data: IncludedResource[]
        included?: IncludedResource[]
      }>(`/sales?include=items.product,table&sort=-createdAt&page[size]=100&page[number]=${page}`)

      const pageData = Array.isArray(response.data) ? response.data : []
      salesData.push(...pageData)
      included.push(...(response.included ?? []))

      if (pageData.length < 100) break // last page

      // Check if oldest sale on this page is before today — if so, we have all of today
      const oldest = pageData[pageData.length - 1]
      const oldestDate = String(oldest?.attributes?.createdAt ?? '').slice(0, 10)
      if (oldestDate < today) break

      page++
    }

    // Build lookup maps
    const itemMap = new Map<string, IncludedResource>()
    const productMap = new Map<string, IncludedResource>()
    const tableMap = new Map<string, IncludedResource>()
    for (const r of included) {
      if (r.type === 'Item') itemMap.set(r.id, r)
      if (r.type === 'Product') productMap.set(r.id, r)
      if (r.type === 'Table') tableMap.set(r.id, r)
    }

    // Filter today's sales
    const todaySales = salesData.filter((s) => {
      const d = String(s.attributes.createdAt ?? '').slice(0, 10)
      return d === today
    })

    // Build structured data per ticket/mesa
    type TicketItem = { name: string; qty: number; price: number }
    type Ticket = {
      id: string
      state: string // IN-COURSE, CLOSED, PAYMENT-PROCESS
      saleType: string // EAT-IN, TAKEAWAY, DELIVERY
      tableNumber: number | null
      tableId: string | null
      total: number // from Fudo sale.total (real amount)
      createdAt: string
      closedAt: string | null
      items: TicketItem[]
    }

    const tickets: Ticket[] = []
    const productSales = new Map<string, { name: string; qty: number; revenue: number }>()

    for (const sale of todaySales) {
      const saleTotal = Number(sale.attributes.total ?? 0)
      const state = String(sale.attributes.saleState ?? 'UNKNOWN')
      const saleType = String(sale.attributes.saleType ?? '')

      // Get table info
      const tableRef = (sale.relationships?.table?.data ?? null) as { id: string } | null
      const table = tableRef?.id ? tableMap.get(tableRef.id) : null
      const tableNumber = table ? Number(table.attributes.number ?? 0) : null

      // Get items
      const itemRefs = (sale.relationships?.items?.data ?? []) as { id: string }[]
      const ticketItems: TicketItem[] = []

      for (const ref of itemRefs) {
        const item = itemMap.get(ref.id)
        if (!item) continue

        const productRef = (item.relationships?.product?.data ?? {}) as { id?: string }
        const product = productRef?.id ? productMap.get(productRef.id) : null
        const name = String(product?.attributes?.name ?? `Item #${item.id}`)
        const qty = Number(item.attributes.quantity ?? 1)
        const price = Number(item.attributes.price ?? 0)

        ticketItems.push({ name, qty, price })

        // Aggregate product sales
        const prodKey = productRef?.id ?? item.id
        const existing = productSales.get(prodKey)
        if (existing) {
          existing.qty += qty
          existing.revenue += price * qty
        } else {
          productSales.set(prodKey, { name, qty, revenue: price * qty })
        }
      }

      tickets.push({
        id: sale.id,
        state,
        saleType,
        tableNumber,
        tableId: tableRef?.id ?? null,
        total: saleTotal,
        createdAt: String(sale.attributes.createdAt ?? ''),
        closedAt: sale.attributes.closedAt ? String(sale.attributes.closedAt) : null,
        items: ticketItems,
      })
    }

    // Separate by state
    const openTickets = tickets.filter((t) => t.state !== 'CLOSED')
    const closedTickets = tickets.filter((t) => t.state === 'CLOSED')

    // KPIs — use sale.total (Fudo's real total)
    const payingTickets = tickets.filter((t) => t.state === 'PAYMENT-PROCESS')
    const totalFacturado = closedTickets.reduce((s, t) => s + t.total, 0)
    const totalEnCurso = openTickets.reduce((s, t) => s + t.total, 0)
    const totalGeneral = totalFacturado + totalEnCurso
    const totalTickets = tickets.length
    const totalItems = tickets.reduce((s, t) => s + t.items.reduce((is, i) => is + i.qty, 0), 0)

    // Top products
    const topProducts = [...productSales.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 15)

    // By sale type
    const typeLabels: Record<string, string> = {
      'EAT-IN': 'En local',
      'TAKEAWAY': 'Para llevar',
      'DELIVERY': 'Delivery',
    }
    const typeAgg = new Map<string, { tickets: number; revenue: number }>()
    for (const t of tickets) {
      const label = typeLabels[t.saleType] ?? t.saleType
      const ex = typeAgg.get(label)
      if (ex) { ex.tickets++; ex.revenue += t.total }
      else typeAgg.set(label, { tickets: 1, revenue: t.total })
    }
    const bySaleType = [...typeAgg.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)

    // By hour
    const hourAgg = new Map<number, { tickets: number; revenue: number; items: number }>()
    for (const t of tickets) {
      const hour = new Date(t.createdAt).getHours()
      const ex = hourAgg.get(hour)
      const tItems = t.items.reduce((s, i) => s + i.qty, 0)
      if (ex) { ex.tickets++; ex.revenue += t.total; ex.items += tItems }
      else hourAgg.set(hour, { tickets: 1, revenue: t.total, items: tItems })
    }
    const byHour = Array.from({ length: 24 }, (_, h) => {
      const data = hourAgg.get(h)
      return {
        hour: `${String(h).padStart(2, '0')}:00`,
        tickets: data?.tickets ?? 0,
        revenue: data?.revenue ?? 0,
        items: data?.items ?? 0,
      }
    }).filter((h) => h.tickets > 0 || (h.hour >= '08:00' && h.hour <= '23:00'))

    // Format tickets for frontend (open first, then recent closed)
    const formatTicket = (t: Ticket) => ({
      ticketId: t.id,
      state: t.state,
      saleType: t.saleType,
      tableNumber: t.tableNumber,
      total: t.total,
      time: t.createdAt,
      closedAt: t.closedAt,
      items: t.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    })

    return NextResponse.json({
      lastSync: new Date().toISOString(),
      today: {
        totalFacturado,
        totalEnCurso,
        totalGeneral,
        totalTickets,
        totalItems,
        avgTicket: closedTickets.length > 0 ? Math.round(totalFacturado / closedTickets.length) : 0,
        mesasAbiertas: openTickets.length,
        mesasPagando: payingTickets.length,
        mesasCerradas: closedTickets.length,
        topProducts,
        bySaleType,
        byHour,
        openTables: openTickets
          .sort((a, b) => (b.tableNumber ?? 0) - (a.tableNumber ?? 0))
          .map(formatTicket),
        recentSales: closedTickets
          .sort((a, b) => (b.closedAt ?? b.createdAt).localeCompare(a.closedAt ?? a.createdAt))
          .slice(0, 10)
          .map(formatTicket),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error', today: null },
      { status: 500 },
    )
  }
}
