'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  TrendingUp, AlertTriangle, CheckCircle2, Clock, ChefHat,
  Package, Leaf, BarChart3, ChevronRight, RefreshCw, GitBranch,
} from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardData = {
  period_days: number
  total_completed: number
  total_input_kg: number | null
  total_waste_kg: number | null
  avg_efficiency_pct: number | null
  pending_orders: number
  by_chef: {
    chef_id: string | null
    chef_name: string
    total_orders: number
    avg_efficiency: number | null
    total_waste: number
  }[]
  daily: {
    day: string
    orders: number
    avg_efficiency: number | null
  }[]
}

type OrderRow = {
  id: number
  name: string
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled'
  parent_order_id: number | null
  template_name: string | null
  chef_name: string | null
  created_at: string
  completed_at: string | null
  summary: {
    total_input_qty: number
    total_output_qty: number
    total_waste_qty: number
    efficiency_pct: number | null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function effColor(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground'
  if (pct >= 90) return 'text-[#006d5a]'
  if (pct >= 75) return 'text-[#d4943a]'
  return 'text-[#ea504c]'
}

function effBg(pct: number | null): string {
  if (pct === null) return 'bg-[#f5f2ee]'
  if (pct >= 90) return 'bg-[#e8f5f1]'
  if (pct >= 75) return 'bg-amber-50'
  return 'bg-red-50'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatKg(v: number | null) {
  if (v === null) return '—'
  return v >= 1 ? `${v.toFixed(2)} kg` : `${(v * 1000).toFixed(0)} g`
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  label, value, unit, sub, color = 'text-[#3d2c24]',
}: { label: string; value: number | null; unit?: string; sub?: string; color?: string }) {
  return (
    <div className="flex-1 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-[22px] font-bold leading-none', color)}>
        {value !== null
          ? <><AnimatedNumber value={value} decimals={value % 1 !== 0 ? 1 : 0} />{unit && <span className="ml-0.5 text-[14px] font-medium">{unit}</span>}</>
          : '—'}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Efficiency bar
// ---------------------------------------------------------------------------

function EffBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground text-[13px]">—</span>
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-[#f5f2ee]">
        <div
          className={cn('h-1.5 rounded-full', pct >= 90 ? 'bg-[#006d5a]' : pct >= 75 ? 'bg-[#d4943a]' : 'bg-[#ea504c]')}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={cn('text-[13px] font-bold', effColor(pct))}>{pct}%</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ProduccionDashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(30)
  const [tab, setTab] = useState<'resumen' | 'historial' | 'chefs'>('resumen')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [dashRes, ordersRes] = await Promise.all([
        fetch(`/api/produccion/dashboard?days=${period}`),
        fetch(`/api/produccion/orders?days=${period}&status=all`),
      ])
      if (dashRes.ok) setDashboard(await dashRes.json())
      if (ordersRes.ok) setOrders((await ordersRes.json()).orders ?? [])
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  const completedOrders = orders.filter((o) => o.status === 'completed')
  const pendingOrders   = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled')

  return (
    <div className="min-h-screen bg-[#faf8f5] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#ebe6df] bg-[#faf8f5]/95 backdrop-blur-md">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#006d5a]/10">
                <BarChart3 className="size-4 text-[#006d5a]" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="text-[15px] font-semibold text-[#3d2c24]">Control de Producción</h1>
                <p className="text-[11px] text-muted-foreground">Rendimientos y mermas</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
                className="rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-[12px] focus:outline-none"
              >
                <option value={7}>7 días</option>
                <option value={30}>30 días</option>
                <option value={90}>90 días</option>
              </select>
              <button
                onClick={load}
                disabled={loading}
                className="flex size-8 items-center justify-center rounded-lg border border-[#ebe6df] bg-white text-muted-foreground disabled:opacity-50"
              >
                <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-3 flex gap-1.5">
            {(['resumen', 'historial', 'chefs'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-full px-3 py-1 text-[12px] font-medium capitalize transition-all',
                  tab === t ? 'bg-[#006d5a] text-white' : 'text-muted-foreground hover:bg-secondary',
                )}
              >
                {t === 'resumen' ? 'Resumen' : t === 'historial' ? 'Historial' : 'Por chef'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-4 space-y-4">

        {/* Pending alert */}
        {dashboard && dashboard.pending_orders > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] text-[#d4943a]">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              {dashboard.pending_orders} producción{dashboard.pending_orders > 1 ? 'es' : ''} sin completar
              — el stock todavía no fue actualizado.
            </span>
            <Link href="/cocina/produccion" className="ml-auto font-semibold underline underline-offset-2">
              Ver
            </Link>
          </div>
        )}

        {/* ── RESUMEN ── */}
        {tab === 'resumen' && (
          <FadeIn>
            <div className="space-y-4">
              {/* KPIs */}
              <div className="flex gap-2">
                <KpiCard
                  label="Producciones"
                  value={dashboard?.total_completed ?? null}
                  sub={`últimos ${period} días`}
                />
                <KpiCard
                  label="Eficiencia prom."
                  value={dashboard?.avg_efficiency_pct ?? null}
                  unit="%"
                  color={effColor(dashboard?.avg_efficiency_pct ?? null)}
                />
              </div>
              <div className="flex gap-2">
                <KpiCard
                  label="Entrada total"
                  value={dashboard?.total_input_kg ?? null}
                  unit=" kg"
                />
                <KpiCard
                  label="Merma total"
                  value={dashboard?.total_waste_kg != null ? Number((dashboard.total_waste_kg).toFixed(2)) : null}
                  unit=" kg"
                  color={dashboard?.total_waste_kg ? 'text-[#ea504c]' : 'text-[#3d2c24]'}
                />
              </div>

              {/* Daily chart (simple bar list) */}
              {dashboard && dashboard.daily.length > 0 && (
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                  <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Últimos días</p>
                  <div className="space-y-2">
                    {dashboard.daily.slice(0, 7).map((d) => (
                      <div key={d.day} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
                          {new Date(d.day).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                        </span>
                        <div className="flex h-4 flex-1 rounded-full bg-[#f5f2ee]">
                          {d.avg_efficiency !== null && (
                            <div
                              className={cn('h-4 rounded-full', d.avg_efficiency >= 90 ? 'bg-[#006d5a]' : d.avg_efficiency >= 75 ? 'bg-[#d4943a]' : 'bg-[#ea504c]')}
                              style={{ width: `${Math.min(d.avg_efficiency, 100)}%` }}
                            />
                          )}
                        </div>
                        <span className={cn('w-10 text-right text-[11px] font-bold', effColor(d.avg_efficiency))}>
                          {d.avg_efficiency !== null ? `${d.avg_efficiency}%` : '—'}
                        </span>
                        <span className="w-8 text-right text-[11px] text-muted-foreground">
                          ×{d.orders}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent completed */}
              {completedOrders.length > 0 && (
                <div className="rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                  <div className="border-b border-[#ebe6df] px-4 py-2.5">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Recientes completadas</p>
                  </div>
                  <StaggerList>
                    {completedOrders.slice(0, 5).map((o) => (
                      <StaggerItem key={o.id}>
                        <Link
                          href={`/cocina/produccion/${o.id}`}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-[#f5f2ee] last:rounded-b-2xl"
                        >
                          <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold', effBg(o.summary.efficiency_pct))}>
                            <span className={effColor(o.summary.efficiency_pct)}>
                              {o.summary.efficiency_pct !== null ? `${o.summary.efficiency_pct}%` : '—'}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{o.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatDate(o.completed_at ?? o.created_at)}
                              {o.chef_name && ` · ${o.chef_name}`}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[12px] font-bold text-[#3d2c24]">
                              {o.summary.total_input_qty.toFixed(2)} kg
                            </p>
                            {o.summary.total_waste_qty > 0 && (
                              <p className="text-[11px] text-[#ea504c]">
                                <Leaf className="mr-0.5 inline size-2.5" />
                                {o.summary.total_waste_qty.toFixed(3)} kg
                              </p>
                            )}
                          </div>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      </StaggerItem>
                    ))}
                  </StaggerList>
                </div>
              )}

              {/* Empty */}
              {!loading && completedOrders.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#ebe6df] py-10 text-center">
                  <Package className="size-8 text-muted-foreground/40" strokeWidth={1.5} />
                  <p className="text-[13px] text-muted-foreground">Sin producciones completadas en {period} días</p>
                  <Link href="/cocina/produccion/nueva" className="mt-1 text-[13px] font-semibold text-[#006d5a]">
                    Registrar primera producción →
                  </Link>
                </div>
              )}
            </div>
          </FadeIn>
        )}

        {/* ── HISTORIAL ── */}
        {tab === 'historial' && (
          <FadeIn>
            <div className="space-y-2">
              {orders.length === 0 && !loading ? (
                <div className="rounded-2xl border border-dashed border-[#ebe6df] py-10 text-center text-muted-foreground text-[13px]">
                  Sin producciones en el período
                </div>
              ) : (
                <StaggerList className="space-y-2">
                  {orders.map((o) => {
                    const STATUS = {
                      draft:       { label: 'Borrador',    icon: Clock,         color: 'text-muted-foreground bg-[#f5f2ee]' },
                      in_progress: { label: 'En progreso', icon: Clock,         color: 'text-[#d4943a] bg-amber-50' },
                      completed:   { label: 'Completado',  icon: CheckCircle2,  color: 'text-[#006d5a] bg-[#e8f5f1]' },
                      cancelled:   { label: 'Cancelado',   icon: AlertTriangle, color: 'text-[#ea504c] bg-red-50' },
                    }
                    const cfg = STATUS[o.status]
                    const Icon = cfg.icon
                    return (
                      <StaggerItem key={o.id}>
                        <Link
                          href={`/cocina/produccion/${o.id}`}
                          className="block rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df] active:scale-[0.99]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.color)}>
                                  <Icon className="size-3" />
                                  {cfg.label}
                                </span>
                                {o.parent_order_id && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                    <GitBranch className="size-3" />Sub
                                  </span>
                                )}
                                {o.template_name && (
                                  <span className="text-[10px] text-muted-foreground">{o.template_name}</span>
                                )}
                              </div>
                              <p className="mt-1 truncate text-[13px] font-semibold text-[#3d2c24]">{o.name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {formatDate(o.created_at)}
                                {o.chef_name && ` · ${o.chef_name}`}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <EffBar pct={o.summary.efficiency_pct} />
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {o.summary.total_input_qty.toFixed(2)} kg
                              </p>
                            </div>
                          </div>
                        </Link>
                      </StaggerItem>
                    )
                  })}
                </StaggerList>
              )}
            </div>
          </FadeIn>
        )}

        {/* ── POR CHEF ── */}
        {tab === 'chefs' && (
          <FadeIn>
            <div className="space-y-2">
              {!dashboard || dashboard.by_chef.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#ebe6df] py-10 text-center text-[13px] text-muted-foreground">
                  Sin datos de chefs en el período
                </div>
              ) : (
                <StaggerList className="space-y-2">
                  {dashboard.by_chef.map((chef, idx) => (
                    <StaggerItem key={chef.chef_id ?? idx}>
                      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#006d5a]/10">
                            <ChefHat className="size-5 text-[#006d5a]" strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-[#3d2c24]">{chef.chef_name || 'Sin nombre'}</p>
                            <p className="text-[12px] text-muted-foreground">
                              {chef.total_orders} producción{chef.total_orders !== 1 ? 'es' : ''}
                              {chef.total_waste > 0 && ` · ${formatKg(chef.total_waste)} merma`}
                            </p>
                          </div>
                          <div className="shrink-0">
                            <EffBar pct={chef.avg_efficiency} />
                          </div>
                        </div>

                        {/* Rank indicator */}
                        {idx === 0 && dashboard.by_chef.length > 1 && (
                          <div className="mt-2.5 flex items-center gap-1 text-[11px] font-medium text-[#006d5a]">
                            <TrendingUp className="size-3.5" />
                            Mayor eficiencia del período
                          </div>
                        )}
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerList>
              )}
            </div>
          </FadeIn>
        )}

        {/* Link to chef production page */}
        <Link
          href="/cocina/produccion"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-[#f5f2ee] px-4 py-3 text-[13px] font-medium text-[#3d2c24]"
        >
          <ChefHat className="size-4 text-[#006d5a]" />
          Registrar nueva producción
        </Link>
      </div>
    </div>
  )
}
