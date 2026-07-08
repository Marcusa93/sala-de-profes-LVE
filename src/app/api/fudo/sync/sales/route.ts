import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { fudo, type FudoSale } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/sales
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const body = await request.json().catch(() => ({}))
    const from = body?.from as string | undefined
    const to = body?.to as string | undefined
    const supabase = createAdminClient()

    const fudoSales: FudoSale[] = await fudo.getSales({ from, to })

    if (fudoSales.length === 0) {
      return NextResponse.json({ success: true, importedSales: 0, message: 'Sin ventas' })
    }

    // Fetch items per sale and flatten
    const flatRows: {
      fudo_ticket_id: string
      fudo_product_id: string
      quantity: number
      sold_at: string
      raw_payload: Record<string, unknown>
    }[] = []

    for (const sale of fudoSales.slice(0, 200)) {
      try {
        const items = await fudo.getSaleItems(sale.id)
        for (const item of items) {
          const prodRel = (item._relationships?.product?.data ?? {}) as { id?: string }
          flatRows.push({
            fudo_ticket_id: sale.id,
            fudo_product_id: String(prodRel?.id ?? item.id),
            quantity: Number(item.quantity) || 1,
            sold_at: String(sale.createdAt ?? sale.closedAt ?? new Date().toISOString()),
            raw_payload: { sale_id: sale.id, item_name: item.name, price: item.price, sale_type: sale.saleType },
          })
        }
      } catch { /* skip */ }
    }

    if (flatRows.length === 0) {
      return NextResponse.json({ success: true, importedSales: 0, message: 'Sin items' })
    }

    // Dedup
    let query = supabase.from('fudo_sales').select('fudo_ticket_id, fudo_product_id')
    if (from) query = query.gte('sold_at', from)
    if (to) query = query.lte('sold_at', to)
    const { data: existing } = await query
    const existingSet = new Set((existing ?? []).map((s) => `${s.fudo_ticket_id}__${s.fudo_product_id}`))
    const newRows = flatRows.filter((r) => !existingSet.has(`${r.fudo_ticket_id}__${r.fudo_product_id}`))

    let importedSales = 0
    for (let i = 0; i < newRows.length; i += 50) {
      const batch = newRows.slice(i, i + 50)
      const { error } = await supabase.from('fudo_sales').insert(batch)
      if (!error) importedSales += batch.length
    }

    return NextResponse.json({ success: true, importedSales, totalSales: fudoSales.length, totalItems: flatRows.length })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
