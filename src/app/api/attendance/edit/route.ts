import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// PATCH /api/attendance/edit — Encargado edita fichaje con motivo obligatorio
// Body: { logId, clockOut?, clockIn?, reason }
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()

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

    // Obtener registro original
    const { data: log } = await admin
      .from('attendance_logs')
      .select('id, user_id, clock_in_at, clock_out_at')
      .eq('id', logId)
      .single()

    if (!log) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })

    // Guardar en auditoría
    await admin.from('attendance_audit').insert({
      log_id:    logId,
      editor_id: user.id,
      action:    clockOut ? 'edit_clock_out' : 'edit_clock_in',
      reason:    reason.trim(),
      old_value: {
        clock_in_at:  log.clock_in_at,
        clock_out_at: log.clock_out_at,
      },
      new_value: {
        clock_in_at:  clockIn ?? log.clock_in_at,
        clock_out_at: clockOut ?? log.clock_out_at,
      },
    })

    // Construir update
    const updateData: Record<string, unknown> = {
      clock_out_type:    'edited',
      edited_by:         user.id,
      edited_reason:     reason.trim(),
    }

    if (clockOut !== undefined) {
      updateData.clock_out_at       = clockOut
      updateData.original_clock_out = log.clock_out_at
      updateData.status             = clockOut ? 'closed' : 'missing_checkout'
    }
    if (clockIn !== undefined) {
      updateData.clock_in_at = clockIn
    }

    const { error } = await admin
      .from('attendance_logs')
      .update(updateData)
      .eq('id', logId)

    if (error) throw error

    // Audit trail
    const { data: editorProfile } = await admin.from('profiles').select('first_name, last_name').eq('id', user.id).single()
    const { data: empProfile } = await admin.from('profiles').select('first_name, last_name').eq('id', log.user_id).single()
    const editorName = editorProfile ? `${editorProfile.first_name} ${editorProfile.last_name}` : '?'
    const empName = empProfile ? `${empProfile.first_name} ${empProfile.last_name}` : '?'

    try {
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
      })
    } catch { /* audit is non-blocking */ }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[attendance/edit]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 },
    )
  }
}
