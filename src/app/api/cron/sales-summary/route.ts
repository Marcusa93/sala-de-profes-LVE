import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyEvent } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// GET /api/cron/sales-summary
// ---------------------------------------------------------------------------
// Corre 2 veces al día (Vercel Cron): 15hs y 23hs hora Argentina.
// Manda el top de productos más vendidos del turno que está por cerrar:
//   15hs -> turno mañana (08hs -> ahora)
//   23hs -> turno tarde/noche (16hs -> ahora)
// Argentina no tiene horario de verano (siempre UTC-3), así que se puede
// construir el offset a mano sin librerías de timezone.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const AR_OFFSET = '-03:00'
const TOP_N = 8

function arTodayDate(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

function arHour(): number {
  const str = new Date().toLocaleString('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    hour12: false,
  })
  return parseInt(str, 10)
}

function arDateTimeUTC(dateStr: string, hour: number): Date {
  return new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00${AR_OFFSET}`)
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
    const currentHour = arHour()
    const isMorningClose = currentHour < 20
    const shiftLabel = isMorningClose ? 'mañana' : 'tarde/noche'
    const startHour = isMorningClose ? 8 : 16

    const argDate = arTodayDate()
    const startUTC = arDateTimeUTC(argDate, startHour)
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
      return NextResponse.json({ success: true, shift: shiftLabel, message: 'Sin ventas en la ventana', sent: false })
    }

    const list = top.map(([name, qty], i) => `${i + 1}. ${name} — ${qty}`).join('\n')

    await notifyEvent(admin, 'sales_summary_shift', {
      title: `📊 Top ventas — turno ${shiftLabel}`,
      body: list,
      url: '/ventas',
    })

    return NextResponse.json({ success: true, shift: shiftLabel, window: { from: startUTC.toISOString(), to: nowUTC.toISOString() }, top, sent: true })
  } catch (error) {
    console.error('[GET /api/cron/sales-summary]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
