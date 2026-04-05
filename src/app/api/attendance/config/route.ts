import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/config
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data, error } = await supabase.from('attendance_config').select('key, value')
  if (error) return NextResponse.json({ error: 'Error al leer config' }, { status: 500 })

  const config: Record<string, unknown> = {}
  for (const row of data ?? []) {
    config[row.key] = row.value
  }

  return NextResponse.json({ config })
}

// PUT /api/attendance/config — update one or more config keys
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { updates } = await request.json() as { updates: Array<{ key: string; value: unknown }> }

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: 'updates[] requerido' }, { status: 400 })
  }

  const errors: string[] = []
  for (const { key, value } of updates) {
    const { error } = await supabase
      .from('attendance_config')
      .update({ value, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('key', key)
    if (error) errors.push(`Error al actualizar ${key}: ${error.message}`)
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 500 })
  }

  return NextResponse.json({ success: true, updated: updates.map(u => u.key) })
}
