'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, subDays, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  DollarSign, ShoppingBag, Receipt, TrendingUp, Clock,
  RefreshCw, Loader2, BarChart3, FileText, Trophy, Flame, Star,
  UtensilsCrossed, CircleDot, CheckCircle, Timer,
  ChevronLeft, ChevronRight, CalendarDays,
} from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TicketItem = { name: string; qty: number; price: number }
type Ticket = {
  ticketId: string
  state: string
  saleType: string
  tableNumber: number | null
  total: number
  time: string
  closedAt: string | null
  items: TicketItem[]
}

type DashboardData = {
  totalFacturado: number
  totalEnCurso: number
  totalGeneral: number
  totalTickets: number
  totalItems: number
  avgTicket: number
  mesasAbiertas: number
  takeawayAbiertos: number
  totalAbiertas: number
  mesasCerradas: number
  topProducts: { name: string; qty: number; revenue: number }[]
  bySaleType: { name: string; tickets: number; revenue: number }[]
  byHour: { hour: string; tickets: number; revenue: number; items: number }[]
  openTables: Ticket[]
  openTakeaway: Ticket[]
  recentSales: Ticket[]
}

const PIE_COLORS = ['#006d5a', '#8b5e34', '#d4943a', '#4a90d9', '#c67b4b', '#2d7d6a']
const REFRESH_INTERVAL = 5 * 60 * 1000

