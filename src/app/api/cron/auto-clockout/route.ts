import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET /api/cron/auto-clockout
// Called by Vercel Cron every 15 minutes
// Closes open attendance logs when the employee's INDIVIDUAL shift ends.
// Only an encargado/socio can authorize staying past the shift end.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    // Find all open attendance logs
    const { data: openLogs } = await admin
      .from('attendance_logs')
      .select('id, user_id, clock_in_at, operative_date')
      .is('clock_out_at', null)
      .eq('status', 'open')

    // Helper: hour (0-23) of a UTC timestamp in Buenos Aires time
    const hourInBA = (iso: string): number => {
      const str = new Date(iso).toLocaleString('en-GB', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit',
        hour12: false,
      })
      return parseInt(str, 10)
    }

    if (!openLogs?.length) {
      return NextResponse.json({ message: 'No open shifts to close', closed: 0 })
    }

    // Get today's and yesterday's shifts for matching
    const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const yesterday = new Date(now.getTime() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

    const { data: shifts } = await admin
      .from('shifts')
      .select('user_id, shift_date, start_time, end_time')
      .in('shift_date', [today, yesterday])

    // Build shift map: user_id+date → end_time
    const shiftMap = new Map<string, string>()
    for (const s of (shifts ?? [])) {
      shiftMap.set(`${s.user_id}|${s.shift_date}`, s.end_time)
    }

    // Fallback: closing_hours table (for employees without a specific shift)
    const { data: closingHours } = await admin
      .from('closing_hours')
      .select('day_of_week, closing_time, override_date, is_default')

    const defaultClosing = new Map<number, string>()
    const overrideClosing = new Map<string, string>()
    for (const ch of (closingHours ?? [])) {
      if (ch.is_default) defaultClosing.set(ch.day_of_week, ch.closing_time)
      if (ch.override_date) overrideClosing.set(ch.override_date, ch.closing_time)
    }

    let closed = 0
    const details: string[] = []

    for (const log of openLogs) {
      const logDate = log.operative_date
      const logDow = new Date(logDate + 'T12:00:00').getDay()

      // Priority 1: Individual shift end_time
      const shiftEnd = shiftMap.get(`${log.user_id}|${logDate}`)

      // Priority 2: Closing hours override for this date
      // Priority 3: Default closing hours for this day of week
      let closingTime = shiftEnd
        ?? overrideClosing.get(logDate)
        ?? defaultClosing.get(logDow)
        ?? '00:00'

      // Regla turno mañana: ingreso antes de las 12:00 BA → cierra a las 16:00
      // salvo que el shift explícito termine más tarde en el mismo día
      const clockInHourBA = hourInBA(log.clock_in_at)
      if (clockInHourBA < 12) {
        const [endH] = closingTime.split(':').map(Number)
        const endsLaterSameDay = endH > 16 && endH <= 23
        if (!endsLaterSameDay) {
          closingTime = '16:00'
        }
      }

      // Parse the end time
      const [endH, endM] = closingTime.split(':').map(Number)

      // Build the clock_out timestamp in Argentina timezone
      let clockOutDate: Date
      if (endH <= 6 && endH >= 0) {
        // After midnight (e.g., 01:00) → next calendar day
        const nextDay = new Date(logDate + 'T12:00:00')
        nextDay.setDate(nextDay.getDate() + 1)
        const nextDayStr = nextDay.toISOString().split('T')[0]
        clockOutDate = new Date(`${nextDayStr}T${closingTime.slice(0, 5)}:00-03:00`)
      } else {
        clockOutDate = new Date(`${logDate}T${closingTime.slice(0, 5)}:00-03:00`)
      }

      // Only close if the shift end has PASSED
      if (now < clockOutDate) continue

      // Get employee name for audit
      const { data: profile } = await admin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', log.user_id)
        .single()

      const empName = profile ? `${profile.first_name} ${profile.last_name}` : '?'
      const morningRule = clockInHourBA < 12 && closingTime === '16:00'
      const source = morningRule
        ? 'turno mañana (16:00)'
        : shiftEnd
          ? 'turno individual'
          : 'horario de cierre'

      const { error } = await admin
        .from('attendance_logs')
        .update({
          clock_out_at: clockOutDate.toISOString(),
          status: 'closed',
          clock_out_type: 'auto',
          notes: `Egreso automático (${source}) — ${closingTime.slice(0, 5)}`,
        })
        .eq('id', log.id)

      if (!error) {
        closed++
        details.push(`${empName}: ${closingTime.slice(0, 5)} (${source})`)
      }
    }

    // Audit trail (non-blocking)
    if (closed > 0) {
      logAudit(admin, {
        userId: null,
        userName: 'Sistema',
        action: 'auto_clockout',
        module: 'asistencia',
        entityType: 'attendance_log',
        description: `Auto-egreso de ${closed} empleados`,
      })
    }

    return NextResponse.json({
      message: `Auto clock-out: ${closed}/${openLogs.length} cerrados`,
      closed,
      total: openLogs.length,
      details,
    })
  } catch (error) {
    console.error('[auto-clockout]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
