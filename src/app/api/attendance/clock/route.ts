import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/attendance/clock
// Body: { action: 'in'|'out', photo_url?, geo_lat?, geo_lng?, geo_accuracy?,
//         wifi_ssid?, device_id?, device_info?, notes? }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const body = await request.json()
    const {
      action,
      photo_url,
      geo_lat,
      geo_lng,
      geo_accuracy,
      wifi_ssid,
      device_id,
      device_info,
      notes,
    } = body

    if (!action || !['in', 'out'].includes(action)) {
      return NextResponse.json({ error: 'action debe ser "in" o "out"' }, { status: 400 })
    }

    // Capturar IP del request (para registro, no para bloquear)
    const ip_address =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    // Llamar RPC segura
    const rpcName = action === 'in' ? 'clock_in_secure' : 'clock_out_secure'

    const { data, error } = await supabase.rpc(rpcName, {
      p_photo_url:    photo_url ?? null,
      p_geo_lat:      geo_lat ?? null,
      p_geo_lng:      geo_lng ?? null,
      p_geo_accuracy: geo_accuracy ?? null,
      p_wifi_ssid:    wifi_ssid ?? null,
      p_device_id:    device_id ?? null,
      p_device_info:  device_info ?? null,
      p_ip_address:   ip_address,
      p_notes:        notes ?? null,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const result = data as Record<string, unknown>
    if (result?.error) return NextResponse.json({ error: result.error }, { status: 400 })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[attendance/clock]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// GET /api/attendance/clock — venue config para el cliente
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: config } = await (admin as any)
      .from('venue_config')
      .select('venue_lat, venue_lng, geo_radius_m, allowed_ssids, require_photo, require_geo, require_wifi')
      .limit(1)
      .single()

    return NextResponse.json({ config: config ?? null })
  } catch (err) {
    console.error('[attendance/clock GET]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
