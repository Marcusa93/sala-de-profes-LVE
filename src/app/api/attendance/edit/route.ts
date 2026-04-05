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
    const { logId, clockOut, clockIn, reason } = body

    if (!logId) {
      return NextResponse.json({ error: 'logId requerido' }, { status: 400 })
    }
    if (!clockOut && !clockIn) {
      return NextResponse.json({ error: 'clockOut o clockIn requerido' }, { status: 400 })
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      return NextResponse.json({ error: 'Motivo de corrección obligatorio (mín 3 caracteres)' }, { status: 400 })
    }

    // Get original log
    const { data: log } = await admin
      .from('attendance_logs')
      .select('id, user_id, clock_in_at, clock_out_at')
      .eq('id', logId)
      .single()

    if (!log) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })

    // Build update
    const update: Record<string, unknown> = {
      edited_by: user.id,
      edit_reason: reason.trim(),
    }

    if (clockOut) {
      update.clock_out_at = clockOut
      update.clock_out_type = 'edited'
      update.original_clock_out = log.clock_out_at
      update.status = 'closed'
    }
    if (clockIn) {
      update.clock_in_at = clockIn
      update.original_clock_in = log.clock_in_at
    }

    const { error } = await admin
      .from('attendance_logs')
      .update(update)
      .eq('id', logId)

    if (error) throw error

    // Audit trail
    const { data: editorProfile } = await admin.from('profiles').select('first_name, last_name').eq('id', user.id).single()
    const { data: empProfile } = await admin.from('profiles').select('first_name, last_name').eq('id', log.user_id).single()
    const editorName = editorProfile ? `${editorProfile.first_name} ${editorProfile.last_name}` : '?'
    const empName = empProfile ? `${empProfile.first_name} ${empProfile.last_name}` : '?'

    await admin.from('audit_trail').insert({
      user_id: user.id,
      user_name: editorName,
      action: 'attendance_edit',
      module: 'asistencia',
      entity_type: 'attendance_log',
      entity_id: logId,
      description: `${editorName} corrigió fichaje de ${empName}: ${reason.trim()}`,
      metadata: {
        employee_id: log.user_id,
        original_clock_in: log.clock_in_at,
        original_clock_out: log.clock_out_at,
        new_clock_in: clockIn ?? null,
        new_clock_out: clockOut ?? null,
        reason: reason.trim(),
      },
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[attendance/edit]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
