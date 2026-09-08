import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DashboardData } from '@/app/(app)/ventas/_components/types'

// ---------------------------------------------------------------------------
// GET /api/fudo/range-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// Agrega ventas de fudo_sales para un rango de fechas (AR time).
// Devuelve DashboardData compatible con CompareView.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 1000

type SaleRow = {
  fudo_ticket_id: string
  fudo_product_id: string
  quantity: number
  sold_at: string
  raw_payload: Record<string, unknown> | null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const from = request.nextUrl.searchParams.get('from') ?? ''
    const to = request.nextUrl.searchParams.get('to') ?? ''

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'Parámetros inválidos: from y to en YYYY-MM-DD' }, { status: 400 })
    }

    // Convertir fechas AR a UTC (AR = UTC-3, sin DST)
    const fromUTC = new Date(`${from}T00:00:00-03:00`).toISOString()
    const toPlusOne = new Date(`${to}T00:00:00-03:00`)
    toPlusOne.setDate(toPlusOne.getDate() + 1)
    const toUTC = toPlusOne.toISOString()

    const admin = createAdminClient()

    // Paginar ventas del rango
    const rows: SaleRow[] = []
    for (let page = 0; page < 50; page++) {
      const { data, error } = await admin
        .from('fudo_sales')
        .select('fudo_ticket_id, fudo_product_id, quantity, sold_at, raw_payload')
        .gte('sold_at', fromUTC)
        .lt('sold_at', toUTC)
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      rows.push(...(data as SaleRow[]))
      if (data.length < PAGE_SIZE) break
    }

    // Acumuladores
    const ticketSet = new Set<string>()
    const eatInTickets = new Set<string>()
    const productSales = new Map<string, { name: string; qty: number; revenue: number }>()
    const hourAgg = new Map<number, { revenue: number; items: number }>()
    let totalRevenue = 0
    let totalItems = 0

    for (const row of rows) {
      const qty = Number(row.quantity ?? 0)
      const price = row.raw_payload?.price != null ? Number(row.raw_payload.price) : 0
      const name = typeof row.raw_payload?.item_name === 'string' ? row.raw_payload.item_name : 'Producto'
      const saleType = typeof row.raw_payload?.sale_type === 'string' ? row.raw_payload.sale_type : ''

      const lineRevenue = price * qty

      ticketSet.add(row.fudo_ticket_id)
      if (saleType === 'EAT-IN') eatInTickets.add(row.fudo_ticket_id)

      totalRevenue += lineRevenue
      totalItems += qty

      // Productos — agrupar por fudo_product_id para evitar duplicados por variaciones de nombre
      const existing = productSales.get(row.fudo_product_id)
      if (existing) {
        existing.qty += qty
        existing.revenue += lineRevenue
      } else {
        productSales.set(row.fudo_product_id, { name, qty, revenue: lineRevenue })
      }

      // Por hora (AR = UTC-3)
      const hour = (new Date(row.sold_at).getUTCHours() - 3 + 24) % 24
      const hData = hourAgg.get(hour) ?? { revenue: 0, items: 0 }
      hData.revenue += lineRevenue
      hData.items += qty
      hourAgg.set(hour, hData)
    }

    const totalTickets = ticketSet.size

    const topProducts = [...productSales.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 15)

    const byHour = Array.from({ length: 24 }, (_, h) => {
      const hData = hourAgg.get(h)
      return {
        hour: `${String(h).padStart(2, '0')}:00`,
        tickets: 0,
        revenue: hData?.revenue ?? 0,
        items: hData?.items ?? 0,
      }
    }).filter((h) => h.items > 0)

    const result: DashboardData = {
      totalFacturado: Math.round(totalRevenue),
      totalEnCurso: 0,
      totalGeneral: Math.round(totalRevenue),
      totalTickets,
      totalItems,
      avgTicket: totalTickets > 0 ? Math.round(totalRevenue / totalTickets) : 0,
      mesasAbiertas: 0,
      takeawayAbiertos: 0,
      totalAbiertas: 0,
      mesasCerradas: eatInTickets.size,
      topProducts,
      bySaleType: [],
      byHour,
      openTables: [],
      openTakeaway: [],
      recentSales: [],
    }

    return NextResponse.json({ data: result })
  } catch (error) {
    console.error('[GET /api/fudo/range-summary]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
