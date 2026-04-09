'use client'

import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { SWR_KEYS } from '@/lib/swr/keys'
import { format } from 'date-fns'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminKpis = {
  team_present_today: number
  team_clocked_in: number
  team_total_active: number
  missing_checkouts: number
  shifts_today: number
  shifts_tomorrow: number
  stock_red: number
  stock_yellow: number
  stock_green: number
  stock_total: number
  announcements_active: number
  announcements_urgent: number
  suppliers_total: number
  fudo_synced?: number
  fudo_last_sync?: string
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAdminKpis(enabled = true) {
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  const { data, error, isLoading, mutate } = useSWR(
    enabled ? SWR_KEYS.adminKpis(todayStr) : null,
    async (): Promise<AdminKpis> => {
      const supabase = createClient()
      const tomorrowStr = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd')

      const [attendance, attendanceOpen, profiles, shiftsTodayRes, shiftsTomorrowRes, stock, announcementsRes, announcementsUrgent, suppliersRes] = await Promise.all([
        supabase.from('attendance_logs').select('user_id', { count: 'exact', head: true }).eq('operative_date', todayStr),
        supabase.from('attendance_logs').select('user_id', { count: 'exact', head: true }).eq('operative_date', todayStr).is('clock_out_at', null).eq('status', 'open'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('shifts').select('id', { count: 'exact', head: true }).eq('shift_date', todayStr),
        supabase.from('shifts').select('id', { count: 'exact', head: true }).eq('shift_date', tomorrowStr),
        supabase.from('stock_items').select('id, current_qty, min_qty').eq('is_active', true),
        supabase.from('announcements').select('id', { count: 'exact', head: true }).eq('is_active', true).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
        supabase.from('announcements').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('priority', 'critica').or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }),
      ])

      const stockItems = stock.data ?? []
      const red = stockItems.filter(s => s.current_qty <= s.min_qty).length
      const yellow = stockItems.filter(s => s.current_qty > s.min_qty && s.current_qty <= s.min_qty * 1.5).length
      const green = stockItems.filter(s => s.current_qty > s.min_qty * 1.5).length

      // Fudo sync — background, merged after
      let fudo_synced: number | undefined
      let fudo_last_sync: string | undefined
      try {
        const fudoRes = await fetch('/api/stock/sync')
        const fudoData = await fudoRes.json()
        if (fudoData.success) {
          fudo_synced = fudoData.read?.synced ?? 0
          fudo_last_sync = fudoData.timestamp
        }
      } catch { /* non-blocking */ }

      return {
        team_present_today: attendance.count ?? 0,
        team_clocked_in: attendanceOpen.count ?? 0,
        team_total_active: profiles.count ?? 0,
        missing_checkouts: attendanceOpen.count ?? 0,
        shifts_today: shiftsTodayRes.count ?? 0,
        shifts_tomorrow: shiftsTomorrowRes.count ?? 0,
        stock_red: red,
        stock_yellow: yellow,
        stock_green: green,
        stock_total: stockItems.length,
        announcements_active: announcementsRes.count ?? 0,
        announcements_urgent: announcementsUrgent.count ?? 0,
        suppliers_total: suppliersRes.count ?? 0,
        fudo_synced,
        fudo_last_sync,
      }
    },
    {
      revalidateOnFocus: true,
      dedupingInterval: 60_000,
    },
  )

  return { kpis: data ?? null, error, isLoading, mutate }
}
