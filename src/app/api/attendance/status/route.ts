import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/status
// Returns current clock status for the authenticated user (or ?employee_id for admins)
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const targetId = searchParams.get('employee_id') ?? user.id

  // If requesting another employee's status, check admin role
  if (targetId !== user.id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }
  }

  // Get last event
  const { data: lastEvent } = await supabase
    .from('clock_events')
    .select('id, event_type, timestamp, gps_lat, gps_lng, verified, anomaly_flags')
    .eq('employee_id', targetId)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Get today's events (local date)
  const todayLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())

  const { data: todayEvents } = await supabase
    .from('clock_events')
    .select('id, event_type, timestamp, verified, anomaly_flags')
    .eq('employee_id', targetId)
    .gte('timestamp', `${todayLocal}T00:00:00-03:00`)
    .order('timestamp', { ascending: true })

  // Open anomalies count
  const { count: openAnomalies } = await supabase
    .from('attendance_anomalies')
    .select('*', { count: 'exact', head: true })
    .eq('employee_id', targetId)
    .eq('resolved', false)

  const status = !lastEvent
    ? 'no_record'
    : lastEvent.event_type === 'clock_in'
      ? 'clocked_in'
      : 'clocked_out'

  return NextResponse.json({
    status,
    last_event: lastEvent,
    today_events: todayEvents ?? [],
    open_anomalies: openAnomalies ?? 0,
  })
}
