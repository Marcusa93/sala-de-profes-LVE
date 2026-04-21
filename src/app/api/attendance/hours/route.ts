import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/hours?employee_id=&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const targetId = searchParams.get('employee_id') ?? user.id
  const from = searchParams.get('from') ?? new Date().toISOString().slice(0, 7) + '-01'
  const to = searchParams.get('to') ?? new Date().toISOString().slice(0, 10)

  if (targetId !== user.id) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }
  }

  const { data, error } = await supabase.rpc('calculate_employee_hours', {
    p_employee_id: targetId,
    p_from: from,
    p_to: to,
  })

  if (error) {
    console.error('calculate_employee_hours error:', error)
    return NextResponse.json({ error: 'Error al calcular horas' }, { status: 500 })
  }

  const result = Array.isArray(data) ? data[0] : data

  return NextResponse.json({
    employee_id: targetId,
    from,
    to,
    hours: result ?? { total_hours: 0, normal_hours: 0, nocturnal_hours: 0, extra_hours: 0, days_worked: 0 },
  })
}
