'use client'

import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { SWR_KEYS } from '@/lib/swr/keys'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttendanceRecord = {
  id: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  status: 'open' | 'closed' | 'missing_checkout'
  notes: string | null
  is_suspicious?: boolean
  clock_in_lat?: number | null
  clock_out_type?: string | null
  edited_by?: string | null
}

export type TeamMember = {
  clock_in_at: string
  profiles: { first_name: string; last_name: string; role: AppRole } | null
}

// ---------------------------------------------------------------------------
// Today's attendance for a user
// ---------------------------------------------------------------------------

export function useMyAttendance(userId: string | undefined, date: string) {
  const { data, error, isLoading, mutate } = useSWR(
    userId ? SWR_KEYS.attendance(userId, date) : null,
    async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, is_suspicious, clock_in_lat')
        .eq('user_id', userId!)
        .eq('operative_date', date)
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as AttendanceRecord | null
    },
    { revalidateOnFocus: true },
  )

  return { record: data ?? null, error, isLoading, mutate }
}

// ---------------------------------------------------------------------------
// Attendance history for a user
// ---------------------------------------------------------------------------

export function useAttendanceHistory(userId: string | undefined, limit: number) {
  const { data, error, isLoading, mutate } = useSWR(
    userId ? SWR_KEYS.attendanceHistory(userId, limit) : null,
    async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, is_suspicious, clock_in_lat')
        .eq('user_id', userId!)
        .order('operative_date', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as AttendanceRecord[]
    },
    { revalidateOnFocus: true },
  )

  return { history: data ?? [], error, isLoading, mutate }
}

// ---------------------------------------------------------------------------
// Team attendance for a date (encargado/socio)
// ---------------------------------------------------------------------------

export function useTeamAttendance(date: string, enabled = true) {
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? SWR_KEYS.attendanceTeam(date) : null,
    async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('attendance_logs')
        .select('clock_in_at, profiles!attendance_logs_user_id_fkey(first_name, last_name, role)')
        .eq('operative_date', date)
        .is('clock_out_at', null)
      if (error) throw error
      return (data ?? []) as unknown as TeamMember[]
    },
    { revalidateOnFocus: true },
  )

  return { team: data ?? [], error, isLoading, mutate }
}
