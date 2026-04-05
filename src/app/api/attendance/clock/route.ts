import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/attendance/clock
// ---------------------------------------------------------------------------
// Secure clock-in/clock-out with geolocation, selfie, device fingerprint.
//
// Body: {
//   action: 'in' | 'out'
//   lat?: number, lng?: number, accuracy?: number
//   selfie?: string (base64 data URL)
//   deviceFingerprint?: string
//   deviceLabel?: string
//   networkIp?: string
// }
// ---------------------------------------------------------------------------

type ClockRequest = {
  action: 'in' | 'out'
  lat?: number
  lng?: number
  accuracy?: number
  selfie?: string
  deviceFingerprint?: string
  deviceLabel?: string
  networkIp?: string
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!profile) return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 403 })

    const body = (await request.json()) as ClockRequest
    if (!body.action || !['in', 'out'].includes(body.action)) {
      return NextResponse.json({ error: 'action debe ser "in" o "out"' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Upload selfie to Supabase Storage if provided
    let selfieUrl: string | null = null
    if (body.selfie && body.selfie.startsWith('data:image/')) {
      try {
        const base64Data = body.selfie.split(',')[1]
        const buffer = Buffer.from(base64Data, 'base64')
        const today = new Date().toISOString().split('T')[0]
        const timestamp = Date.now()
        const filePath = `${user.id}/${today}_${body.action}_${timestamp}.jpg`

        const { error: uploadError } = await admin.storage
          .from('attendance-selfies')
          .upload(filePath, buffer, { contentType: 'image/jpeg', upsert: false })

        if (!uploadError) {
          const { data: urlData } = admin.storage
            .from('attendance-selfies')
            .getPublicUrl(filePath)
          selfieUrl = urlData?.publicUrl ?? null
        } else {
          console.error('[Selfie upload error]', uploadError.message)
        }
      } catch (err) {
        console.error('[Selfie processing error]', err)
      }
    }

    // Get client IP from request headers
    const networkIp = body.networkIp
      ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? null

    // Call the appropriate RPC
    const rpcName = body.action === 'in' ? 'clock_in' : 'clock_out'
    const { data: result, error: rpcError } = await supabase.rpc(rpcName, {
      p_notes: null,
      p_lat: body.lat ?? null,
      p_lng: body.lng ?? null,
      p_accuracy: body.accuracy ?? null,
      p_selfie_url: selfieUrl,
      p_device_fingerprint: body.deviceFingerprint ?? null,
      p_network_ip: networkIp,
    })

    if (rpcError) {
      console.error(`[${rpcName} RPC error]`, rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }

    const rpcResult = result as {
      success: boolean
      error?: string
      log_id?: string
      clock_in_at?: string
      clock_out_at?: string
      hours_worked?: number
      anomaly?: { is_suspicious: boolean; reasons: string[] }
    }

    if (!rpcResult.success) {
      return NextResponse.json({ error: rpcResult.error ?? 'Error al fichar' }, { status: 400 })
    }

    // Audit trail
    const userName = `${profile.first_name} ${profile.last_name}`.trim()
    await admin.from('audit_trail').insert({
      user_id: user.id,
      user_name: userName,
      action: body.action === 'in' ? 'clock_in' : 'clock_out',
      module: 'asistencia',
      entity_type: 'attendance_log',
      entity_id: rpcResult.log_id,
      description: `${userName} fichó ${body.action === 'in' ? 'ingreso' : 'egreso'}${
        rpcResult.anomaly?.is_suspicious ? ' [SOSPECHOSO: ' + rpcResult.anomaly.reasons.join(', ') + ']' : ''
      }`,
      metadata: {
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy,
        has_selfie: !!selfieUrl,
        device_fingerprint: body.deviceFingerprint,
        network_ip: networkIp,
        anomaly: rpcResult.anomaly,
        channel: 'app',
      },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      action: body.action,
      log_id: rpcResult.log_id,
      clock_in_at: rpcResult.clock_in_at,
      clock_out_at: rpcResult.clock_out_at,
      hours_worked: rpcResult.hours_worked,
      anomaly: rpcResult.anomaly,
    })
  } catch (error) {
    console.error('[POST /api/attendance/clock]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
