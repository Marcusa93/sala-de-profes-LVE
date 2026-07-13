'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Plus, ChefHat, CheckCircle2, Clock, XCircle, ChevronRight,
  TrendingUp, AlertTriangle, Package, GitBranch, ShieldCheck,
  Sparkles, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProduccionOrders } from '@/lib/hooks/use-produccion'

// ---------------------------------------------------------------------------
// Plan de producción IA — qué producir hoy según ventas × stock × vida útil
// ---------------------------------------------------------------------------

type PlanItem = {
  stock_item_id: string
  name: string
  unit: string
  current_qty: number
  expected_today: number
  pending_production: number
  suggested_qty: number
  reason: string
}

type ProductionPlanResponse = {
  today: string
  items: PlanItem[]
  sellingWithoutStock: { name: string; avg_daily_sales: number; current_qty: number }[]
  analysis: string
}

function PlanIACard() {
  const [plan, setPlan] = useState<ProductionPlanResponse | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(true)
  const [planError, setPlanError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const loadPlan = async () => {
    setLoadingPlan(true)
    setPlanError(null)
    try {
      const res = await fetch('/api/ai/production-plan', { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo generar el plan')
      setPlan(json)
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Error al generar el plan')
    } finally {
      setLoadingPlan(false)
    }
  }

  useEffect(() => { loadPlan() }, [])

  return (
    <div className="rounded-2xl bg-white ring-1 ring-[#ebe6df]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#3d2c24]">
            <Sparkles className="size-3.5 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-[#3d2c24]">¿Qué producir hoy?</p>
            <p className="text-[10px] text-[#a39e97]">
              {loadingPlan ? 'Cruzando ventas, stock y vida útil…' : plan ? `Plan del ${plan.today} · según ventas reales de Fudo` : 'Plan IA'}
            </p>
          </div>
        </div>
        <button
          onClick={loadPlan}
          disabled={loadingPlan}
          className="rounded-lg bg-[#f3efe9] p-2 text-[#3d2c24] active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', loadingPlan && 'animate-spin')} />
        </button>
      </div>

      {planError && <p className="px-4 pb-3 text-[11px] text-[#ea504c]">{planError}</p>}

      {plan && !loadingPlan && (
        <div className="border-t border-[#ebe6df]/60 px-4 py-3">
          {/* Urgente: vendiendo sin stock digital */}
          {plan.sellingWithoutStock.length > 0 && (
            <div className="mb-3 rounded-xl bg-[#fff7f7] px-3 py-2 ring-1 ring-[#f3d0cf]">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#ea504c]">
                <AlertTriangle className="size-3.5" />
                Venden pero figuran sin stock — contar primero
              </p>
              <p className="mt-0.5 text-[11px] text-[#7d6c64]">
                {plan.sellingWithoutStock.map(s => s.name).join(' · ')}
              </p>
            </div>
          )}

          <p className="whitespace-pre-line text-xs leading-relaxed text-[#3d2c24]">{plan.analysis}</p>

          {plan.items.length > 0 && (
            <>
              <button
                onClick={() => setExpanded(e => !e)}
                className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#006d5a]"
              >
                {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                {expanded ? 'Ocultar detalle' : `Ver detalle (${plan.items.length} items)`}
              </button>
              {expanded && (
                <div className="mt-2 space-y-1.5">
                  {plan.items.map((item) => (
                    <div key={item.stock_item_id} className="flex items-center justify-between rounded-xl bg-[#faf8f5] px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#3d2c24]">{item.name}</p>
                        <p className="text-[10px] text-[#a39e97]">{item.reason}</p>
                      </div>
                      <span className="ml-2 shrink-0 rounded-full bg-[#e8f5f1] px-2.5 py-1 text-[11px] font-bold text-[#006d5a]">
                        +{item.suggested_qty} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  draft:       { label: 'Borrador',    icon: Clock,         color: 'text-[#a39e97] bg-[#f5f2ee]' },
  in_progress: { label: 'En progreso', icon: Clock,         color: 'text-[#d4943a] bg-amber-50' },
  pending_review: { label: 'A validar', icon: ShieldCheck, color: 'text-[#d4943a] bg-amber-50' },
  completed:   { label: 'Completado',  icon: CheckCircle2,  color: 'text-[#006d5a] bg-[#e8f5f1]' },
  cancelled:   { label: 'Cancelado',   icon: XCircle,       color: 'text-[#ea504c] bg-red-50' },
}

function efficiencyColor(pct: number | null) {
  if (pct === null) return 'text-muted-foreground'
  if (pct >= 90) return 'text-[#006d5a]'
  if (pct >= 75) return 'text-[#d4943a]'
  return 'text-[#ea504c]'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProduccionPage() {
  const { orders, isLoading: loading } = useProduccionOrders(30)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filtered = statusFilter === 'all'
    ? orders
    : orders.filter((o) => o.status === statusFilter)

  const counts = {
    all: orders.length,
    draft: orders.filter((o) => o.status === 'draft').length,
    in_progress: orders.filter((o) => o.status === 'in_progress').length,
    pending_review: orders.filter((o) => o.status === 'pending_review').length,
    completed: orders.filter((o) => o.status === 'completed').length,
  }

  const FILTERS = [
    { key: 'all',         label: 'Todas',       count: counts.all },
    { key: 'draft',       label: 'Borrador',    count: counts.draft },
    { key: 'in_progress', label: 'En curso',    count: counts.in_progress },
    { key: 'pending_review', label: 'A validar', count: counts.pending_review },
    { key: 'completed',   label: 'Completadas', count: counts.completed },
  ]

  return (
    <div className="min-h-screen bg-[#faf8f5] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#ebe6df] bg-[#faf8f5]/95 backdrop-blur-md">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#006d5a]/10">
                <ChefHat className="size-4 text-[#006d5a]" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="text-[15px] font-semibold text-[#3d2c24]">Producción</h1>
                <p className="text-[11px] text-muted-foreground">Despiece y transformación</p>
              </div>
            </div>
            <Link
              href="/cocina/produccion/nueva"
              className="flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm active:scale-95 transition-transform"
            >
              <Plus className="size-4" />
              Nueva
            </Link>
          </div>

          {/* Filters */}
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all',
                  statusFilter === f.key
                    ? 'bg-[#006d5a] text-white shadow-sm'
                    : 'bg-white text-muted-foreground ring-1 ring-[#ebe6df]',
                )}
              >
                {f.label}
                {f.count > 0 && (
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    statusFilter === f.key ? 'bg-white/20 text-white' : 'bg-secondary text-muted-foreground',
                  )}>
                    {f.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4">
        {/* Plan de producción IA: qué producir hoy */}
        <FadeIn>
          <PlanIACard />
        </FadeIn>

        {loading ? (
          <LoadingState message="Cargando producciones..." />
        ) : filtered.length === 0 ? (
          <FadeIn>
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#ebe6df] px-6 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-[#006d5a]/10">
                <Package className="size-6 text-[#006d5a]" strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-medium text-[#3d2c24]">Sin producciones</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Registrá el despiece o transformación de un insumo
                </p>
              </div>
              <Link
                href="/cocina/produccion/nueva"
                className="mt-1 rounded-xl bg-[#006d5a] px-5 py-2 text-[13px] font-semibold text-white"
              >
                Empezar
              </Link>
            </div>
          </FadeIn>
        ) : (
          <StaggerList className="space-y-2">
            {filtered.map((order) => {
              const cfg = STATUS_CONFIG[order.status]
              const StatusIcon = cfg.icon
              return (
                <StaggerItem key={order.id}>
                  <Link
                    href={`/cocina/produccion/${order.id}`}
                    className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df] transition-all active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', cfg.color)}>
                            <StatusIcon className="size-3" />
                            {cfg.label}
                          </span>
                          {order.parent_order_id && (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <GitBranch className="size-3" />
                              Sub-prod.
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 truncate font-semibold text-[#3d2c24]">{order.name}</p>
                        {order.template_name && (
                          <p className="text-[12px] text-muted-foreground">{order.template_name}</p>
                        )}
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    </div>

                    {/* Summary */}
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-[#f5f2ee] px-2 py-1.5 text-center">
                        <p className="text-[10px] text-muted-foreground">Entrada</p>
                        <p className="text-[13px] font-bold text-[#3d2c24]">
                          {order.summary.total_input_qty > 0
                            ? `${order.summary.total_input_qty.toFixed(2)} kg`
                            : '—'}
                        </p>
                      </div>
                      <div className="rounded-xl bg-[#f5f2ee] px-2 py-1.5 text-center">
                        <p className="text-[10px] text-muted-foreground">Merma</p>
                        <p className={cn('text-[13px] font-bold', order.summary.total_waste_qty > 0 ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>
                          {order.summary.total_waste_qty > 0
                            ? `${order.summary.total_waste_qty.toFixed(3)} kg`
                            : '—'}
                        </p>
                      </div>
                      <div className="rounded-xl bg-[#f5f2ee] px-2 py-1.5 text-center">
                        <p className="text-[10px] text-muted-foreground">Eficiencia</p>
                        <p className={cn('text-[13px] font-bold', efficiencyColor(order.summary.efficiency_pct))}>
                          {order.summary.efficiency_pct !== null
                            ? `${order.summary.efficiency_pct}%`
                            : '—'}
                        </p>
                      </div>
                    </div>

                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {formatDate(order.submitted_at ?? order.created_at)}
                      {order.chef_name && ` · ${order.chef_name}`}
                    </p>
                  </Link>
                </StaggerItem>
              )
            })}
          </StaggerList>
        )}

        {/* Alert: pending orders */}
        {counts.draft + counts.in_progress + counts.pending_review > 0 && statusFilter === 'all' && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-[#d4943a]">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>
              Hay {counts.draft + counts.in_progress + counts.pending_review} producción{counts.draft + counts.in_progress + counts.pending_review > 1 ? 'es' : ''} sin cerrar.{' '}
              Las que están a validar no actualizan stock ni Fudo hasta aprobación del encargado.
            </span>
          </div>
        )}

        {/* Link to dashboard */}
        <Link
          href="/stock/produccion"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-[#f5f2ee] px-4 py-3 text-[13px] font-medium text-[#3d2c24]"
        >
          <TrendingUp className="size-4 text-[#006d5a]" />
          Ver dashboard de rendimientos
        </Link>
      </div>
    </div>
  )
}
