import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { format, differenceInMinutes, parseISO } from 'date-fns'

// ---------------------------------------------------------------------------
// GET /api/admin/liquidacion?from=2026-03-01&to=2026-03-15
// Returns hours worked per employee for the given period
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const from = request.nextUrl.searchParams.get('from')
    const to = request.nextUrl.searchParams.get('to')
    if (!from || !to) {
      return NextResponse.json({ error: 'Parámetros from y to requeridos' }, { status: 400 })
    }

    // Fetch all attendance logs in period
    const { data: logs } = await admin
      .from('attendance_logs')
      .select('user_id, operative_date, clock_in_at, clock_out_at, status')
      .gte('operative_date', from)
      .lte('operative_date', to)
      .order('operative_date')

    // Fetch all profiles
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, first_name, last_name, role')
      .eq('is_active', true)

    if (!logs || !profiles) {
      return NextResponse.json({ error: 'Error al consultar datos' }, { status: 500 })
    }

    // Aggregate per employee
    const empMap = new Map<string, {
      days: Map<string, { hours: number; clockIn: string; clockOut: string | null; status: string }>
      totalHours: number
      totalDays: number
      missingCheckouts: number
      lateArrivals: number
    }>()

    for (const log of logs) {
      if (!empMap.has(log.user_id)) {
        empMap.set(log.user_id, {
          days: new Map(),
          totalHours: 0,
          totalDays: 0,
          missingCheckouts: 0,
          lateArrivals: 0,
        })
      }
      const emp = empMap.get(log.user_id)!

      let hours = 0
      if (log.clock_out_at) {
        hours = differenceInMinutes(parseISO(log.clock_out_at), parseISO(log.clock_in_at)) / 60
        if (hours < 0) hours += 24 // overnight shift
      }

      emp.days.set(log.operative_date, {
        hours: Math.round(hours * 100) / 100,
        clockIn: format(parseISO(log.clock_in_at), 'HH:mm'),
        clockOut: log.clock_out_at ? format(parseISO(log.clock_out_at), 'HH:mm') : null,
        status: log.status,
      })

      emp.totalHours += hours
      emp.totalDays++
      if (!log.clock_out_at && log.status === 'open') emp.missingCheckouts++
    }

    // Build result
    const employees = profiles
      .filter(p => empMap.has(p.id))
      .map(p => {
        const emp = empMap.get(p.id)!
        const daysArray = Array.from(emp.days.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, data]) => ({ date, ...data }))

        return {
          id: p.id,
          firstName: p.first_name,
          lastName: p.last_name,
          role: p.role,
          totalHours: Math.round(emp.totalHours * 100) / 100,
          totalDays: emp.totalDays,
          avgHoursPerDay: emp.totalDays > 0 ? Math.round((emp.totalHours / emp.totalDays) * 10) / 10 : 0,
          missingCheckouts: emp.missingCheckouts,
          days: daysArray,
        }
      })
      .sort((a, b) => b.totalHours - a.totalHours)

    return NextResponse.json({
      period: { from, to },
      employees,
      summary: {
        totalEmployees: employees.length,
        totalHours: Math.round(employees.reduce((s, e) => s + e.totalHours, 0) * 100) / 100,
        totalDays: employees.reduce((s, e) => s + e.totalDays, 0),
        missingCheckouts: employees.reduce((s, e) => s + e.missingCheckouts, 0),
      },
    })
  } catch (error) {
    console.error('[liquidacion]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
