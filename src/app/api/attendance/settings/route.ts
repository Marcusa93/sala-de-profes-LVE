import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/attendance/settings
// Returns attendance config (location, feature flags) for the clock UI
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: settings } = await admin
      .from('app_settings')
      .select('key, value')
      .in('key', ['attendance_location', 'attendance_config'])

    const result: Record<string, unknown> = {}
    for (const s of settings ?? []) {
      result[s.key] = s.value
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[GET /api/attendance/settings]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
