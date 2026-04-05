import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// PATCH /api/attendance/edit — Encargado edits clock_out time
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const body = await request.json()
    const { logId, clockOut } = body

    if (!logId || !clockOut) {
      return NextResponse.json({ error: 'logId y clockOut requeridos' }, { status: 400 })
    }

    // Get original log
    const { data: log } = await admin
      .from('attendance_logs')
      .select('id, clock_out_at')
      .eq('id', logId)
      .single()

    if (!log) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })

    // Update
    const { error } = await admin
      .from('attendance_logs')
      .update({
        clock_out_at: clockOut,
        clock_out_type: 'edited',
        edited_by: user.id,
        original_clock_out: log.clock_out_at,
        status: 'closed',
      })
      .eq('id', logId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[attendance/edit]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
