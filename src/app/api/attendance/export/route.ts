import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv
// Exports clock events for liquidation
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') ?? new Date().toISOString().slice(0, 7) + '-01'
  const to = searchParams.get('to') ?? new Date().toISOString().slice(0, 10)

  // Get all employees
  const { data: employees } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, role')
    .eq('is_active', true)
    .order('first_name')

  if (!employees) return NextResponse.json({ error: 'Sin empleados' }, { status: 500 })

  const rows: string[][] = []
  rows.push(['Empleado', 'Rol', 'Días trabajados', 'Horas totales', 'Horas normales', 'Horas nocturnas', 'Horas extra'])

  for (const emp of employees) {
    const { data: hours } = await supabase.rpc('calculate_employee_hours', {
      p_employee_id: emp.id,
      p_from: from,
      p_to: to,
    })

    const h = Array.isArray(hours) ? hours[0] : hours
    rows.push([
      `${emp.first_name} ${emp.last_name}`,
      emp.role,
      String(h?.days_worked ?? 0),
      String(h?.total_hours ?? 0),
      String(h?.normal_hours ?? 0),
      String(h?.nocturnal_hours ?? 0),
      String(h?.extra_hours ?? 0),
    ])
  }

  const csv = rows.map(r => r.map(cell => `"${cell}"`).join(',')).join('\n')
  const filename = `asistencia_${from}_${to}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
