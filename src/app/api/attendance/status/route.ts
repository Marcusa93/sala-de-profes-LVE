import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/status
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const todayStr = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })

  const { data: todayRecord } = await supabase
    .from('attendance_logs')
    .select('id, operative_date, clock_in_at, clock_out_at, status, is_suspicious, suspicious_reasons, clock_in_lat, clock_in_lng')
    .eq('user_id', user.id)
    .eq('operative_date', todayStr)
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let status: string
  if (!todayRecord) {
    status = 'not_clocked_in'
  } else if (todayRecord.status === 'open') {
    status = 'clocked_in'
  } else {
    status = 'completed'
  }

  return NextResponse.json({
    status,
    today_record: todayRecord,
  })
}
