import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/attendance/clock
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const supabase = await createClient()

  // Auth
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  let body: {
    event_type: 'clock_in' | 'clock_out'
    gps_lat?: number
    gps_lng?: number
    gps_accuracy?: number
    wifi_ssid?: string
    device_fingerprint?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { event_type, gps_lat, gps_lng, gps_accuracy, wifi_ssid, device_fingerprint } = body

  if (event_type !== 'clock_in' && event_type !== 'clock_out') {
    return NextResponse.json({ error: 'event_type inválido' }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date()
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0] ?? hdrs.get('x-real-ip') ?? null

  // Suspicious reasons
  const suspiciousReasons: string[] = []

  // GPS check
  const geoVerified = gps_lat != null && gps_lng != null
  let geoDistance: number | null = null
  if (!geoVerified) {
    suspiciousReasons.push('sin_geolocalizacion_ingreso')
  }

  // -----------------------------------------------------------------------
  // CLOCK IN
  // -----------------------------------------------------------------------
  if (event_type === 'clock_in') {
    // Check no open record today
    const { data: existing } = await admin
      .from('attendance_logs')
      .select('id')
      .eq('user_id', user.id)
      .eq('operative_date', todayStr)
      .eq('status', 'open')
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'Ya tenés un ingreso abierto hoy' }, { status: 400 })
    }

    const { data: record, error: insertError } = await admin
      .from('attendance_logs')
      .insert({
        user_id: user.id,
        operative_date: todayStr,
        clock_in_at: now.toISOString(),
        status: 'open',
        geo_lat: gps_lat ?? null,
        geo_lng: gps_lng ?? null,
        geo_accuracy: gps_accuracy ?? null,
        geo_verified: geoVerified,
        geo_distance_m: geoDistance,
        wifi_ssid: wifi_ssid ?? null,
        device_id: device_fingerprint ?? null,
        ip_address: ip,
        is_suspicious: suspiciousReasons.length > 0,
        suspicious_reasons: suspiciousReasons.length > 0 ? suspiciousReasons : null,
      })
      .select()
      .single()

    if (insertError || !record) {
      console.error('[attendance/clock] insert error:', insertError)
      return NextResponse.json({ error: 'No se pudo registrar el ingreso' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      event: record,
      anomaly_count: suspiciousReasons.length,
      anomaly_flags: suspiciousReasons,
      verified: suspiciousReasons.length === 0,
    })
  }

  // -----------------------------------------------------------------------
  // CLOCK OUT
  // -----------------------------------------------------------------------
  // Find open record for today
  const { data: openRecord } = await admin
    .from('attendance_logs')
    .select('id, clock_in_at')
    .eq('user_id', user.id)
    .eq('status', 'open')
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!openRecord) {
    return NextResponse.json({ error: 'No hay ingreso abierto para cerrar' }, { status: 400 })
  }

  const { data: updated, error: updateError } = await admin
    .from('attendance_logs')
    .update({
      clock_out_at: now.toISOString(),
      status: 'closed',
      clock_out_type: 'normal',
    })
    .eq('id', openRecord.id)
    .select()
    .single()

  if (updateError || !updated) {
    console.error('[attendance/clock] update error:', updateError)
    return NextResponse.json({ error: 'No se pudo registrar el egreso' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    event: updated,
    anomaly_count: 0,
    anomaly_flags: [],
    verified: true,
  })
}
