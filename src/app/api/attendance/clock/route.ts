import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { VENUE } from '@/lib/attendance/venue'

// ---------------------------------------------------------------------------
// Haversine — server-safe, no browser APIs
// ---------------------------------------------------------------------------
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

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

  // -------------------------------------------------------------------------
  // GEO VALIDATION — server-side block
  // Lee el venue de la config de BD; usa VENUE como fallback
  // -------------------------------------------------------------------------
  const { data: venueConfig } = await admin
    .from('attendance_config')
    .select('value')
    .eq('key', 'location')
    .maybeSingle()

  type VenueConfig = { lat: number; lng: number; radius_meters: number; name?: string }
  const venue: VenueConfig = venueConfig?.value
    ? (venueConfig.value as VenueConfig)
    : { lat: VENUE.lat, lng: VENUE.lng, radius_meters: VENUE.radiusM, name: VENUE.name }

  // GPS es obligatorio cuando hay configuración de local
  if (!gps_lat || !gps_lng) {
    return NextResponse.json({
      error: 'Necesitás activar el GPS para fichar. Asegurate de darle permiso de ubicación a la app.',
      code: 'GPS_REQUIRED',
    }, { status: 403 })
  }

  const distM = distanceMeters(venue.lat, venue.lng, gps_lat, gps_lng)

  // El GPS reporta su propio margen de error (gps_accuracy). Si dice "estás a
  // 90m ±40m", la persona podría estar a 50m (adentro): le damos ese beneficio.
  // Se capa a 100m para que una lectura por antena (accuracy enorme) no anule
  // la geocerca por completo.
  const accuracyBenefit = Math.min(typeof gps_accuracy === 'number' && gps_accuracy > 0 ? gps_accuracy : 0, 100)
  const effectiveDist = Math.max(0, distM - accuracyBenefit)

  if (effectiveDist > venue.radius_meters) {
    return NextResponse.json({
      error: `Estás a ${distM}m de ${venue.name ?? 'el local'}. Solo podés fichar estando en el lugar.`,
      code: 'OUT_OF_RANGE',
      distance_m: distM,
      radius_m: venue.radius_meters,
    }, { status: 403 })
  }

  // -------------------------------------------------------------------------
  const nowISO = new Date().toISOString()
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0] ?? hdrs.get('x-real-ip') ?? null

  // -----------------------------------------------------------------------
  // CLOCK IN
  // -----------------------------------------------------------------------
  if (event_type === 'clock_in') {
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
        clock_in_lat: gps_lat,
        clock_in_lng: gps_lng,
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

    return NextResponse.json({ success: true, event: record, distance_m: distM })
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
      clock_out_lat: gps_lat,
      clock_out_lng: gps_lng,
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

  return NextResponse.json({ success: true, event: updated, distance_m: distM })
}
