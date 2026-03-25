'use client'

import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  DollarSign, ShoppingBag, Receipt, TrendingUp, Clock,
  RefreshCw, Loader2, BarChart3, FileText, Trophy, Flame, Star,
  UtensilsCrossed, CircleDot, CheckCircle, Timer,
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
  mesasCerradas: number
  topProducts: { name: string; qty: number; revenue: number }[]
  bySaleType: { name: string; tickets: number; revenue: number }[]
  byHour: { hour: string; tickets: number; revenue: number; items: number }[]
  openTables: Ticket[]
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

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setSyncing(true)
    try {
      const res = await fetch('/api/fudo/auto-sync')
      const json = await res.json()
      if (json.today) {
        setData(json.today)
        setLastSync(json.lastSync)
      }
    } catch { /* ignore */ }
    setLoading(false)
    setSyncing(false)
  }, [])

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
        description="Fudo no devolvió ventas. Verificá la conexión."
      />
    )
  }

  const formatPrice = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
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
            Sync
          </button>
        </div>
        {lastSync && (
          <p className="mt-1 text-[10px] text-[#a39e97]">
            Datos en vivo de Fudo · {format(new Date(lastSync), 'HH:mm')} · Auto-refresh 5 min
          </p>
        )}
      </FadeIn>

      {/* KPIs — 2x2 grid */}
      <StaggerList className="grid grid-cols-2 gap-2.5" staggerDelay={0.04}>
        <StaggerItem>
          <div className="kpi-card card-elevated rounded-xl p-4">
            <div className="flex items-center gap-1.5">
              <div className="flex size-6 items-center justify-center rounded-md bg-[#e8f5f1]">
                <CheckCircle className="size-3 text-[#006d5a]" />
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Facturado</span>
            </div>
            <p className="mt-1.5 font-display text-xl font-bold tabular-nums text-[#006d5a]">
              {formatPrice(data.totalFacturado)}
            </p>
            <p className="text-[10px] text-[#a39e97]">{data.mesasCerradas} mesas cerradas</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="kpi-card card-elevated rounded-xl p-4">
            <div className="flex items-center gap-1.5">
              <div className="flex size-6 items-center justify-center rounded-md bg-[#fdf6ec]">
                <CircleDot className="size-3 text-[#d4943a]" />
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">En curso</span>
            </div>
            <p className="mt-1.5 font-display text-xl font-bold tabular-nums text-[#d4943a]">
              {formatPrice(data.totalEnCurso)}
            </p>
            <p className="text-[10px] text-[#a39e97]">{data.mesasAbiertas} mesas abiertas</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="kpi-card card-elevated rounded-xl p-4">
            <div className="flex items-center gap-1.5">
              <div className="flex size-6 items-center justify-center rounded-md bg-[#faf0e4]">
                <Receipt className="size-3 text-[#8b5e34]" />
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Total día</span>
            </div>
            <p className="mt-1.5 font-display text-xl font-bold tabular-nums text-[#3d2c24]">
              {formatPrice(data.totalGeneral)}
            </p>
            <p className="text-[10px] text-[#a39e97]">{data.totalTickets} tickets · {data.totalItems} items</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="kpi-card card-elevated rounded-xl p-4">
            <div className="flex items-center gap-1.5">
              <div className="flex size-6 items-center justify-center rounded-md bg-[#f0f7f5]">
                <TrendingUp className="size-3 text-[#006d5a]" />
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Ticket prom.</span>
            </div>
            <p className="mt-1.5 font-display text-xl font-bold tabular-nums text-[#3d2c24]">
              {formatPrice(data.avgTicket)}
            </p>
            <p className="text-[10px] text-[#a39e97]">{(data.totalItems / Math.max(data.totalTickets, 1)).toFixed(1)} items/ticket</p>
          </div>
        </StaggerItem>
      </StaggerList>

      {/* Tab navigation */}
      <div className="flex rounded-full bg-secondary p-0.5">
        {([
          { key: 'resumen', label: 'Resumen', icon: FileText },
          { key: 'mesas', label: `Mesas (${data.mesasAbiertas})`, icon: UtensilsCrossed },
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
            {data.openTables.length === 0 ? (
              <EmptyState icon={UtensilsCrossed} title="Sin mesas abiertas" description="No hay mesas en curso en este momento." />
            ) : (
              data.openTables
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
          title="Sin ventas hoy"
          description="Cuando se abran mesas en Fudo, aparecerán acá en tiempo real."
        />
      )}
    </div>
  )
}
