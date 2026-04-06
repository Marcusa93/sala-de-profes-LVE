import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/history
// Params: employee_id?, from?, to?, page?, limit?
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const targetId = searchParams.get('employee_id') ?? user.id
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const offset = (page - 1) * limit

  // Admin check if requesting another employee
  if (targetId !== user.id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }
  }

  let query = supabase
    .from('clock_events')
    .select('*, profiles!clock_events_employee_id_fkey(first_name, last_name, role)', { count: 'exact' })
    .eq('employee_id', targetId)
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1)

  if (from) query = query.gte('timestamp', `${from}T00:00:00-03:00`)
  if (to)   query = query.lte('timestamp', `${to}T23:59:59-03:00`)

  const { data: events, count, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Error al consultar historial' }, { status: 500 })
  }

  return NextResponse.json({ events: events ?? [], total: count ?? 0, page, limit })
}
