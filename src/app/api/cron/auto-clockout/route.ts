import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/cron/auto-clockout
// Called by Vercel Cron every 15 minutes
// Checks if current time matches any closing hour → clock out open shifts
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Verify cron secret or allow internal calls
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Also allow without secret in dev
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const admin = createAdminClient()

    // This runs once per day at ~00:00 ARG (3:00 UTC)
    // It closes ALL open attendance logs from yesterday or earlier
    // using the closing_hours table for each day's closing time

    // Find all open attendance logs
    const { data: openLogs } = await admin
      .from('attendance_logs')
      .select('id, user_id, clock_in_at, operative_date')
      .is('clock_out_at', null)
      .eq('status', 'open')

    if (!openLogs?.length) {
      return NextResponse.json({ message: 'No open shifts to close' })
    }

    // Get all closing hours
    const { data: closingHours } = await admin
      .from('closing_hours')
      .select('day_of_week, closing_time, override_date, is_default')

    const defaultHours = new Map<number, string>()
    const overrides = new Map<string, string>()
    for (const ch of (closingHours ?? [])) {
      if (ch.is_default) defaultHours.set(ch.day_of_week, ch.closing_time)
      if (ch.override_date) overrides.set(ch.override_date, ch.closing_time)
    }

    let closed = 0
    for (const log of openLogs) {
      const logDate = log.operative_date // yyyy-MM-dd
      const logDayOfWeek = new Date(logDate + 'T12:00:00').getDay()

      // Get closing time for this day
      const closingTime = overrides.get(logDate) ?? defaultHours.get(logDayOfWeek) ?? '00:00'
      const [closeH, closeM] = closingTime.split(':').map(Number)

      // Build clock_out timestamp in Argentina timezone
      let clockOutISO: string
      if (closeH === 0 && closeM === 0) {
        clockOutISO = new Date(`${logDate}T23:59:59-03:00`).toISOString()
      } else if (closeH <= 6) {
        // After midnight (e.g., 01:00) — next calendar day
        const nextDay = new Date(logDate + 'T12:00:00')
        nextDay.setDate(nextDay.getDate() + 1)
        const nextDayStr = nextDay.toISOString().split('T')[0]
        clockOutISO = new Date(`${nextDayStr}T${closingTime}:00-03:00`).toISOString()
      } else {
        clockOutISO = new Date(`${logDate}T${closingTime}:00-03:00`).toISOString()
      }

      const { error } = await admin
        .from('attendance_logs')
        .update({
          clock_out_at: clockOutISO,
          status: 'closed',
          clock_out_type: 'auto',
          notes: `Egreso automático — cierre ${closingTime}`,
        })
        .eq('id', log.id)

      if (!error) closed++
    }

    return NextResponse.json({
      message: `Auto clock-out: ${closed} de ${openLogs.length} registros cerrados`,
      closed,
      total: openLogs.length,
    })
  } catch (error) {
    console.error('[auto-clockout]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
