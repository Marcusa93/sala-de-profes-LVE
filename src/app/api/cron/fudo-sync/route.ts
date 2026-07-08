import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncFromFudo } from '@/lib/fudo/stock-sync'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// GET /api/cron/fudo-sync
// ---------------------------------------------------------------------------
// Called by Vercel Cron every 30 minutes during service hours (11am-11pm).
// 1) Pulls ingredient + product stock from Fudo → updates stock_items
// 2) Imports today's sales from Fudo → fudo_sales (trigger auto-deducts stock)
// 3) Logs result to audit_trail
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60s for full sync

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const startTime = Date.now()
  const admin = createAdminClient()

  try {
    // ── 1) Sync stock from Fudo ──
    const stockResult = await syncFromFudo(admin)

    // ── 2) Import today's sales ──
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]

    let salesImported = 0
    let salesErrors: string[] = []

    try {
      const fudoSales = await fudo.getSales({ from: todayStr })

      if (fudoSales.length > 0) {
        // Flatten sales into individual items
        const flatRows: {
          fudo_ticket_id: string
          fudo_product_id: string
          quantity: number
          sold_at: string
          raw_payload: Record<string, unknown>
        }[] = []

        for (const sale of fudoSales.slice(0, 300)) {
          try {
            const items = await fudo.getSaleItems(sale.id)
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
                  cron: true,
                },
              })
            }
          } catch {
            // Skip individual sale errors
          }
        }

        // Dedup against existing
        if (flatRows.length > 0) {
          const { data: existing } = await admin
            .from('fudo_sales')
            .select('fudo_ticket_id, fudo_product_id')
            .gte('sold_at', todayStr)

          const existingSet = new Set(
            (existing ?? []).map(s => `${s.fudo_ticket_id}__${s.fudo_product_id}`)
          )
          const newRows = flatRows.filter(
            r => !existingSet.has(`${r.fudo_ticket_id}__${r.fudo_product_id}`)
          )

          for (let i = 0; i < newRows.length; i += 50) {
            const batch = newRows.slice(i, i + 50)
            const { error } = await admin.from('fudo_sales').insert(batch)
            if (!error) salesImported += batch.length
            else salesErrors.push(error.message)
          }
        }
      }
    } catch (err) {
      salesErrors.push(err instanceof Error ? err.message : 'Error al importar ventas')
    }

    const elapsedMs = Date.now() - startTime

    // ── 3) Log to audit_trail ──
    try {
      await admin.from('audit_trail').insert({
        action: 'fudo_cron_sync',
        module: 'stock',
        entity_type: 'cron',
        entity_id: 'fudo-sync',
        description: `Cron sync: ${stockResult.synced} stock, ${salesImported} ventas (${elapsedMs}ms)`,
        metadata: {
          stock: stockResult,
          sales: { imported: salesImported, errors: salesErrors },
          elapsed_ms: elapsedMs,
        },
      })
    } catch { /* audit is non-blocking */ }

    return NextResponse.json({
      success: true,
      stock: {
        synced: stockResult.synced,
        total: stockResult.total,
        errors: stockResult.errors.length,
      },
      sales: {
        imported: salesImported,
        errors: salesErrors.length,
      },
      elapsed_ms: elapsedMs,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron/fudo-sync]', error)

    // Log failure
    await admin.from('audit_trail').insert({
      action: 'fudo_cron_sync_error',
      module: 'stock',
      entity_type: 'cron',
      entity_id: 'fudo-sync',
      description: `Cron sync failed: ${error instanceof Error ? error.message : 'Error'}`,
    })

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 }
    )
  }
}
