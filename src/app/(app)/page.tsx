'use client'

import { useEffect, useState, useCallback } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import { isStockCritical } from '@/lib/contracts/stock'
import { DailyBriefing } from '@/components/ai/DailyBriefing'
import { ActionCenter } from '@/components/ai/ActionCenter'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock,
  CalendarDays,
  Bell,
  Users,
  AlertTriangle,
  LogIn,
  ArrowRight,
  CheckCircle,
  UtensilsCrossed,
  Coffee,
  ShoppingCart,
  Bot,
  Send,
  Loader2,
  X,
  BarChart3,
  FolderOpen,
  Package,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'
import { DashboardSkeleton } from '@/components/ui/skeleton'
import {
  FadeIn,
  StaggerList,
  StaggerItem,
  ScalePress,
  AnimatedNumber,
  PulseRing,
} from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TodayAttendance = {
  id: string
  clock_in_at: string
  clock_out_at: string | null
} | null

type NextShift = {
  shift_date: string
  start_time: string
  end_time: string
  shift_role: AppRole
} | null

type TeamMember = {
  clock_in_at: string
  profiles: { first_name: string; last_name: string; role: AppRole } | null
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [todayAttendance, setTodayAttendance] = useState<TodayAttendance>(null)
  const [nextShift, setNextShift] = useState<NextShift>(null)
  const [announcementCount, setAnnouncementCount] = useState(0)
  const [teamToday, setTeamToday] = useState<TeamMember[]>([])
  const [criticalStockCount, setCriticalStockCount] = useState(0)
  const [stockItems, setStockItems] = useState<{ id: string; name: string; current_qty: number; min_qty: number; supplier_id: string | null; category: string }[]>([])
  const [pendingOrders, setPendingOrders] = useState(0)
  const [expedientesActivos, setExpedientesActivos] = useState(0)
  const [expedientesData, setExpedientesData] = useState<{ id: string; code: string; title: string; status: string; urgency: string; target_date: string | null; updated_at: string; responsible_id: string | null }[]>([])
  const [ventasHoy, setVentasHoy] = useState<{ total: number; tickets: number } | null>(null)
  const [barUrgent, setBarUrgent] = useState(0)
  const [loading, setLoading] = useState(true)

  // Report dialog state
  const [reportOpen, setReportOpen] = useState(false)
  const [reportMsg, setReportMsg] = useState('')
  const [reportUrgency, setReportUrgency] = useState<'normal' | 'urgente'>('normal')
  const [reportSending, setReportSending] = useState(false)

  const sendReport = useCallback(async () => {
    if (!reportMsg.trim()) {
      toast.error('Escribí qué problema hay')
      return
    }
    setReportSending(true)
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reportMsg.trim(), urgency: reportUrgency }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success('Reporte enviado al encargado')
      setReportOpen(false)
      setReportMsg('')
      setReportUrgency('normal')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar')
    } finally {
      setReportSending(false)
    }
  }, [reportMsg, reportUrgency])

  const [today] = useState(() => new Date())
  const todayStr = format(today, 'yyyy-MM-dd')
  const isEncargado = isManagerOrAbove(profile?.role)

  // Fetch all dashboard data
  useEffect(() => {
    if (!profile) return

    async function fetchData() {
      setLoading(true)
      const supabase = createClient()

      try {
        const attendancePromise = supabase
          .from('attendance_logs')
          .select('id, clock_in_at, clock_out_at')
          .eq('user_id', profile!.id)
          .eq('operative_date', todayStr)
          .order('clock_in_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const shiftPromise = supabase
          .from('shifts')
          .select('shift_date, start_time, end_time, shift_role')
          .eq('user_id', profile!.id)
          .gte('shift_date', todayStr)
          .order('shift_date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(1)
          .maybeSingle()

        const announcementsPromise = supabase
          .from('announcements')
          .select('*', { count: 'exact', head: true })
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

        const teamPromise = isEncargado
          ? supabase
              .from('attendance_logs')
              .select(
                'clock_in_at, profiles!attendance_logs_user_id_fkey(first_name, last_name, role)',
              )
              .eq('operative_date', todayStr)
              .is('clock_out_at', null)
          : null

        const stockPromise = isEncargado
          ? supabase
              .from('stock_items')
              .select('id, name, current_qty, min_qty, supplier_id, category')
              .eq('is_active', true)
          : null

        // Pedidos pendientes (cocina + barra) — for encargado/socio
        const ordersPromise = isEncargado
          ? Promise.all([
              supabase.from('kitchen_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
              supabase.from('bar_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            ])
          : null

        // Expedientes activos — for socio (fetch full data for actions)
        const expedientesPromise = profile!.role === 'socio'
          ? supabase.from('expedientes').select('id, code, title, status, urgency, target_date, updated_at, responsible_id').not('status', 'in', '("cumplido","cerrado_sin_implementacion","archivado")')
          : null

        // Ventas hoy — for socio
        const ventasPromise = profile!.role === 'socio'
          ? fetch('/api/fudo/auto-sync').then(r => r.json()).catch(() => null)
          : null

        // Bar stock urgente — for barista
        const barUrgentPromise = profile!.role === 'barista'
          ? supabase.from('bar_stock_items').select('id', { count: 'exact', head: true }).eq('is_urgent', true).eq('is_active', true)
          : null

        const [attendanceRes, shiftRes, announcementsRes, teamRes, stockRes, ordersRes, expedientesRes, ventasRes, barUrgentRes] =
          await Promise.all([
            attendancePromise,
            shiftPromise,
            announcementsPromise,
            teamPromise,
            stockPromise,
            ordersPromise,
            expedientesPromise,
            ventasPromise,
            barUrgentPromise,
          ])

        setTodayAttendance(attendanceRes.data)
        setNextShift(shiftRes.data)
        setAnnouncementCount(announcementsRes.count ?? 0)

        if (teamRes) {
          setTeamToday((teamRes.data as unknown as TeamMember[]) ?? [])
        }
        if (stockRes?.data) {
          const items = stockRes.data ?? []
          setStockItems(items)
          const critical = items.filter((item) => isStockCritical(item.current_qty ?? 0, item.min_qty ?? 0))
          setCriticalStockCount(critical.length)
        }
        if (ordersRes) {
          const [kitchenRes, barRes] = ordersRes
          setPendingOrders((kitchenRes.count ?? 0) + (barRes.count ?? 0))
        }
        if (expedientesRes?.data) {
          setExpedientesData(expedientesRes.data ?? [])
          setExpedientesActivos(expedientesRes.data?.length ?? 0)
        }
        if (ventasRes?.today) {
          setVentasHoy({ total: ventasRes.today.totalFacturado ?? 0, tickets: ventasRes.today.totalTickets ?? 0 })
        }
        if (barUrgentRes) {
          setBarUrgent(barUrgentRes.count ?? 0)
        }
      } catch (err) {
        console.error('Error al cargar datos del dashboard:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [profile, todayStr])

  const firstName = profile?.first_name ?? ''

  // ------------------------------------------
  // Skeleton while loading
  // ------------------------------------------
  if (profileLoading || loading) {
    return <DashboardSkeleton />
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#a39e97]">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  // Attendance status helpers
  const isCompleted = !!todayAttendance?.clock_out_at
  const isInProgress = !!todayAttendance && !todayAttendance.clock_out_at
  const statusColor = isCompleted ? '#006d5a' : isInProgress ? '#d4943a' : '#ebe6df'
  const isSocio = profile?.role === 'socio'

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-8">
      {/* ---------------------------------------------------------------- */}
      {/* Header / Welcome — compact                                       */}
      {/* ---------------------------------------------------------------- */}
      <FadeIn className="pt-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-[#3d2c24]">
              Hola, <span className="text-[#006d5a]">{firstName}</span>
            </h1>
            <p className="section-label mt-1 capitalize">
              {format(today, "EEEE d 'de' MMMM", { locale: es })}
            </p>
          </div>
          {/* Compact attendance status — right aligned */}
          <Link href="/mi-turno" className="flex items-center gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-[#f3efe9]">
            <div className="size-2.5 rounded-full" style={{ backgroundColor: statusColor }} />
            <span className="text-xs font-semibold text-[#3d2c24]">
              {isCompleted ? 'Turno OK' : isInProgress ? 'En turno' : 'Sin fichar'}
            </span>
            {todayAttendance && (
              <span className="text-[10px] tabular-nums text-[#a39e97]">
                {format(new Date(todayAttendance.clock_in_at), 'HH:mm')}
              </span>
            )}
          </Link>
        </div>
      </FadeIn>

      {/* ---------------------------------------------------------------- */}
      {/* AI Daily Briefing — socio/encargado only                         */}
      {/* ---------------------------------------------------------------- */}
      {isEncargado && (
        <FadeIn delay={0.08}>
          <DailyBriefing />
        </FadeIn>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* KPI Grid — role-aware, most important first                      */}
      {/* ---------------------------------------------------------------- */}
      <StaggerList className="grid grid-cols-2 gap-3" staggerDelay={0.04}>
        {/* Socio: Ventas Hoy — FIRST for socios */}
        {isSocio && ventasHoy && (
          <StaggerItem>
            <ScalePress>
              <Link href="/ventas">
                <div className="kpi-card rounded-xl p-4" style={{ borderLeftWidth: 3, borderLeftColor: '#006d5a' }}>
                  <div className="flex items-center gap-2">
                    <BarChart3 className="size-3.5 text-[#006d5a]" />
                    <span className="section-label">Facturado hoy</span>
                  </div>
                  <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#006d5a]">
                    ${(ventasHoy.total / 1000).toFixed(0)}k
                  </p>
                  <p className="text-[10px] text-[#a39e97]">{ventasHoy.tickets} tickets</p>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        )}

        {/* Encargado/Socio: Pedidos Pendientes */}
        {isEncargado && pendingOrders > 0 && (
          <StaggerItem>
            <ScalePress>
              <Link href="/pedidos">
                <div className="kpi-card rounded-xl p-4" style={{ borderLeftWidth: 3, borderLeftColor: '#d4943a' }}>
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="size-3.5 text-[#d4943a]" />
                    <span className="section-label">Pedidos</span>
                  </div>
                  <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#d4943a]">
                    <AnimatedNumber value={pendingOrders} />
                  </p>
                  <p className="text-[10px] text-[#a39e97]">pendientes</p>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        )}

        {/* Avisos — always visible */}
        <StaggerItem>
          <ScalePress>
            <Link href="/notificaciones">
              <div className="kpi-card rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <Bell className={`size-3.5 ${announcementCount > 5 ? 'text-[#d4943a]' : 'text-[#a39e97]'}`} />
                  <span className="section-label">Avisos</span>
                </div>
                <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
                  <AnimatedNumber value={announcementCount} />
                </p>
                <p className="text-[10px] text-[#a39e97]">pendientes</p>
              </div>
            </Link>
          </ScalePress>
        </StaggerItem>

        {/* Proximo Turno — compact */}
        <StaggerItem>
          <ScalePress>
            <Link href="/mis-horarios">
              <div className="kpi-card rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <CalendarDays className="size-3.5 text-[#8b5e34]" />
                  <span className="section-label">Próximo turno</span>
                </div>
                {nextShift ? (
                  <>
                    <p className="mt-2 font-display text-lg font-bold tabular-nums text-[#3d2c24]">
                      {nextShift.start_time.slice(0, 5)} – {nextShift.end_time.slice(0, 5)}
                    </p>
                    <p className="text-[10px] capitalize text-[#a39e97]">
                      {format(new Date(nextShift.shift_date + 'T12:00:00'), 'EEE d MMM', { locale: es })}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-[#a39e97]">Sin turnos</p>
                )}
              </div>
            </Link>
          </ScalePress>
        </StaggerItem>

        {/* Socio: Expedientes */}
        {isSocio && (
          <StaggerItem>
            <ScalePress>
              <Link href="/expedientes">
                <div className="kpi-card rounded-xl p-4">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="size-3.5 text-[#8b5e34]" />
                    <span className="section-label">Expedientes</span>
                  </div>
                  <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
                    <AnimatedNumber value={expedientesActivos} />
                  </p>
                  <p className="text-[10px] text-[#a39e97]">activos</p>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        )}

        {/* Encargado/Socio: Stock Crítico */}
        {isEncargado && (
          <StaggerItem>
            <ScalePress>
              <Link href="/stock">
                <div className="kpi-card rounded-xl p-4" style={criticalStockCount > 0 ? { borderLeftWidth: 3, borderLeftColor: '#ea504c' } : {}}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`size-3.5 ${criticalStockCount > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`} />
                    <span className="section-label">Stock</span>
                  </div>
                  <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${criticalStockCount > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`}>
                    {criticalStockCount > 0 ? <AnimatedNumber value={criticalStockCount} /> : '✓'}
                  </p>
                  <p className="text-[10px] text-[#a39e97]">
                    {criticalStockCount === 0 ? 'Todo en orden' : 'críticos'}
                  </p>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        )}

        {/* Barista: Stock Barra */}
        {profile?.role === 'barista' && (
          <StaggerItem>
            <ScalePress>
              <Link href="/cocina/barra">
                <div className="kpi-card rounded-xl p-4" style={barUrgent > 0 ? { borderLeftWidth: 3, borderLeftColor: '#ea504c' } : {}}>
                  <div className="flex items-center gap-2">
                    <Coffee className={`size-3.5 ${barUrgent > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`} />
                    <span className="section-label">Barra</span>
                  </div>
                  <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${barUrgent > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`}>
                    {barUrgent > 0 ? <AnimatedNumber value={barUrgent} /> : '✓'}
                  </p>
                  <p className="text-[10px] text-[#a39e97]">
                    {barUrgent === 0 ? 'Todo OK' : 'urgentes'}
                  </p>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        )}

        {/* Encargado: Equipo Hoy */}
        {isEncargado && (
          <StaggerItem>
            <ScalePress>
              <Link href="/equipo">
                <div className="kpi-card rounded-xl p-4">
                  <div className="flex items-center gap-2">
                    <Users className="size-3.5 text-[#006d5a]" />
                    <span className="section-label">Equipo</span>
                  </div>
                  <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
                    <AnimatedNumber value={teamToday.length} />
                  </p>
                  <p className="text-[10px] text-[#a39e97]">
                    {teamToday.length === 0 ? 'Nadie fichó' : 'presentes'}
                  </p>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        )}

        {/* Stock Critico — already in grid above for encargado/socio */}
      </StaggerList>

      {/* ---------------------------------------------------------------- */}
      {/* Unified Action Center                                            */}
      {/* ---------------------------------------------------------------- */}
      {isEncargado && (
        <FadeIn delay={0.2}>
          <ActionCenter compact maxItems={4} />
        </FadeIn>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Quick Actions                                                    */}
      {/* ---------------------------------------------------------------- */}
      <FadeIn delay={0.25}>
        <h2 className="section-label mb-3">Acciones rápidas</h2>
        <StaggerList className="flex flex-col gap-2.5" staggerDelay={0.06}>
          {[
            { href: '/mi-turno', icon: LogIn, label: 'Marcar Ingreso/Egreso' },
            ...(profile?.role === 'socio' ? [
              { href: '/ventas', icon: BarChart3, label: 'Ventas del día' },
              { href: '/admin', icon: CalendarDays, label: 'Centro de Control' },
              { href: '/pedidos', icon: ShoppingCart, label: 'Gestión de Compras' },
              { href: '/expedientes', icon: FolderOpen, label: 'Expedientes' },
            ] : isEncargado ? [
              { href: '/admin', icon: CalendarDays, label: 'Centro de Control' },
              { href: '/pedidos', icon: ShoppingCart, label: 'Gestión de Compras' },
              { href: '/cocina', icon: UtensilsCrossed, label: 'Cocina' },
              { href: '/stock', icon: Package, label: 'Stock' },
            ] : profile?.role === 'chef' || profile?.role === 'cocina' ? [
              { href: '/cocina', icon: UtensilsCrossed, label: 'Cocina' },
              { href: '/cocina/pedidos', icon: ShoppingCart, label: 'Pedir mercadería' },
            ] : profile?.role === 'barista' ? [
              { href: '/cocina/barra', icon: Coffee, label: 'Barra — Stock y Pedidos' },
            ] : [
              { href: '/mis-horarios', icon: CalendarDays, label: 'Ver Horarios' },
            ]),
            { href: '/asistente', icon: Bot, label: 'La Vieja de Historia' },
          ].map((action) => (
            <StaggerItem key={action.href}>
              <ScalePress>
                <Link href={action.href}>
                  <div className="card-interactive flex items-center overflow-hidden rounded-xl">
                    <div className="w-1 self-stretch bg-[#006d5a]" />
                    <div className="flex flex-1 items-center justify-between px-4 py-3.5">
                      <span className="flex items-center gap-3">
                        <div className="icon-btn flex items-center justify-center rounded-xl bg-[#f0f7f5]">
                          <action.icon className="size-4 text-[#006d5a]" />
                        </div>
                        <span className="text-sm font-medium text-[#3d2c24]">
                          {action.label}
                        </span>
                      </span>
                      <ArrowRight className="size-4 text-[#d1cdc7]" />
                    </div>
                  </div>
                </Link>
              </ScalePress>
            </StaggerItem>
          ))}
          {/* Reportar problema — inline button */}
          <StaggerItem>
            <ScalePress>
              <button
                onClick={() => setReportOpen(true)}
                className="card-interactive flex w-full items-center overflow-hidden rounded-xl text-left"
              >
                <div className="w-1 self-stretch bg-[#ea504c]" />
                <div className="flex flex-1 items-center justify-between px-4 py-3.5">
                  <span className="flex items-center gap-3">
                    <div className="icon-btn flex items-center justify-center rounded-xl bg-[#fef2f2]">
                      <AlertTriangle className="size-4 text-[#ea504c]" />
                    </div>
                    <span className="text-sm font-medium text-[#3d2c24]">
                      Reportar problema
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-[#d1cdc7]" />
                </div>
              </button>
            </ScalePress>
          </StaggerItem>
        </StaggerList>
      </FadeIn>

      {/* ---------------------------------------------------------------- */}
      {/* Report Problem Dialog                                            */}
      {/* ---------------------------------------------------------------- */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setReportOpen(false)}
          />
          <div className="relative z-10 mx-3 mb-[calc(0.5rem+env(safe-area-inset-bottom))] w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-4 sm:p-5 shadow-xl sm:mx-auto sm:mb-0">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#3d2c24]">Reportar problema</h3>
              <button
                onClick={() => setReportOpen(false)}
                className="icon-btn flex items-center justify-center rounded-full text-[#a39e97] hover:bg-[#f3efe9]"
              >
                <X className="size-5" />
              </button>
            </div>

            <textarea
              value={reportMsg}
              onChange={(e) => setReportMsg(e.target.value)}
              placeholder="¿Qué problema hay? Ej: Se rompió la máquina de café, falta leche urgente..."
              rows={2}
              className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-3 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
            />

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setReportUrgency('normal')}
                className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-all ${
                  reportUrgency === 'normal'
                    ? 'border-[#006d5a] bg-[#e8f5f1] text-[#006d5a]'
                    : 'border-[#ebe6df] text-[#a39e97]'
                }`}
              >
                Normal
              </button>
              <button
                onClick={() => setReportUrgency('urgente')}
                className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-all ${
                  reportUrgency === 'urgente'
                    ? 'border-[#ea504c] bg-[#fef2f2] text-[#ea504c]'
                    : 'border-[#ebe6df] text-[#a39e97]'
                }`}
              >
                Urgente
              </button>
            </div>

            <button
              onClick={sendReport}
              disabled={reportSending || !reportMsg.trim()}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] text-sm font-semibold text-white shadow-md transition-all hover:bg-[#005a4a] disabled:opacity-50 active:scale-[0.98]"
            >
              {reportSending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar reporte
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
