import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyEvent } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// GET /api/cron/sales-daily
// ---------------------------------------------------------------------------
// Corre una vez al día a las 23:30 hora Argentina (02:30 UTC).
// Calcula el top 5 de platos más vendidos del día completo (desde las 00:00 AR)
// y manda la notificación a todos los usuarios activos.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const AR_OFFSET = '-03:00'
const TOP_N = 5

function arTodayDate(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const admin = createAdminClient()
    const todayAR = arTodayDate()

    // Desde las 00:00 AR del día actual hasta ahora
    const startUTC = new Date(`${todayAR}T00:00:00${AR_OFFSET}`)
    const nowUTC = new Date()

    const { data: sales, error } = await admin
      .from('fudo_sales')
      .select('quantity, raw_payload')
      .gte('sold_at', startUTC.toISOString())
      .lte('sold_at', nowUTC.toISOString())

    if (error) throw error

    const totals = new Map<string, number>()
    for (const row of sales ?? []) {
      const name = (row.raw_payload as Record<string, unknown> | null)?.item_name
      const key = typeof name === 'string' && name.trim() ? name.trim() : null
      if (!key) continue
      totals.set(key, (totals.get(key) ?? 0) + Number(row.quantity ?? 0))
    }

    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)

    if (top.length === 0) {
      return NextResponse.json({ success: true, message: 'Sin ventas en el día', sent: false })
    }

    const list = top.map(([name, qty], i) => `${i + 1}. ${name} — ${qty}`).join('\n')
    const fecha = new Date().toLocaleDateString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })

    await notifyEvent(admin, 'sales_summary_daily', {
      title: `🏆 Top 5 del ${fecha}`,
      body: list,
      url: '/ventas',
    })

    return NextResponse.json({
      success: true,
      date: todayAR,
      window: { from: startUTC.toISOString(), to: nowUTC.toISOString() },
      top,
      sent: true,
    })
  } catch (error) {
    console.error('[GET /api/cron/sales-daily]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
