import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ANTICIPO_AUTORIZAR_MIN, horaAR } from '@/lib/attendance/horas-extra'
import { avisarHorasDeMas, finTurnoDeFichaje } from '@/lib/attendance/avisar-extra'

// ---------------------------------------------------------------------------
// POST /api/admin/autorizar-extra — horas de más (quedarse después del turno)
// ---------------------------------------------------------------------------
// Encargado o socio autoriza que alguien se quede después del fin de su turno:
// mientras sigue trabajando (desde 30' antes del fin) o después de que salió,
// sin tocar la hora de salida. Con eso la liquidación paga hasta la salida.
// Queda quién y cuándo (fichaje + auditoría) y se le avisa a Marco.
// Body: { attendance_id, quitar?: boolean }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient() as unknown as SupabaseClient
    const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    const yo = profile as { role: string; first_name: string | null; last_name: string | null } | null
    if (!yo || !['socio', 'encargado'].includes(yo.role)) {
      return NextResponse.json({ error: 'Solo encargados y socios autorizan horas de más' }, { status: 403 })
    }

    const body = (await request.json().catch(() => null)) as { attendance_id?: unknown; quitar?: unknown } | null
    const attendanceId = typeof body?.attendance_id === 'string' ? body.attendance_id : null
    const quitar = body?.quitar === true
    if (!attendanceId) return NextResponse.json({ error: 'Falta el fichaje' }, { status: 400 })

    const { data: logData, error: logError } = await admin
      .from('attendance_logs')
      .select('id, user_id, operative_date, clock_in_at, clock_out_at, clock_out_type, extra_autorizada_por, extra_autorizada_at')
      .eq('id', attendanceId)
      .maybeSingle()
    if (logError) {
      const falta = /extra_autorizada/.test(logError.message)
      return NextResponse.json({ error: falta ? 'Falta correr la migración 20261123b_horas_extra_autorizadas.sql' : logError.message }, { status: falta ? 503 : 500 })
    }
    const log = logData as {
      id: string; user_id: string; operative_date: string; clock_in_at: string; clock_out_at: string | null
      clock_out_type: string | null; extra_autorizada_por: string | null; extra_autorizada_at: string | null
    } | null
    if (!log) return NextResponse.json({ error: 'Fichaje no encontrado' }, { status: 404 })
    if (!quitar && log.user_id === user.id) return NextResponse.json({ error: 'Las horas de más propias las autoriza otro encargado o un socio' }, { status: 403 })

    const fin = await finTurnoDeFichaje(admin, log)
    if (fin == null) return NextResponse.json({ error: 'No tiene turno cargado ese día: cargalo en Turnos y se paga lo fichado' }, { status: 400 })

    if (!quitar) {
      if (log.extra_autorizada_at) return NextResponse.json({ success: true, message: 'Ya estaban autorizadas' })
      if (log.clock_out_at && Date.parse(log.clock_out_at) <= fin) {
        return NextResponse.json({ error: `Salió antes del fin del turno (${horaAR(fin)}): no hay horas de más` }, { status: 400 })
      }
      if (!log.clock_out_at && Date.now() < fin - ANTICIPO_AUTORIZAR_MIN * 60_000) {
        return NextResponse.json({ error: `Se puede autorizar desde las ${horaAR(fin - ANTICIPO_AUTORIZAR_MIN * 60_000)} (30 min antes del fin del turno)` }, { status: 400 })
      }
    } else if (!log.extra_autorizada_at) {
      return NextResponse.json({ success: true, message: 'No estaban autorizadas' })
    }

    const ahora = new Date().toISOString()
    const { error } = await admin
      .from('attendance_logs')
      .update(quitar ? { extra_autorizada_por: null, extra_autorizada_at: null } : { extra_autorizada_por: user.id, extra_autorizada_at: ahora })
      .eq('id', log.id)
    if (error) throw error

    const { data: emp } = await admin.from('profiles').select('first_name, last_name').eq('id', log.user_id).maybeSingle()
    const e = emp as { first_name: string | null; last_name: string | null } | null
    const empName = e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : '?'
    const authName = `${yo.first_name ?? ''} ${yo.last_name ?? ''}`.trim()

    await admin.from('audit_trail').insert({
      user_id: user.id,
      user_name: authName,
      action: quitar ? 'extra_unauthorized' : 'extra_authorized',
      module: 'asistencia',
      entity_type: 'attendance_log',
      entity_id: log.id,
      description: quitar
        ? `${authName} le quitó a ${empName} las horas de más del ${log.operative_date}`
        : `${authName} autorizó a ${empName} a quedarse después de las ${horaAR(fin)} (${log.clock_out_at ? `salió a las ${horaAR(log.clock_out_at)}` : 'sigue trabajando'})`,
      metadata: {
        employee_id: log.user_id,
        employee_name: empName,
        operative_date: log.operative_date,
        fin_turno: new Date(fin).toISOString(),
        clock_out_at: log.clock_out_at,
        authorized_by: authName,
        authorized_at: ahora,
        antes: quitar ? { por: log.extra_autorizada_por, at: log.extra_autorizada_at } : null,
      },
    })

    await avisarHorasDeMas(admin, {
      autorizoId: user.id,
      autorizoNombre: authName,
      empleado: empName,
      fecha: log.operative_date,
      fin,
      salida: log.clock_out_at,
      como: quitar ? 'quito' : 'autorizo',
    })

    return NextResponse.json({
      success: true,
      message: quitar ? `Se le quitaron las horas de más a ${empName}` : `Horas de más de ${empName} autorizadas`,
    })
  } catch (error) {
    console.error('[autorizar-extra]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
