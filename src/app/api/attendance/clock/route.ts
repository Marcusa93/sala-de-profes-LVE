import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/attendance/clock
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const supabase = await createClient()

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

  const { event_type, gps_lat, gps_lng, gps_accuracy, device_fingerprint } = body

  if (event_type !== 'clock_in' && event_type !== 'clock_out') {
    return NextResponse.json({ error: 'event_type inválido' }, { status: 400 })
  }

  const admin = createAdminClient()
  const nowISO = new Date().toISOString()
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0] ?? hdrs.get('x-real-ip') ?? null

  // -----------------------------------------------------------------------
  // CLOCK IN
  // -----------------------------------------------------------------------
  if (event_type === 'clock_in') {
    // Check no open record
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
        clock_in_at: nowISO,
        clock_in_lat: gps_lat ?? null,
        clock_in_lng: gps_lng ?? null,
        clock_in_accuracy: gps_accuracy ?? null,
        clock_in_type: 'normal',
        device_fingerprint: device_fingerprint ?? null,
        network_ip: ip,
        status: 'open',
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
      anomaly_count: 0,
      anomaly_flags: [],
      verified: true,
    })
  }

  // -----------------------------------------------------------------------
  // CLOCK OUT
  // -----------------------------------------------------------------------
  const { data: openRecord } = await admin
    .from('attendance_logs')
    .select('id')
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
      clock_out_at: nowISO,
      clock_out_lat: gps_lat ?? null,
      clock_out_lng: gps_lng ?? null,
      clock_out_accuracy: gps_accuracy ?? null,
      clock_out_type: 'normal',
      status: 'closed',
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
