import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { differenceInMinutes, parseISO } from 'date-fns'
import { ventanaTurno } from '@/lib/turnos/rol-del-turno'

// Hora en Argentina (el servidor corre en UTC: format() mostraba 3 h corridas)
const horaAR = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })

// ---------------------------------------------------------------------------
// GET /api/admin/liquidacion?from=2026-03-01&to=2026-03-15
// Returns hours worked per employee for the given period
//
// Cada fichaje se paga con la tarifa del ROL DE SU TURNO de ese día (un
// runner que hace un turno de encargado cobra esas horas como encargado).
// Si no hay turno cargado, se usa el rol del perfil. Los socios no se liquidan.
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
    const [logsRes, profilesRes, ratesRes, shiftsRes] = await Promise.all([
      admin.from('attendance_logs')
        .select('id, user_id, operative_date, clock_in_at, clock_out_at, status, clock_out_type')
        .gte('operative_date', from)
        .lte('operative_date', to)
        .order('operative_date'),
      admin.from('profiles')
        .select('id, first_name, last_name, role')
        .eq('is_active', true),
      admin.from('payroll_rates')
        .select('role, hourly_rate, label'),
      admin.from('shifts')
        .select('user_id, shift_date, start_time, end_time, shift_role')
        .gte('shift_date', from)
        .lte('shift_date', to),
    ])

    const logs = logsRes.data
    const profiles = profilesRes.data
    const rates = ratesRes.data ?? []

    // Build rate map
    const rateMap = new Map<string, number>()
    for (const r of rates) rateMap.set(r.role, Number(r.hourly_rate))

    if (!logs || !profiles) {
      return NextResponse.json({ error: 'Error al consultar datos' }, { status: 500 })
    }

    // Turnos por persona y día, para saber con qué rol trabajó cada fichaje
    const perfilRol = new Map(profiles.map((p) => [p.id, p.role as string]))
    const turnos = new Map<string, { rol: string; inicio: number }[]>()
    for (const t of (shiftsRes.data ?? []) as { user_id: string; shift_date: string; start_time: string; end_time: string; shift_role: string | null }[]) {
      if (!t.shift_role || !t.start_time || !t.end_time) continue
      const k = `${t.user_id}|${t.shift_date}`
      const lista = turnos.get(k) ?? []
      lista.push({ rol: t.shift_role, inicio: ventanaTurno(t.shift_date, t.start_time, t.end_time).inicio })
      turnos.set(k, lista)
    }
    /** Rol del turno más cercano a la entrada; sin turno, el del perfil. */
    const rolDelFichaje = (userId: string, fecha: string, entrada: string): string => {
      const lista = turnos.get(`${userId}|${fecha}`)
      if (!lista?.length) return perfilRol.get(userId) ?? ''
      const t = Date.parse(entrada)
      return lista.reduce((a, b) => (Math.abs(b.inicio - t) < Math.abs(a.inicio - t) ? b : a)).rol
    }

    // Aggregate per employee
    const empMap = new Map<string, {
      days: Map<string, { hours: number; clockIn: string; clockOut: string | null; status: string; clockOutType: string; attendanceId: string; tramos: number; revisar: boolean; role: string; pay: number }>
      porRol: Map<string, number>
      totalHours: number
      totalDays: number
      missingCheckouts: number
      lateArrivals: number
    }>()

    for (const log of logs) {
      if (!empMap.has(log.user_id)) {
        empMap.set(log.user_id, {
          days: new Map(),
          porRol: new Map(),
          totalHours: 0,
          totalDays: 0,
          missingCheckouts: 0,
          lateArrivals: 0,
        })
      }
      const emp = empMap.get(log.user_id)!

      // Entrada y salida son instantes completos: la diferencia ya cruza la
      // medianoche sola. Si da negativa es un dato mal cargado → 0 h y a revisar
      // (antes sumaba 24 h y pagaba un día de más).
      let hours = 0
      let revisar = false
      if (log.clock_out_at) {
        hours = differenceInMinutes(parseISO(log.clock_out_at), parseISO(log.clock_in_at)) / 60
        if (hours < 0 || hours > 20) { revisar = true; hours = Math.max(0, hours) > 20 ? hours : 0 }
      }

      const rol = rolDelFichaje(log.user_id, log.operative_date, log.clock_in_at)
      const pago = hours * (rateMap.get(rol) ?? 0)
      emp.porRol.set(rol, (emp.porRol.get(rol) ?? 0) + hours)

      // Turno cortado: dos fichajes el mismo día se suman en un solo día
      const prev = emp.days.get(log.operative_date)
      const salida = log.clock_out_at ? horaAR(log.clock_out_at) : null
      emp.days.set(log.operative_date, prev
        ? {
            ...prev,
            hours: Math.round((prev.hours + hours) * 100) / 100,
            clockOut: salida ?? prev.clockOut,
            status: log.status === 'open' ? 'open' : prev.status,
            tramos: prev.tramos + 1,
            revisar: prev.revisar || revisar,
            role: prev.role === rol ? rol : 'mixto',
            pay: prev.pay + pago,
          }
        : {
            hours: Math.round(hours * 100) / 100,
            clockIn: horaAR(log.clock_in_at),
            clockOut: salida,
            status: log.status,
            clockOutType: (log as Record<string, unknown>).clock_out_type as string ?? 'manual',
            attendanceId: log.id,
            tramos: 1,
            revisar,
            role: rol,
            pay: pago,
          })

      emp.totalHours += hours
      if (!prev) emp.totalDays++
      if (!log.clock_out_at && log.status === 'open') emp.missingCheckouts++
    }

    // Build result
    const employees = profiles
      .filter(p => empMap.has(p.id) && p.role !== 'socio')
      .map(p => {
        const emp = empMap.get(p.id)!
        const daysArray = Array.from(emp.days.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, data]) => ({ date, ...data, pay: Math.round(data.pay) }))

        const hourlyRate = rateMap.get(p.role) ?? 0
        const totalHours = Math.round(emp.totalHours * 100) / 100
        // Cada rol con su tarifa (de mayor a menor cantidad de horas)
        const byRole = [...emp.porRol.entries()]
          .map(([role, h]) => {
            const rate = rateMap.get(role) ?? 0
            const hrs = Math.round(h * 100) / 100
            return { role, hours: hrs, hourlyRate: rate, pay: Math.round(hrs * rate) }
          })
          .sort((a, b) => b.hours - a.hours)
        const totalPay = byRole.reduce((s, r) => s + r.pay, 0)

        return {
          id: p.id,
          firstName: p.first_name,
          lastName: p.last_name,
          role: p.role,
          hourlyRate,
          totalHours,
          totalDays: emp.totalDays,
          avgHoursPerDay: emp.totalDays > 0 ? Math.round((emp.totalHours / emp.totalDays) * 10) / 10 : 0,
          missingCheckouts: emp.missingCheckouts,
          totalPay,
          byRole,
          days: daysArray,
        }
      })
      .sort((a, b) => b.totalHours - a.totalHours)

    return NextResponse.json({
      period: { from, to },
      employees,
      rates: rates.map(r => ({ role: r.role, hourlyRate: Number(r.hourly_rate), label: r.label })),
      summary: {
        totalEmployees: employees.length,
        totalHours: Math.round(employees.reduce((s, e) => s + e.totalHours, 0) * 100) / 100,
        totalDays: employees.reduce((s, e) => s + e.totalDays, 0),
        totalPay: employees.reduce((s, e) => s + e.totalPay, 0),
        missingCheckouts: employees.reduce((s, e) => s + e.missingCheckouts, 0),
      },
    })
  } catch (error) {
    console.error('[liquidacion]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
