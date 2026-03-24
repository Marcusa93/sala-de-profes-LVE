'use client'

import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  DollarSign, ShoppingBag, Receipt, TrendingUp, Clock,
  RefreshCw, Loader2, BarChart3, PieChart as PieChartIcon,
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

type DashboardData = {
  totalRevenue: number
  totalItems: number
  uniqueTickets: number
  avgTicket: number
  topProducts: { name: string; qty: number; revenue: number }[]
  bySaleType: { name: string; tickets: number; revenue: number }[]
  byHour: { hour: string; tickets: number; revenue: number; items: number }[]
  recentSales: {
    ticketId: string
    time: string
    saleType: string
    items: { name: string; qty: number; price: number }[]
    total: number
  }[]
}

const PIE_COLORS = ['#006d5a', '#8b5e34', '#d4943a', '#4a90d9', '#c67b4b', '#2d7d6a', '#ea504c', '#a39e97']

const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function VentasPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [newSales, setNewSales] = useState(0)
  const [syncError, setSyncError] = useState<string | null>(null)

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setSyncing(true)
    try {
      const res = await fetch('/api/fudo/auto-sync')
      const json = await res.json()
      if (json.today) {
        setData(json.today)
        setLastSync(json.lastSync)
        setNewSales(json.synced ?? 0)
        setSyncError(json.syncError ?? null)
      }
    } catch { /* ignore */ }
    setLoading(false)
    setSyncing(false)
  }, [])

  // Initial fetch + auto-refresh every 5 min
  useEffect(() => {
    if (profileLoading) return
    fetchData()
    const interval = setInterval(() => fetchData(), REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [profileLoading, fetchData])

  if (profileLoading || loading) return <LoadingState />

  if (!data) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Sin datos de ventas"
        description="Fudo no devolvió ventas. Verificá la conexión o esperá a que se cierren tickets."
      />
    )
  }

  const formatPrice = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-28">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-[#3d2c24]">Ventas del Día</h1>
            <p className="section-label mt-0.5 capitalize">
              {format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
            </p>
          </div>
          <button
            onClick={() => fetchData(true)}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-full bg-[#e8f5f1] px-3 py-1.5 text-[11px] font-bold text-[#006d5a] transition-all hover:bg-[#c0e4da] active:scale-95 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Sincronizar
          </button>
        </div>
        {lastSync && (
          <p className="mt-1 text-[10px] text-[#a39e97]">
            Última sync: {format(new Date(lastSync), 'HH:mm:ss')}
            {newSales > 0 && <span className="ml-1 font-bold text-[#006d5a]">+{newSales} nuevas</span>}
            {syncError && <span className="ml-1 font-bold text-[#d4943a]">⚠ {syncError}</span>}
            {' · '}Auto-refresh cada 5 min
          </p>
        )}
      </FadeIn>

      {/* KPIs */}
      <StaggerList className="grid grid-cols-3 gap-2.5" staggerDelay={0.04}>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-3">
            <div className="flex items-center gap-1.5">
              <div className="flex size-6 items-center justify-center rounded-md bg-[#e8f5f1]">
                <DollarSign className="size-3 text-[#006d5a]" />
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Facturado</span>
            </div>
            <p className="mt-2 font-display text-xl font-bold tabular-nums text-[#006d5a]">
              {formatPrice(data.totalRevenue)}
            </p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-3">
            <div className="flex items-center gap-1.5">
              <div className="flex size-6 items-center justify-center rounded-md bg-[#faf0e4]">
                <Receipt className="size-3 text-[#8b5e34]" />
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Tickets</span>
            </div>
            <p className="mt-2 font-display text-xl font-bold tabular-nums text-[#3d2c24]">
              <AnimatedNumber value={data.uniqueTickets} />
            </p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-3">
            <div className="flex items-center gap-1.5">
              <div className="flex size-6 items-center justify-center rounded-md bg-[#fdf6ec]">
                <ShoppingBag className="size-3 text-[#d4943a]" />
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Items</span>
            </div>
            <p className="mt-2 font-display text-xl font-bold tabular-nums text-[#3d2c24]">
              <AnimatedNumber value={data.totalItems} />
            </p>
          </div>
        </StaggerItem>
      </StaggerList>

      {/* Ticket promedio */}
      {data.uniqueTickets > 0 && (
        <FadeIn delay={0.1}>
          <div className="card-elevated flex items-center gap-3 rounded-xl px-4 py-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#f0f7f5]">
              <TrendingUp className="size-4 text-[#006d5a]" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#a39e97]">Ticket promedio</p>
              <p className="font-display text-lg font-bold text-[#3d2c24]">
                {formatPrice(data.avgTicket || (data.totalRevenue / data.uniqueTickets))}
              </p>
            </div>
          </div>
        </FadeIn>
      )}

      {/* Ventas por hora */}
      {data.byHour.length > 0 && (
        <FadeIn delay={0.15}>
          <ChartCard title="Ventas por hora" subtitle="Facturación durante el día">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.byHour} margin={{ left: -15, right: 8 }}>
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                  formatter={(v: number) => [formatPrice(v), 'Facturación']}
                />
                <Bar dataKey="revenue" fill="#006d5a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </FadeIn>
      )}

      {/* Top productos */}
      {data.topProducts.length > 0 && (
        <FadeIn delay={0.2}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <TrendingUp className="size-4 text-[#006d5a]" />
              <span className="text-sm font-semibold text-[#3d2c24]">Lo más vendido</span>
            </div>
            <div className="space-y-1">
              {data.topProducts.map((p, i) => (
                <div
                  key={p.name}
                  className="card-elevated flex items-center gap-3 rounded-xl px-4 py-2.5"
                >
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    i === 0 ? 'bg-[#d4943a] text-white' : i === 1 ? 'bg-[#a39e97] text-white' : i === 2 ? 'bg-[#c67b4b] text-white' : 'bg-[#f3efe9] text-[#a39e97]'
                  }`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#3d2c24]">{p.name}</p>
                    <p className="text-[10px] text-[#a39e97]">{p.qty} vendidos</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-[#006d5a]">
                    {formatPrice(p.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      )}

      {/* Por tipo de venta — pie chart */}
      {(data.bySaleType?.length ?? 0) > 0 && (
        <FadeIn delay={0.25}>
          <ChartCard title="Tipo de venta" subtitle="En local vs Para llevar vs Delivery">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.bySaleType}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="revenue"
                  nameKey="name"
                >
                  {data.bySaleType.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend
                  formatter={(value) => <span className="text-xs text-[#3d2c24]">{value}</span>}
                  iconType="circle"
                  iconSize={8}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                  formatter={(v: number) => [formatPrice(v), 'Ventas']}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </FadeIn>
      )}

      {/* Últimas ventas */}
      {data.recentSales.length > 0 && (
        <FadeIn delay={0.3}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <Clock className="size-4 text-[#8b5e34]" />
              <span className="text-sm font-semibold text-[#3d2c24]">Últimos tickets</span>
            </div>
            <div className="space-y-1.5">
              {data.recentSales.map((ticket) => (
                <div key={ticket.ticketId} className="card-elevated rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-[#a39e97]">
                        <Clock className="mr-1 inline size-3" />
                        {ticket.time ? format(new Date(ticket.time), 'HH:mm') : '--'}
                      </span>
                      {ticket.saleType && (
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                          ticket.saleType === 'EAT-IN' ? 'bg-[#e8f5f1] text-[#006d5a]' :
                          ticket.saleType === 'TAKEAWAY' ? 'bg-[#fdf6ec] text-[#d4943a]' :
                          'bg-[#eef4fc] text-[#4a90d9]'
                        }`}>
                          {ticket.saleType === 'EAT-IN' ? 'Local' : ticket.saleType === 'TAKEAWAY' ? 'Llevar' : ticket.saleType}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold tabular-nums text-[#006d5a]">
                      {formatPrice(ticket.total)}
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    {ticket.items.map((item, j) => (
                      <p key={j} className="text-xs text-[#3d2c24]">
                        <span className="font-medium">{item.qty}x</span> {item.name}
                        <span className="ml-1 text-[#a39e97]">{formatPrice(item.price * item.qty)}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      )}

      {/* Empty state */}
      {data.totalItems === 0 && (
        <EmptyState
          icon={Receipt}
          title="Sin ventas hoy"
          description="Cuando se cierren tickets en Fudo, las ventas aparecerán acá automáticamente."
        />
      )}
    </div>
  )
}
