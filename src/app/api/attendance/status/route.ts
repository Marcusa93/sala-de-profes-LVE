import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/status
// Returns current clock status for the authenticated user
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const todayStr = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })

  // Get today's record
  const { data: todayRecord } = await supabase
    .from('attendance_logs')
    .select('id, operative_date, clock_in_at, clock_out_at, status, is_suspicious, suspicious_reasons, geo_verified, geo_distance_m, wifi_verified')
    .eq('user_id', user.id)
    .eq('operative_date', todayStr)
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let status: string
  if (!todayRecord) {
    status = 'not_clocked_in'
  } else if (todayRecord.status === 'open') {
    status = 'clocked_in'
  } else {
    status = 'completed'
  }

  return NextResponse.json({
    status,
    today_record: todayRecord,
    // Legacy compat for /fichaje page
    last_event: todayRecord ? {
      id: todayRecord.id,
      event_type: todayRecord.status === 'open' ? 'clock_in' : 'clock_out',
      timestamp: todayRecord.status === 'open' ? todayRecord.clock_in_at : todayRecord.clock_out_at,
      verified: !todayRecord.is_suspicious,
    } : null,
    today_events: todayRecord ? [
      { id: todayRecord.id + '_in', event_type: 'clock_in', timestamp: todayRecord.clock_in_at, verified: !todayRecord.is_suspicious, gps_lat: null, device_fingerprint: null },
      ...(todayRecord.clock_out_at ? [{ id: todayRecord.id + '_out', event_type: 'clock_out', timestamp: todayRecord.clock_out_at, verified: true, gps_lat: null, device_fingerprint: null }] : []),
    ] : [],
    open_anomalies: 0,
  })
}
