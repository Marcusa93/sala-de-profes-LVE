import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncFromFudo } from '@/lib/fudo/stock-sync'
import { importFudoSales } from '@/lib/fudo/sales-sync'

// ---------------------------------------------------------------------------
// GET /api/cron/fudo-sync
// ---------------------------------------------------------------------------
// Vercel Cron diario a las 06:00 UTC (03:00 Argentina), cuando el día
// gastronómico ya cerró:
// 1) Importa las ventas de AYER (día completo) + hoy → fudo_sales (historial)
// 2) Sincroniza stock desde Fudo → stock_items
// 3) Guarda el snapshot diario de stock (stock_snapshots, tipo 'daily') —
//    la base del cálculo de mermas: ayer + entradas − ventas − hoy
// 4) Audita discrepancias y loguea a audit_trail
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
    // Fechas en Argentina: a las 03:00 AR el día operativo cerrado es "ayer"
    const nowAR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const todayAR = new Date(nowAR); todayAR.setHours(12, 0, 0, 0)
    const yesterdayAR = new Date(todayAR); yesterdayAR.setDate(yesterdayAR.getDate() - 1)
    const fmt = (d: Date) => d.toLocaleDateString('en-CA')
    const todayStr = fmt(todayAR)
    const yesterdayStr = fmt(yesterdayAR)

    // ── 1) Importar ventas: ayer completo + lo que haya de hoy ──
    let salesImported = 0
    let salesErrors: string[] = []
    try {
      const salesResult = await importFudoSales(admin, {
        from: yesterdayStr,
        limit: 800,
        operation: 'cron_sales_import',
      })
      salesImported = salesResult.imported
      salesErrors = salesResult.errors
    } catch (err) {
      salesErrors.push(err instanceof Error ? err.message : 'Error al importar ventas')
    }

    // ── 2) Sync stock from Fudo ──
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

    // ── 3) Snapshot diario de stock (base del cálculo de mermas) ──
    let snapshotSaved = false
    let snapshotError: string | null = null
    try {
      const { data: items } = await admin
        .from('stock_items')
        .select('id, name, unit, category, current_qty, min_qty, cost_per_unit, fudo_product_id, fudo_ingredient_id')
        .eq('is_active', true)

      if (items && items.length > 0) {
        // Un snapshot 'daily' por fecha: si el cron corre dos veces, se reemplaza
        await admin.from('stock_snapshots').delete().eq('snapshot_date', todayStr).eq('snapshot_type', 'daily')
        const { error } = await admin.from('stock_snapshots').insert({
          snapshot_date: todayStr,
          snapshot_type: 'daily',
          label: `Snapshot diario ${todayStr} (03:00 AR)`,
          items,
          total_items: items.length,
          total_qty: items.reduce((s, i) => s + Number(i.current_qty ?? 0), 0),
          critical_count: items.filter(i => Number(i.current_qty ?? 0) <= Number(i.min_qty ?? 0)).length,
        })
        if (error) snapshotError = error.message
        else snapshotSaved = true
      }
    } catch (err) {
      snapshotError = err instanceof Error ? err.message : 'Error al guardar snapshot'
    }

    const elapsedMs = Date.now() - startTime

    // ── 3) Log to audit_trail ──
    try {
      await admin.from('audit_trail').insert({
        action: 'fudo_cron_sync',
        module: 'stock',
        entity_type: 'cron',
        entity_id: 'fudo-sync',
        description: `Cron sync: ${stockResult.synced} stock, ${salesImported} ventas, snapshot ${snapshotSaved ? 'OK' : 'FALLÓ'} (${elapsedMs}ms)`,
        metadata: {
          stock: stockResult,
          audit: { summary: auditSummary, error: auditError },
          sales: { imported: salesImported, errors: salesErrors, from: yesterdayStr },
          snapshot: { saved: snapshotSaved, error: snapshotError },
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
        from: yesterdayStr,
      },
      snapshot: { saved: snapshotSaved, error: snapshotError },
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
