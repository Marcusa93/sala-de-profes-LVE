'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Users,
  Clock,
  CalendarDays,
  Package,
  AlertTriangle,
  Bell,
  RefreshCw,
  ArrowRight,
  MessageCircle,
  LogOut,
} from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { DashboardSkeleton } from '@/components/ui/skeleton'
import {
  FadeIn,
  StaggerList,
  StaggerItem,
  ScalePress,
  PulseRing,
} from '@/components/ui/motion'
import { KpiCard } from '@/components/admin/KpiCard'
import { ExecutiveSummary } from '@/components/admin/ExecutiveSummary'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardKpis = {
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
// Page
// ---------------------------------------------------------------------------

export default function AdminDashboard() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [now] = useState(() => new Date())
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!profile) return

    async function loadKpis() {
      setLoading(true)
      const supabase = createClient()

      // Fetch KPIs in parallel from individual queries (RPCs need to be in DB first)
      try {
        const todayStr = format(new Date(), 'yyyy-MM-dd')
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
        const red = stockItems.filter((s) => s.current_qty <= s.min_qty).length
        const yellow = stockItems.filter((s) => s.current_qty > s.min_qty && s.current_qty <= s.min_qty * 1.5).length
        const green = stockItems.filter((s) => s.current_qty > s.min_qty * 1.5).length

        setKpis({
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
        })

        // Fudo sync — background, non-blocking
        window.fetch('/api/stock/sync').then(r => r.json()).then(d => {
          if (d.success) {
            setKpis(prev => prev ? { ...prev, fudo_synced: d.read?.synced ?? 0, fudo_last_sync: d.timestamp } : prev)
          }
        }).catch(() => {})
      } catch (err) {
        console.error('Error loading admin KPIs:', err)
        setLoadError(true)
        toast.error('Error al cargar el panel. Tirá hacia abajo para reintentar.')
      } finally {
        setLoading(false)
      }
    }

    loadKpis()
  }, [profile])

  if (profileLoading || (loading && !loadError)) {
    return <DashboardSkeleton />
  }

  if (loadError || !kpis) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <p className="text-sm text-muted-foreground">No se pudo cargar el panel</p>
        <button onClick={() => { setLoadError(false); setLoading(true) }} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white">
          Reintentar
        </button>
      </div>
    )
  }

  const hasIssues = kpis.stock_red > 0 || kpis.missing_checkouts > 0 || kpis.announcements_urgent > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-[#3d2c24]">
              Centro de Control
            </h1>
            <p className="section-label mt-1 capitalize">
              {format(now, "EEEE d 'de' MMMM", { locale: es })}
            </p>
          </div>
          {hasIssues && (
            <div className="flex items-center gap-1.5 rounded-full bg-[#fef2f2] px-3 py-1.5 text-xs font-semibold text-[#ea504c]">
              <PulseRing color="#ea504c" />
              Atención
            </div>
          )}
        </div>
      </FadeIn>

      {/* ================================================================ */}
      {/* KPI Grid                                                         */}
      {/* ================================================================ */}
      <StaggerList className="grid grid-cols-2 gap-3" staggerDelay={0.04}>
        <StaggerItem>
          <KpiCard
            label="Presentes hoy"
            value={kpis.team_present_today}
            icon={Users}
            color="#006d5a"
            bg="#e8f5f1"
            href="/admin/reportes/asistencia"
            subtitle={`de ${kpis.team_total_active} activos`}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            label="En turno ahora"
            value={kpis.team_clocked_in}
            icon={Clock}
            color={kpis.missing_checkouts > 0 ? '#d4943a' : '#006d5a'}
            bg={kpis.missing_checkouts > 0 ? '#fdf6ec' : '#e8f5f1'}
            subtitle={kpis.missing_checkouts > 0 ? `${kpis.missing_checkouts} sin egreso` : 'todos marcados'}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            label="Turnos hoy"
            value={kpis.shifts_today}
            icon={CalendarDays}
            color="#8b5e34"
            bg="#faf0e4"
            href="/admin/reportes/turnos"
            subtitle={`${kpis.shifts_tomorrow} mañana`}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            label="Stock crítico"
            value={kpis.stock_red}
            icon={Package}
            color={kpis.stock_red > 0 ? '#ea504c' : '#006d5a'}
            bg={kpis.stock_red > 0 ? '#fef2f2' : '#e8f5f1'}
            href="/admin/reportes/stock"
            subtitle={`${kpis.stock_yellow} en atención`}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            label="Notificaciones"
            value={kpis.announcements_active}
            icon={Bell}
            color={kpis.announcements_urgent > 0 ? '#ea504c' : '#d4943a'}
            bg={kpis.announcements_urgent > 0 ? '#fef2f2' : '#fdf6ec'}
            href="/admin/reportes/notificaciones"
            subtitle={kpis.announcements_urgent > 0 ? `${kpis.announcements_urgent} urgentes` : 'sin urgentes'}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            label="Fudo"
            value={kpis.fudo_synced ?? 0}
            icon={RefreshCw}
            color="#006d5a"
            bg="#e8f5f1"
            href="/stock"
            subtitle={kpis.fudo_last_sync ? `Sync ${new Date(kpis.fudo_last_sync).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : 'sin sync'}
          />
        </StaggerItem>
      </StaggerList>

      {/* ================================================================ */}
      {/* Alerts Panel (if any issues)                                     */}
      {/* ================================================================ */}
      {hasIssues && (
        <FadeIn delay={0.2}>
          <div className="rounded-2xl bg-[#fef2f2] p-4 ring-1 ring-[#ea504c]/10">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="size-4 text-[#ea504c]" />
              <span className="text-sm font-semibold text-[#ea504c]">Alertas activas</span>
            </div>
            <div className="space-y-2 text-sm text-[#3d2c24]">
              {kpis.missing_checkouts > 0 && (
                <div className="flex items-center gap-2">
                  <LogOut className="size-3.5 text-[#d4943a]" />
                  <span>{kpis.missing_checkouts} persona{kpis.missing_checkouts > 1 ? 's' : ''} sin marcar egreso</span>
                </div>
              )}
              {kpis.stock_red > 0 && (
                <div className="flex items-center gap-2">
                  <Package className="size-3.5 text-[#ea504c]" />
                  <span>{kpis.stock_red} ítem{kpis.stock_red > 1 ? 's' : ''} de stock en nivel crítico</span>
                </div>
              )}
              {kpis.announcements_urgent > 0 && (
                <div className="flex items-center gap-2">
                  <Bell className="size-3.5 text-[#ea504c]" />
                  <span>{kpis.announcements_urgent} notificación{kpis.announcements_urgent > 1 ? 'es' : ''} urgente{kpis.announcements_urgent > 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          </div>
        </FadeIn>
      )}

      {/* ================================================================ */}
      {/* Executive Summary                                                */}
      {/* ================================================================ */}
      <ExecutiveSummary />

      {/* ================================================================ */}
      {/* Quick Access                                                     */}
      {/* ================================================================ */}
      <FadeIn delay={0.25}>
        <h2 className="section-label mb-3">Accesos rápidos</h2>
        <StaggerList className="flex flex-col gap-2" staggerDelay={0.04}>
          {[
            { href: '/asistente', icon: MessageCircle, label: 'La Vieja de Historia', color: '#006d5a' },
            { href: '/equipo', icon: Users, label: 'Gestionar Equipo', color: '#8b5e34' },
            { href: '/stock', icon: Package, label: 'Gestionar Stock', color: '#ea504c' },
          ].map((link) => (
            <StaggerItem key={link.href}>
              <ScalePress>
                <Link href={link.href}>
                  <div className="card-interactive flex items-center overflow-hidden rounded-xl">
                    <div className="w-1 self-stretch" style={{ backgroundColor: link.color }} />
                    <div className="flex flex-1 items-center justify-between px-4 py-3">
                      <span className="flex items-center gap-3">
                        <div
                          className="flex size-8 items-center justify-center rounded-lg"
                          style={{ backgroundColor: `${link.color}10` }}
                        >
                          <link.icon className="size-4" style={{ color: link.color }} />
                        </div>
                        <span className="text-sm font-medium text-[#3d2c24]">{link.label}</span>
                      </span>
                      <ArrowRight className="size-4 text-[#d1cdc7]" />
                    </div>
                  </div>
                </Link>
              </ScalePress>
            </StaggerItem>
          ))}
        </StaggerList>
      </FadeIn>
    </div>
  )
}
