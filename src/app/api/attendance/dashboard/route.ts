import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') ?? new Date().toISOString().slice(0, 10)
  const to = searchParams.get('to') ?? from

  const { data, error } = await supabase.rpc('attendance_dashboard', {
    p_from: from,
    p_to: to,
  })

  if (error) {
    console.error('attendance_dashboard error:', error)
    return NextResponse.json({ error: 'Error al consultar dashboard' }, { status: 500 })
  }

  // Unresolved anomalies summary
  const { data: anomalies } = await supabase
    .from('attendance_anomalies')
    .select('anomaly_type, severity, employee_id, profiles!attendance_anomalies_employee_id_fkey(first_name, last_name)')
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(50)

  // WiFi APs
  const { data: wifiAPs } = await supabase
    .from('wifi_access_points')
    .select('*')
    .eq('is_active', true)

  return NextResponse.json({
    employees: data ?? [],
    open_anomalies: anomalies ?? [],
    wifi_aps: wifiAPs ?? [],
    from,
    to,
  })
}
