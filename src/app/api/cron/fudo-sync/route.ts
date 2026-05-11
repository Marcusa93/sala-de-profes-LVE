import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncFromFudo } from '@/lib/fudo/stock-sync'
import { importFudoSales } from '@/lib/fudo/sales-sync'

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
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const startTime = Date.now()
  const admin = createAdminClient()

  try {
    // ── 1) Sync stock from Fudo ──
    const stockResult = await syncFromFudo(admin)
    let auditSummary: Record<string, unknown> | null = null
    let auditError: string | null = null
    try {
      const { runFudoAudit } = await import('@/lib/fudo/audit')
      const audit = await runFudoAudit(admin)
      auditSummary = audit.summary
    } catch (err) {
      auditError = err instanceof Error ? err.message : 'No se pudo auditar Fudo'
    }

    // ── 2) Import today's sales ──
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]

    let salesImported = 0
    let salesErrors: string[] = []

    try {
      const salesResult = await importFudoSales(admin, {
        from: todayStr,
        limit: 300,
        operation: 'cron_sales_import',
      })
      salesImported = salesResult.imported
      salesErrors = salesResult.errors
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
          audit: { summary: auditSummary, error: auditError },
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
      audit: {
        summary: auditSummary,
        error: auditError,
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