const STATE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  'IN-COURSE': { label: 'En curso', color: '#006d5a', bg: '#e8f5f1' },
  'PAYMENT-PROCESS': { label: 'Por cobrar', color: '#d4943a', bg: '#fdf6ec' },
  'CLOSED': { label: 'Cerrada', color: '#a39e97', bg: '#f3efe9' },
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function VentasPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [tab, setTab] = useState<'resumen' | 'mesas' | 'cerradas'>('resumen')
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [viewMode, setViewMode] = useState<'dia' | 'mes' | 'comparar'>('dia')
  const [monthData, setMonthData] = useState<{ date: string; total: number; tickets: number }[]>([])
  const [monthSummary, setMonthSummary] = useState<{
    totalFacturado: number; totalTickets: number; activeDays: number; avgPerDay: number; avgTicket: number
    topProducts: { name: string; qty: number; revenue: number }[]
    topByRevenue: { name: string; qty: number; revenue: number }[]
  } | null>(null)
  const [loadingMonth, setLoadingMonth] = useState(false)
  const [hourlyByDow, setHourlyByDow] = useState<{ dow: number; hour: number; total: number; tickets: number }[]>([])
  const [dowFilter, setDowFilter] = useState<number | 'all'>('all')

  // Compare mode
  const [compareDate, setCompareDate] = useState<Date>(subDays(new Date(), 1))
  const [compareData, setCompareData] = useState<DashboardData | null>(null)
  const [loadingCompare, setLoadingCompare] = useState(false)

  const isLive = isToday(selectedDate)
  const dateStr = format(selectedDate, 'yyyy-MM-dd')

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setSyncing(true)
    try {
      const url = isLive ? '/api/fudo/auto-sync' : `/api/fudo/auto-sync?date=${dateStr}`
      const res = await fetch(url, { credentials: 'include' })
      const json = await res.json()
      if (json.today) {
        setData(json.today)
        setLastSync(json.lastSync)
      }
    } catch { /* ignore */ }
    setLoading(false)
    setSyncing(false)
  }, [dateStr, isLive])

  // Fetch month summary — single API call with top products
  const fetchMonth = useCallback(async () => {
    setLoadingMonth(true)
    try {
      const monthStr = format(selectedDate, 'yyyy-MM')
      const res = await fetch(`/api/fudo/monthly-summary?month=${monthStr}`, { credentials: 'include' })
      const json = await res.json()
      if (json.dailyData) {
        setMonthData(json.dailyData)
        setHourlyByDow(json.hourlyByDow ?? [])
        setMonthSummary({
          totalFacturado: json.totalFacturado ?? 0,
          totalTickets: json.totalTickets ?? 0,
          activeDays: json.activeDays ?? 0,
          avgPerDay: json.avgPerDay ?? 0,
          avgTicket: json.avgTicket ?? 0,
          topProducts: json.topProducts ?? [],
          topByRevenue: json.topByRevenue ?? [],
        })
      }
    } catch { /* ignore */ }
    setLoadingMonth(false)
  }, [selectedDate])

  useEffect(() => {
    if (profileLoading) return
    fetchData()
    if (isLive) {
      const interval = setInterval(() => fetchData(), REFRESH_INTERVAL)
      return () => clearInterval(interval)
    }
  }, [profileLoading, fetchData, isLive])

  useEffect(() => {
    if (viewMode === 'mes') fetchMonth()
  }, [viewMode, fetchMonth])

  // Fetch compare data
  const fetchCompare = useCallback(async () => {
    setLoadingCompare(true)
    try {
      const ds = format(compareDate, 'yyyy-MM-dd')
      const res = await fetch(`/api/fudo/auto-sync?date=${ds}`)
      const json = await res.json()
      setCompareData(json.today ?? null)
    } catch { setCompareData(null) }
    setLoadingCompare(false)
  }, [compareDate])

  useEffect(() => {
    if (viewMode === 'comparar') {
      fetchData()
      fetchCompare()
    }
  }, [viewMode, fetchCompare, fetchData])

  if (profileLoading || loading) return <LoadingState />

  if (!data) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Sin datos de ventas"
        description="Fudo no devolvió ventas. Verificá la conexión."
      />
    )
  }

  const formatPrice = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      {/* Header + Date Nav + View Toggle */}
      <FadeIn>
        {/* View mode toggle */}
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Ventas</h1>
          <div className="flex rounded-full bg-secondary p-0.5">
            {(['dia', 'comparar', 'mes'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${viewMode === mode ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'}`}
              >
                {mode === 'dia' ? 'Día' : mode === 'comparar' ? 'Comparar' : 'Mes'}
              </button>
            ))}
          </div>
        </div>

        {/* Date navigator — hidden in compare mode */}
        {viewMode !== 'comparar' && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => { setSelectedDate(prev => viewMode === 'mes' ? new Date(prev.getFullYear(), prev.getMonth() - 1, 1) : subDays(prev, 1)); setLoading(true) }}
            className="icon-btn flex items-center justify-center rounded-xl bg-secondary"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold capitalize text-[#3d2c24]">
              {viewMode === 'dia'
                ? format(selectedDate, "EEEE d 'de' MMMM", { locale: es })
                : format(selectedDate, "MMMM yyyy", { locale: es })
              }
            </p>
            {isLive && viewMode === 'dia' && (
              <p className="text-[10px] text-[#006d5a] font-semibold">
                En vivo {lastSync && `· ${format(new Date(lastSync), 'HH:mm')}`}
              </p>
            )}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => { setSelectedDate(prev => viewMode === 'mes' ? new Date(prev.getFullYear(), prev.getMonth() + 1, 1) : addDays(prev, 1)); setLoading(true) }}
              disabled={isLive && viewMode === 'dia'}
              className="icon-btn flex items-center justify-center rounded-xl bg-secondary disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
            {!isLive && viewMode === 'dia' && (
              <button
                onClick={() => { setSelectedDate(new Date()); setLoading(true) }}
                className="flex items-center gap-1 rounded-full bg-[#006d5a] px-2.5 py-1.5 text-[10px] font-bold text-white"
              >
                Hoy
              </button>
            )}
            {isLive && (
              <button
                onClick={() => fetchData(true)}
                disabled={syncing}
                className="icon-btn flex items-center justify-center rounded-xl bg-[#e8f5f1] disabled:opacity-50"
              >
                {syncing ? <Loader2 className="size-3.5 animate-spin text-[#006d5a]" /> : <RefreshCw className="size-3.5 text-[#006d5a]" />}
              </button>
            )}
          </div>
        </div>
        )}
      </FadeIn>

      {/* COMPARE VIEW */}
      {viewMode === 'comparar' && (
        <FadeIn>
          <div className="space-y-4">
            {/* Date pickers */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Día A</label>
                <input
                  type="date"
                  value={format(selectedDate, 'yyyy-MM-dd')}
                  onChange={(e) => { setSelectedDate(new Date(e.target.value + 'T12:00:00')); setLoading(true) }}
                  className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Día B</label>
                <input
                  type="date"
                  value={format(compareDate, 'yyyy-MM-dd')}
                  onChange={(e) => { setCompareDate(new Date(e.target.value + 'T12:00:00')); }}
                  className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                />
              </div>
            </div>

            {/* Fetch compare button */}
            <button
              onClick={() => { fetchData(); fetchCompare() }}
              disabled={loadingCompare}
              className="w-full rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-50"
            >
              {loadingCompare ? 'Cargando...' : 'Comparar'}
            </button>

            {/* Side by side comparison */}
            {data && compareData && !loadingCompare && (
              <div className="space-y-3">
                {/* Headers */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-[#e8f5f1] px-3 py-2 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#006d5a]">
                      {format(selectedDate, "EEE d MMM", { locale: es })}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#faf0e4] px-3 py-2 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8b5e34]">
                      {format(compareDate, "EEE d MMM", { locale: es })}
                    </p>
                  </div>
                </div>

                {/* Metrics comparison */}
                {([
                  { label: 'Facturado', keyA: data.totalFacturado, keyB: compareData.totalFacturado, format: true },
                  { label: 'Tickets', keyA: data.totalTickets, keyB: compareData.totalTickets, format: false },
                  { label: 'Ticket promedio', keyA: data.avgTicket, keyB: compareData.avgTicket, format: true },
                  { label: 'Items vendidos', keyA: data.totalItems, keyB: compareData.totalItems, format: false },
                  { label: 'Mesas cerradas', keyA: data.mesasCerradas, keyB: compareData.mesasCerradas, format: false },
                ] as const).map((row) => {
                  const diff = row.keyA - row.keyB
                  const pct = row.keyB > 0 ? Math.round((diff / row.keyB) * 100) : 0
                  const isUp = diff > 0
                  const isDown = diff < 0

                  return (
                    <div key={row.label} className="rounded-xl border bg-card p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97] mb-2">{row.label}</p>
                      <div className="grid grid-cols-3 items-end gap-2">
                        <div>
                          <p className="font-display text-lg font-bold tabular-nums text-[#006d5a]">
                            {row.format ? formatPrice(row.keyA) : row.keyA}
                          </p>
                        </div>
                        <div className="text-center">
                          {pct !== 0 ? (
                            <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              isUp ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#fef2f2] text-[#ea504c]'
                            }`}>
                              {isUp ? '↑' : '↓'} {Math.abs(pct)}%
                            </span>
                          ) : (
                            <span className="text-[11px] text-[#a39e97]">=</span>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-display text-lg font-bold tabular-nums text-[#8b5e34]">
                            {row.format ? formatPrice(row.keyB) : row.keyB}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* Top products comparison */}
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97] mb-2">Top 5 productos</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      {data.topProducts.slice(0, 5).map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="truncate text-[#3d2c24]">{p.name}</span>
                          <span className="ml-1 shrink-0 font-bold tabular-nums text-[#006d5a]">{p.qty}</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {compareData.topProducts.slice(0, 5).map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="truncate text-[#3d2c24]">{p.name}</span>
                          <span className="ml-1 shrink-0 font-bold tabular-nums text-[#8b5e34]">{p.qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Ventas por hora — día vs día */}
                {(data.byHour.length > 0 || compareData.byHour.length > 0) && (
                  <ChartCard
                    title="Ventas por hora"
                    subtitle={`${format(selectedDate, 'EEE d', { locale: es })} vs ${format(compareDate, 'EEE d', { locale: es })}`}
                  >
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart
                        data={(() => {
                          const map = new Map<string, { hour: string; a: number; b: number }>()
                          for (const h of data.byHour) {
                            map.set(h.hour, { hour: h.hour, a: h.revenue, b: 0 })
                          }
                          for (const h of compareData.byHour) {
                            const row = map.get(h.hour) ?? { hour: h.hour, a: 0, b: 0 }
                            row.b = h.revenue
                            map.set(h.hour, row)
                          }
                          return Array.from(map.values()).sort((x, y) => Number(x.hour) - Number(y.hour))
                        })()}
                        margin={{ left: -15, right: 8 }}
                      >
                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(v: any, name: any) => [formatPrice(v), name === 'a' ? format(selectedDate, 'EEE d', { locale: es }) : format(compareDate, 'EEE d', { locale: es })]}
                        />
                        <Bar dataKey="a" fill="#006d5a" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="b" fill="#8b5e34" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
              </div>
            )}

            {loadingCompare && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-6 animate-spin text-[#a39e97]" />
              </div>
            )}
          </div>
        </FadeIn>
      )}

      {/* MONTHLY VIEW */}
      {viewMode === 'mes' && (
        <FadeIn>
          {loadingMonth ? (
            <div className="space-y-2">
              <div className="h-8 animate-pulse rounded-lg bg-[#f3efe9]" />
              <div className="h-48 animate-pulse rounded-xl bg-[#f3efe9]" />
              <div className="h-32 animate-pulse rounded-xl bg-[#f3efe9]" />
            </div>
          ) : monthSummary ? (
            <div className="space-y-4">
              {/* Monthly KPIs */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[#e8f5f1] p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#006d5a' }}>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">Total mes</p>
                  <p className="mt-1 font-display text-xl font-bold text-[#006d5a]">{formatPrice(monthSummary.totalFacturado)}</p>
                </div>
                <div className="rounded-xl bg-[#faf0e4] p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#8b5e34' }}>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#8b5e34]">Tickets</p>
                  <p className="mt-1 font-display text-xl font-bold text-[#8b5e34]">{monthSummary.totalTickets}</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[#f8f5f0] px-4 py-2.5">
                <div className="flex items-center gap-4 text-xs text-[#3d2c24]">
                  <span>Prom/día <strong className="tabular-nums">{formatPrice(monthSummary.avgPerDay)}</strong></span>
                  <span className="text-[#ebe6df]">|</span>
                  <span>Ticket prom <strong className="tabular-nums">{formatPrice(monthSummary.avgTicket)}</strong></span>
                  <span className="text-[#ebe6df]">|</span>
                  <span>{monthSummary.activeDays} días activos</span>
                </div>
              </div>

              {/* Daily chart */}
              <ChartCard title="Facturado por día" subtitle={format(selectedDate, "MMMM yyyy", { locale: es })}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthData.map(d => ({ ...d, label: format(new Date(d.date + 'T12:00:00'), 'd', { locale: es }) }))}>
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 11 }}
                      formatter={(v: number) => [formatPrice(v), 'Facturado']}
                      labelFormatter={(l) => `Día ${l}`}
                    />
                    <Bar dataKey="total" fill="#006d5a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* ¿A qué hora vendemos más? — por hora, comparable entre días de semana */}
              {hourlyByDow.length > 0 && (
                <ChartCard
                  title="¿A qué hora vendemos más?"
                  subtitle={dowFilter === 'all' ? 'Todo el mes, por hora' : `Solo los ${['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'][dowFilter]}`}
                >
                  <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-none">
                    {([['all', 'Todos'], [1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [0, 'Dom']] as const).map(([value, label]) => (
                      <button
                        key={String(value)}
                        onClick={() => setDowFilter(value as number | 'all')}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all ${
                          dowFilter === value ? 'bg-[#3d2c24] text-white' : 'bg-[#f3efe9] text-[#a39e97]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={(() => {
                        const byHour = new Map<number, { total: number; tickets: number }>()
                        for (const row of hourlyByDow) {
                          if (dowFilter !== 'all' && row.dow !== dowFilter) continue
                          const entry = byHour.get(row.hour) ?? { total: 0, tickets: 0 }
                          entry.total += row.total
                          entry.tickets += row.tickets
                          byHour.set(row.hour, entry)
                        }
                        return Array.from(byHour.entries())
                          .map(([hour, v]) => ({ hour: `${hour}`, ...v }))
                          .sort((a, b) => Number(a.hour) - Number(b.hour))
                      })()}
                      margin={{ left: -15, right: 8 }}
                    >
                      <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={(v: any, name: any) => name === 'total' ? [formatPrice(v), 'Facturado'] : [v, 'Tickets']}
                        labelFormatter={(l) => `${l}:00 hs`}
                      />
                      <Bar dataKey="total" fill="#006d5a" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}

              {/* TOP PRODUCTS — by quantity */}
              {monthSummary.topProducts.length > 0 && (
                <div className="rounded-2xl border bg-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Trophy className="size-4 text-[#d4943a]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#3d2c24]">
                      Más vendidos del mes
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {monthSummary.topProducts.slice(0, 15).map((p, i) => {
                      const maxQty = monthSummary.topProducts[0]?.qty ?? 1
                      const pct = Math.round((p.qty / maxQty) * 100)
                      return (
                        <div key={i} className="relative overflow-hidden rounded-lg">
                          {/* Bar background */}
                          <div
                            className="absolute inset-y-0 left-0 rounded-lg bg-[#e8f5f1]"
                            style={{ width: `${pct}%` }}
                          />
                          <div className="relative flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-bold tabular-nums text-[#a39e97] w-5 text-right shrink-0">
                                {i + 1}
                              </span>
                              <span className="text-sm font-medium text-[#3d2c24] truncate">{p.name}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-sm font-bold tabular-nums text-[#006d5a]">{p.qty}</span>
                              <span className="text-[10px] tabular-nums text-[#a39e97]">{formatPrice(p.revenue)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* TOP BY REVENUE */}
              {monthSummary.topByRevenue.length > 0 && (
                <div className="rounded-2xl border bg-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <DollarSign className="size-4 text-[#006d5a]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#3d2c24]">
                      Mayor facturación del mes
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {monthSummary.topByRevenue.slice(0, 10).map((p, i) => {
                      const maxRev = monthSummary.topByRevenue[0]?.revenue ?? 1
                      const pct = Math.round((p.revenue / maxRev) * 100)
                      return (
                        <div key={i} className="relative overflow-hidden rounded-lg">
                          <div
                            className="absolute inset-y-0 left-0 rounded-lg bg-[#fdf6ec]"
                            style={{ width: `${pct}%` }}
                          />
                          <div className="relative flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-bold tabular-nums text-[#a39e97] w-5 text-right shrink-0">
                                {i + 1}
                              </span>
                              <span className="text-sm font-medium text-[#3d2c24] truncate">{p.name}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-sm font-bold tabular-nums text-[#8b5e34]">{formatPrice(p.revenue)}</span>
                              <span className="text-[10px] tabular-nums text-[#a39e97]">{p.qty}u</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Daily list */}
              <div className="space-y-1">
                <span className="section-label">Detalle por día</span>
                {[...monthData].reverse().filter(d => d.total > 0).map(d => (
                  <button
                    key={d.date}
                    onClick={() => { setSelectedDate(new Date(d.date + 'T12:00:00')); setViewMode('dia'); setLoading(true) }}
                    className="flex w-full items-center justify-between rounded-xl bg-card border px-4 py-2.5 text-left hover:bg-[#faf8f5] transition-colors"
                  >
                    <div>
                      <p className="text-xs font-semibold capitalize text-[#3d2c24]">
                        {format(new Date(d.date + 'T12:00:00'), "EEE d 'de' MMM", { locale: es })}
                      </p>
                      <p className="text-[10px] text-[#a39e97]">{d.tickets} tickets</p>
                    </div>
                    <p className="font-display text-sm font-bold tabular-nums text-[#006d5a]">{formatPrice(d.total)}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState icon={CalendarDays} title="Sin datos del mes" description="No hay ventas registradas para este período." />
          )}
        </FadeIn>
      )}

      {/* DAILY VIEW */}
      {viewMode === 'dia' && <>
      {/* KPIs — 2 primary + secondary row */}
      <div className="space-y-2.5">
        <StaggerList className="grid grid-cols-2 gap-2.5" staggerDelay={0.04}>
          <StaggerItem>
            <div className="card-elevated rounded-xl p-4" style={{ borderLeftWidth: 3, borderLeftColor: '#006d5a' }}>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Facturado</span>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[#006d5a]">
                {formatPrice(data.totalFacturado)}
              </p>
              <p className="text-[10px] text-[#a39e97]">{data.mesasCerradas} cerradas</p>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="card-elevated rounded-xl p-4" style={{ borderLeftWidth: 3, borderLeftColor: '#d4943a' }}>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">En curso</span>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[#d4943a]">
                {formatPrice(data.totalEnCurso)}
              </p>
              <p className="text-[10px] text-[#a39e97]">
                {data.mesasAbiertas} mesa{data.mesasAbiertas !== 1 ? 's' : ''}
                {(data.takeawayAbiertos ?? 0) > 0 && ` · ${data.takeawayAbiertos} takeaway`}
              </p>
            </div>
          </StaggerItem>
        </StaggerList>
        {/* Secondary metrics — inline */}
        <div className="flex items-center justify-between rounded-xl bg-[#f8f5f0] px-4 py-2.5">
          <div className="flex items-center gap-4 text-xs text-[#3d2c24]">
            <span>Total <strong className="tabular-nums">{formatPrice(data.totalGeneral)}</strong></span>
            <span className="text-[#ebe6df]">|</span>
            <span>{data.totalTickets} tickets</span>
            <span className="text-[#ebe6df]">|</span>
            <span>Prom. <strong className="tabular-nums">{formatPrice(data.avgTicket)}</strong></span>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex rounded-full bg-secondary p-0.5">
        {([
          { key: 'resumen', label: 'Resumen', icon: FileText },
          { key: 'mesas', label: `En curso (${data.totalAbiertas})`, icon: UtensilsCrossed },
          { key: 'cerradas', label: `Cerradas (${data.mesasCerradas})`, icon: CheckCircle },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-[11px] font-semibold transition-colors ${
              tab === t.key ? 'bg-[#006d5a] text-white' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ================================================================= */}
      {/* TAB: RESUMEN                                                      */}
      {/* ================================================================= */}
      {tab === 'resumen' && (
        <>
          {/* Informe del día */}
          {data.topProducts.length > 0 && (
            <FadeIn>
              <div className="rounded-2xl border border-[#ebe6df] bg-gradient-to-br from-[#f8f5f0] to-white p-5 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[#006d5a]">
                    <FileText className="size-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold text-[#3d2c24]">Informe del Día</h2>
                    <p className="text-[11px] text-[#a39e97]">Datos en vivo de Fudo</p>
                  </div>
                </div>

                {/* Texto resumen */}
                <div className="rounded-xl bg-white/80 p-4 text-[13px] leading-relaxed text-[#3d2c24]">
                  <p>
                    Facturado (cerradas): <strong className="text-[#006d5a]">{formatPrice(data.totalFacturado)}</strong>.
                    En curso: <strong className="text-[#d4943a]">{formatPrice(data.totalEnCurso)}</strong> en {data.mesasAbiertas} mesas.
                  </p>
                  {(() => {
                    const peak = data.byHour.reduce((max, h) => h.revenue > max.revenue ? h : max, data.byHour[0])
                    return peak && peak.revenue > 0 ? (
                      <p className="mt-1.5">
                        Hora pico: <strong>{peak.hour}</strong> con {formatPrice(peak.revenue)} en {peak.tickets} tickets.
                      </p>
                    ) : null
                  })()}
                </div>

                {/* Top 5 */}
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#a39e97]">
                    <Trophy className="size-3.5 text-[#d4943a]" />
                    Lo más vendido hoy
                  </p>
                  <div className="space-y-1.5">
                    {data.topProducts.slice(0, 5).map((p, i) => {
                      const medals = ['🥇', '🥈', '🥉']
                      const pct = data.totalItems > 0 ? Math.round((p.qty / data.totalItems) * 100) : 0
                      return (
                        <div key={p.name} className="flex items-center gap-3 rounded-xl bg-white/80 px-3.5 py-2.5">
                          <span className="text-xl">{medals[i] ?? `${i + 1}.`}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{p.name}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-[#ebe6df]">
                                <div
                                  className="h-1.5 rounded-full bg-[#006d5a] transition-all"
                                  style={{ width: `${Math.min(pct * 2, 100)}%` }}
                                />
                              </div>
                              <span className="shrink-0 text-[10px] font-bold tabular-nums text-[#a39e97]">
                                {p.qty} · {pct}%
                              </span>
                            </div>
                          </div>
                          <span className="shrink-0 text-[13px] font-bold tabular-nums text-[#006d5a]">
                            {formatPrice(p.revenue)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Insights */}
                {(() => {
                  const insights: { icon: typeof Flame; text: string; color: string }[] = []
                  if (data.topProducts[0]) {
                    insights.push({ icon: Star, text: `${data.topProducts[0].name} lidera con ${data.topProducts[0].qty} vendidos`, color: '#d4943a' })
                  }
                  const peak = data.byHour.reduce((max, h) => h.tickets > max.tickets ? h : max, data.byHour[0])
                  if (peak && peak.tickets > 2) {
                    insights.push({ icon: Flame, text: `Hora más activa: ${peak.hour} con ${peak.tickets} tickets`, color: '#ea504c' })
                  }
                  if (data.totalTickets > 0) {
                    insights.push({ icon: ShoppingBag, text: `Promedio ${(data.totalItems / data.totalTickets).toFixed(1)} items por ticket`, color: '#006d5a' })
                  }
                  return insights.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#a39e97]">
                        <Flame className="size-3.5 text-[#ea504c]" /> Insights
                      </p>
                      {insights.map((ins, i) => (
                        <div key={i} className="flex items-center gap-2.5 rounded-lg bg-white/80 px-3 py-2">
                          <ins.icon className="size-3.5 shrink-0" style={{ color: ins.color }} />
                          <p className="text-[12px] text-[#3d2c24]">{ins.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : null
                })()}
              </div>
            </FadeIn>
          )}

          {/* Ventas por hora */}
          {data.byHour.length > 0 && (
            <FadeIn delay={0.1}>
              <ChartCard title="Ventas por hora" subtitle="Facturación durante el día">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.byHour} margin={{ left: -15, right: 8 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => [formatPrice(v), 'Facturación']}
                    />
                    <Bar dataKey="revenue" fill="#006d5a" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </FadeIn>
          )}

          {/* Tipo de venta pie */}
          {(data.bySaleType?.length ?? 0) > 0 && (
            <FadeIn delay={0.15}>
              <ChartCard title="Tipo de venta" subtitle="En local vs Para llevar">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={data.bySaleType} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="revenue" nameKey="name">
                      {data.bySaleType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Legend formatter={(value) => <span className="text-xs text-[#3d2c24]">{value}</span>} iconType="circle" iconSize={8} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }} // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => [formatPrice(v), '']} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </FadeIn>
          )}

          {/* Top 6-15 */}
          {data.topProducts.length > 5 && (
            <FadeIn delay={0.2}>
              <div className="space-y-2">
                <span className="section-label">Más vendidos (6-15)</span>
                <div className="space-y-1">
                  {data.topProducts.slice(5).map((p, i) => (
                    <div key={p.name} className="card-elevated flex items-center gap-3 rounded-xl px-4 py-2.5">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#f3efe9] text-[10px] font-bold text-[#a39e97]">{i + 6}</span>
                      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#3d2c24]">{p.name}</p>
                      <span className="shrink-0 text-[11px] font-bold tabular-nums text-[#a39e97]">{p.qty}x</span>
                      <span className="shrink-0 text-[12px] font-bold tabular-nums text-[#006d5a]">{formatPrice(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* TAB: MESAS EN CURSO                                               */}
      {/* ================================================================= */}
      {tab === 'mesas' && (
        <FadeIn>
          <div className="space-y-2">
            {data.openTables.length === 0 && data.openTakeaway.length === 0 ? (
              <EmptyState icon={UtensilsCrossed} title="Sin pedidos en curso" description="No hay mesas ni pedidos abiertos en este momento." />
            ) : (
              <>
              {/* Takeaway section */}
              {data.openTakeaway.length > 0 && (
                <>
                  <p className="section-label px-1">Para llevar / Delivery ({data.openTakeaway.length})</p>
                  {data.openTakeaway.map((ticket) => {
                    const stateInfo = STATE_LABELS[ticket.state] ?? STATE_LABELS['IN-COURSE']
                    return (
                      <div key={ticket.ticketId} className="card-elevated rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3" style={{ borderLeftWidth: 4, borderLeftColor: '#8b5e34' }}>
                          <div className="flex items-center gap-2.5">
                            <div className="flex size-9 items-center justify-center rounded-lg bg-[#faf0e4]">
                              <ShoppingBag className="size-4 text-[#8b5e34]" />
                            </div>
                            <div>
                              <p className="text-[13px] font-semibold text-[#3d2c24]">
                                {ticket.saleType === 'TAKEAWAY' ? 'Para llevar' : 'Delivery'} #{ticket.ticketId}
                              </p>
                              <div className="flex items-center gap-2">
                                <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ backgroundColor: stateInfo.bg, color: stateInfo.color }}>
                                  {stateInfo.label}
                                </span>
                                <span className="text-[10px] text-[#a39e97]">{format(new Date(ticket.time), 'HH:mm')}</span>
                              </div>
                            </div>
                          </div>
                          <p className="text-base font-bold tabular-nums text-[#3d2c24]">{formatPrice(ticket.total)}</p>
                        </div>
                        {ticket.items.length > 0 && (
                          <div className="border-t border-border/30 px-4 py-2.5 space-y-1">
                            {ticket.items.map((item, j) => (
                              <div key={j} className="flex items-center justify-between text-[12px]">
                                <span className="text-[#3d2c24]"><span className="font-semibold text-[#006d5a]">{item.qty}x</span> {item.name}</span>
                                <span className="tabular-nums text-[#a39e97]">{formatPrice(item.price)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
              {/* Mesas section */}
              {data.openTables.length > 0 && (
                <>
                  <p className="section-label px-1">Mesas en local ({data.openTables.length})</p>
              {data.openTables
                .sort((a, b) => (a.tableNumber ?? 999) - (b.tableNumber ?? 999))
                .map((ticket) => {
                  const stateInfo = STATE_LABELS[ticket.state] ?? STATE_LABELS['IN-COURSE']
                  return (
                    <div key={ticket.ticketId} className="card-elevated rounded-xl overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3" style={{ borderLeftWidth: 4, borderLeftColor: stateInfo.color }}>
                        <div className="flex items-center gap-2.5">
                          <div className="flex size-9 items-center justify-center rounded-lg bg-[#f8f5f0]">
                            <span className="text-sm font-bold text-[#3d2c24]">
                              {ticket.tableNumber ?? '—'}
                            </span>
                          </div>
                          <div>
                            <p className="text-[13px] font-semibold text-[#3d2c24]">
                              Mesa {ticket.tableNumber ?? ticket.ticketId}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ backgroundColor: stateInfo.bg, color: stateInfo.color }}>
                                {stateInfo.label}
                              </span>
                              <span className="text-[10px] text-[#a39e97]">
                                {format(new Date(ticket.time), 'HH:mm')}
                              </span>
                            </div>
                          </div>
                        </div>
                        <p className="text-base font-bold tabular-nums text-[#3d2c24]">
                          {formatPrice(ticket.total)}
                        </p>
                      </div>
                      {/* Items */}
                      {ticket.items.length > 0 && (
                        <div className="border-t border-border/30 px-4 py-2.5 space-y-1">
                          {ticket.items.map((item, j) => (
                            <div key={j} className="flex items-center justify-between text-[12px]">
                              <span className="text-[#3d2c24]">
                                <span className="font-semibold text-[#006d5a]">{item.qty}x</span> {item.name}
                              </span>
                              <span className="tabular-nums text-[#a39e97]">{formatPrice(item.price)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              }
                </>
              )}
              </>
            )}
          </div>
        </FadeIn>
      )}

      {/* ================================================================= */}
      {/* TAB: CERRADAS                                                     */}
      {/* ================================================================= */}
      {tab === 'cerradas' && (
        <FadeIn>
          <div className="space-y-2">
            {data.recentSales.length === 0 ? (
              <EmptyState icon={CheckCircle} title="Sin mesas cerradas" description="Las mesas cerradas aparecerán acá." />
            ) : (
              data.recentSales.map((ticket) => (
                <div key={ticket.ticketId} className="card-elevated rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderLeftWidth: 4, borderLeftColor: '#a39e97' }}>
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-[#f3efe9]">
                        <span className="text-sm font-bold text-[#a39e97]">
                          {ticket.tableNumber ?? '—'}
                        </span>
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-[#3d2c24]">
                          Mesa {ticket.tableNumber ?? ticket.ticketId}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-[#f3efe9] px-2 py-0.5 text-[9px] font-bold text-[#a39e97]">
                            Cerrada
                          </span>
                          <span className="text-[10px] text-[#a39e97]">
                            {ticket.closedAt ? format(new Date(ticket.closedAt), 'HH:mm') : format(new Date(ticket.time), 'HH:mm')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-base font-bold tabular-nums text-[#006d5a]">
                      {formatPrice(ticket.total)}
                    </p>
                  </div>
                  {ticket.items.length > 0 && (
                    <div className="border-t border-border/30 px-4 py-2.5 space-y-1">
                      {ticket.items.map((item, j) => (
                        <div key={j} className="flex items-center justify-between text-[12px]">
                          <span className="text-[#3d2c24]">
                            <span className="font-semibold text-[#006d5a]">{item.qty}x</span> {item.name}
                          </span>
                          <span className="tabular-nums text-[#a39e97]">{formatPrice(item.price)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </FadeIn>
      )}

      {/* Empty fallback */}
      {data.totalTickets === 0 && tab === 'resumen' && (
        <EmptyState
          icon={Receipt}
          title={isLive ? 'Sin ventas hoy' : `Sin ventas el ${format(selectedDate, "d 'de' MMMM", { locale: es })}`}
          description={isLive ? 'Cuando se abran mesas en Fudo, aparecerán acá en tiempo real.' : 'No se registraron ventas este día.'}
        />
      )}
      </>}
    </div>
  )
}
