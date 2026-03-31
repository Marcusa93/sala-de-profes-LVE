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

    // Get current time in Argentina
    const now = new Date()
    const argNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const dayOfWeek = argNow.getDay() // 0=Sun, 1=Mon, ...
    const currentHour = argNow.getHours()
    const currentMin = argNow.getMinutes()
    const today = argNow.toISOString().split('T')[0]

    // Get closing hour for today
    // First check if there's an override for today
    const { data: override } = await admin
      .from('closing_hours')
      .select('closing_time')
      .eq('override_date', today)
      .eq('is_default', false)
      .limit(1)
      .maybeSingle()

    let closingTime: string
    if (override) {
      closingTime = override.closing_time
    } else {
      const { data: defaultHour } = await admin
        .from('closing_hours')
        .select('closing_time')
        .eq('day_of_week', dayOfWeek)
        .eq('is_default', true)
        .limit(1)
        .maybeSingle()

      closingTime = defaultHour?.closing_time ?? '00:00'
    }

    // Parse closing time
    const [closeH, closeM] = closingTime.split(':').map(Number)

    // Check if we're within 15 minutes of closing time
    // For "00:00" or "01:00" closing, this means late night
    const closeMinutes = closeH * 60 + closeM
    const nowMinutes = currentHour * 60 + currentMin

    // Handle overnight: if closing is 00:00 or 01:00, and current is around that time
    let isClosingTime = false
    if (closeMinutes === 0) {
      // Midnight closing: trigger between 23:45 and 00:15
      isClosingTime = nowMinutes >= 23 * 60 + 45 || nowMinutes <= 15
    } else if (closeMinutes <= 120) {
      // 01:00 or 02:00 closing
      isClosingTime = Math.abs(nowMinutes - closeMinutes) <= 15
    } else {
      // Daytime closing (e.g., 16:00)
      isClosingTime = Math.abs(nowMinutes - closeMinutes) <= 15
    }

    if (!isClosingTime) {
      return NextResponse.json({
        message: 'Not closing time',
        currentTime: `${currentHour}:${String(currentMin).padStart(2, '0')}`,
        closingTime,
        dayOfWeek,
      })
    }

    // Find all open attendance logs (no clock_out)
    const { data: openLogs } = await admin
      .from('attendance_logs')
      .select('id, user_id, clock_in_at, operative_date')
      .is('clock_out_at', null)
      .eq('status', 'open')

    if (!openLogs?.length) {
      return NextResponse.json({ message: 'No open shifts to close', closingTime })
    }

    // Build the clock_out timestamp
    // If closing is 00:00, the actual close is midnight of today → start of tomorrow
    // If closing is 01:00, it's 01:00 of the next day
    let clockOutDate: Date
    if (closeH === 0 && closeM === 0) {
      // Midnight → end of today
      clockOutDate = new Date(`${today}T23:59:59-03:00`)
    } else if (closeH <= 6) {
      // Early morning (01:00, etc) → same calendar day technically next morning
      clockOutDate = new Date(`${today}T${closingTime}:00-03:00`)
    } else {
      clockOutDate = new Date(`${today}T${closingTime}:00-03:00`)
    }

    const clockOutISO = clockOutDate.toISOString()

    // Close all open logs
    let closed = 0
    for (const log of openLogs) {
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
      message: `Auto clock-out: ${closed} registros cerrados`,
      closingTime,
      clockOutTime: clockOutISO,
      totalOpen: openLogs.length,
      closed,
    })
  } catch (error) {
    console.error('[auto-clockout]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
