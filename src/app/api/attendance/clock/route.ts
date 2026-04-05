import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { AnomalyFlag, AnomalyType } from '@/types/database'

// ---------------------------------------------------------------------------
// Haversine distance (meters)
// ---------------------------------------------------------------------------
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const dphi = ((lat2 - lat1) * Math.PI) / 180
  const dlambda = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function severityForType(type: AnomalyType): 'low' | 'medium' | 'high' | 'critical' {
  switch (type) {
    case 'gps_out_of_range':   return 'high'
    case 'unknown_device':     return 'medium'
    case 'wifi_mismatch':      return 'medium'
    case 'rapid_succession':   return 'critical'
    case 'unusual_hour':       return 'low'
    case 'selfie_missing':     return 'low'
  }
}

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
    wifi_bssid?: string
    wifi_ssid?: string
    selfie_base64?: string
    device_fingerprint?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { event_type, gps_lat, gps_lng, gps_accuracy, wifi_bssid, wifi_ssid, selfie_base64, device_fingerprint } = body

  if (event_type !== 'clock_in' && event_type !== 'clock_out') {
    return NextResponse.json({ error: 'event_type inválido' }, { status: 400 })
  }

  // Check current status
  const { data: lastEvent } = await supabase
    .from('clock_events')
    .select('event_type, timestamp')
    .eq('employee_id', user.id)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (event_type === 'clock_in' && lastEvent?.event_type === 'clock_in') {
    return NextResponse.json({ error: 'Ya tenés un ingreso activo sin egreso' }, { status: 400 })
  }
  if (event_type === 'clock_out' && (!lastEvent || lastEvent.event_type === 'clock_out')) {
    return NextResponse.json({ error: 'No tenés un ingreso activo para egresar' }, { status: 400 })
  }

  // Load config
  const { data: configs } = await supabase
    .from('attendance_config')
    .select('key, value')

  const cfg: Record<string, Record<string, unknown>> = {}
  for (const c of configs ?? []) {
    cfg[c.key] = c.value as Record<string, unknown>
  }

  // Anomaly detection
  const anomalyFlags: AnomalyFlag[] = []

  // 1. GPS validation
  const loc = cfg['location']
  if (gps_lat != null && gps_lng != null && loc) {
    const distance = haversineMeters(gps_lat, gps_lng, loc.lat as number, loc.lng as number)
    const radius = (loc.radius_meters as number) ?? 300
    if (distance > radius) {
      anomalyFlags.push({
        type: 'gps_out_of_range',
        distance_meters: Math.round(distance),
        allowed_radius_meters: radius,
        employee_lat: gps_lat,
        employee_lng: gps_lng,
      })
    }
  } else if (gps_lat == null && cfg['anomaly_checks']?.gps) {
    // GPS not provided but required
    anomalyFlags.push({ type: 'gps_out_of_range', reason: 'GPS no disponible' })
  }

  // 2. WiFi validation (if wifi checks enabled and at least one AP registered)
  const anomalyChecks = cfg['anomaly_checks']
  if (anomalyChecks?.wifi) {
    const { data: validAPs } = await supabase
      .from('wifi_access_points')
      .select('bssid, ssid')
      .eq('is_active', true)

    if (validAPs && validAPs.length > 0 && (wifi_bssid || wifi_ssid)) {
      const isValid = validAPs.some(
        ap =>
          (wifi_bssid && ap.bssid && ap.bssid.toLowerCase() === wifi_bssid.toLowerCase()) ||
          (wifi_ssid && ap.ssid && ap.ssid.toLowerCase() === wifi_ssid.toLowerCase()),
      )
      if (!isValid) {
        anomalyFlags.push({ type: 'wifi_mismatch', detected_bssid: wifi_bssid, detected_ssid: wifi_ssid })
      }
    }
  }

  // 3. Device validation
  if (device_fingerprint && anomalyChecks?.device) {
    const { data: registeredDevice } = await supabase
      .from('device_registrations')
      .select('id, is_active')
      .eq('employee_id', user.id)
      .eq('device_fingerprint', device_fingerprint)
      .eq('is_active', true)
      .maybeSingle()

    if (!registeredDevice) {
      anomalyFlags.push({ type: 'unknown_device', fingerprint: device_fingerprint.substring(0, 16) + '...' })

      // Auto-register device (pending approval)
      const hdrs = await headers()
      const ua = hdrs.get('user-agent') ?? ''
      await supabase.from('device_registrations').upsert({
        employee_id: user.id,
        device_fingerprint,
        user_agent: ua,
        device_name: 'Nuevo dispositivo (pendiente aprobación)',
        is_active: false,
      }, { onConflict: 'employee_id,device_fingerprint', ignoreDuplicates: true })
    }
  }

  // 4. Selfie missing
  if (!selfie_base64) {
    anomalyFlags.push({ type: 'selfie_missing', reason: 'No se capturó selfie' })
  }

  // 5. Rapid succession
  if (lastEvent && anomalyChecks?.rapid_succession_seconds) {
    const elapsed = (Date.now() - new Date(lastEvent.timestamp).getTime()) / 1000
    const minSeconds = (anomalyChecks.rapid_succession_seconds as number) ?? 60
    if (elapsed < minSeconds) {
      anomalyFlags.push({ type: 'rapid_succession', elapsed_seconds: Math.round(elapsed), min_seconds: minSeconds })
    }
  }

  // 6. Unusual hour
  const wh = cfg['working_hours']
  if (wh && anomalyChecks?.unusual_hour) {
    const now = new Date()
    const localHour = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }).format(now)
    const [hStr, mStr] = localHour.split(':')
    const currentMinutes = parseInt(hStr ?? '0') * 60 + parseInt(mStr ?? '0')
    const unusualBefore = parseTimeToMinutes(wh.unusual_before as string ?? '05:00')
    const unusualAfter = parseTimeToMinutes(wh.unusual_after as string ?? '23:30')
    if (currentMinutes < unusualBefore || currentMinutes > unusualAfter) {
      anomalyFlags.push({ type: 'unusual_hour', current_time: localHour, normal_range: `${wh.unusual_before}-${wh.unusual_after}` })
    }
  }

  // Upload selfie if provided
  let selfie_url: string | null = null
  if (selfie_base64) {
    try {
      const base64Data = selfie_base64.includes(',') ? selfie_base64.split(',')[1]! : selfie_base64
      const buffer = Buffer.from(base64Data, 'base64')
      const now = new Date()
      const path = `${now.getFullYear()}/${now.getMonth() + 1}/${user.id}/${Date.now()}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('attendance-selfies')
        .upload(path, buffer, { contentType: 'image/jpeg', upsert: false })

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('attendance-selfies').getPublicUrl(path)
        selfie_url = urlData.publicUrl
      }
    } catch {
      // Selfie upload failed — not critical, already flagged as missing if needed
    }
  }

  // Get IP and UA
  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0] ?? hdrs.get('x-real-ip') ?? null
  const ua = hdrs.get('user-agent') ?? null

  // Insert clock event
  const { data: event, error: insertError } = await supabase
    .from('clock_events')
    .insert({
      employee_id: user.id,
      event_type,
      wifi_bssid: wifi_bssid ?? null,
      wifi_ssid: wifi_ssid ?? null,
      gps_lat: gps_lat ?? null,
      gps_lng: gps_lng ?? null,
      gps_accuracy: gps_accuracy ?? null,
      selfie_url,
      device_fingerprint: device_fingerprint ?? null,
      user_agent: ua,
      ip_address: ip,
      verified: anomalyFlags.length === 0,
      anomaly_flags: anomalyFlags,
    })
    .select()
    .single()

  if (insertError || !event) {
    console.error('Error al insertar clock_event:', insertError)
    return NextResponse.json({ error: 'No se pudo registrar el fichaje' }, { status: 500 })
  }

  // Create anomaly records
  for (const flag of anomalyFlags) {
    await supabase.from('attendance_anomalies').insert({
      clock_event_id: event.id,
      employee_id: user.id,
      anomaly_type: flag.type as AnomalyType,
      severity: severityForType(flag.type as AnomalyType),
      details: flag,
    })
  }

  return NextResponse.json({
    success: true,
    event,
    anomaly_count: anomalyFlags.length,
    anomaly_flags: anomalyFlags,
    verified: anomalyFlags.length === 0,
  })
}
