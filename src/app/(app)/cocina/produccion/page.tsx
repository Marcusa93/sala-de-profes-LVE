'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Plus, ChefHat, CheckCircle2, Clock, XCircle, ChevronRight,
  TrendingUp, AlertTriangle, Package, GitBranch,
} from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/ui/LoadingState'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrderSummary = {
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

const STATUS_CONFIG = {
  draft:       { label: 'Borrador',    icon: Clock,         color: 'text-[#a39e97] bg-[#f5f2ee]' },
  in_progress: { label: 'En progreso', icon: Clock,         color: 'text-[#d4943a] bg-amber-50' },
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
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/produccion/orders?days=30')
      if (res.ok) {
        const json = await res.json()
        setOrders(json.orders ?? [])
      }
    } catch {
      // Silently handle — empty list shown
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = statusFilter === 'all'
    ? orders
    : orders.filter((o) => o.status === statusFilter)

  const counts = {
    all: orders.length,
    draft: orders.filter((o) => o.status === 'draft').length,
    in_progress: orders.filter((o) => o.status === 'in_progress').length,
    completed: orders.filter((o) => o.status === 'completed').length,
  }

  const FILTERS = [
    { key: 'all',         label: 'Todas',       count: counts.all },
    { key: 'draft',       label: 'Borrador',    count: counts.draft },
    { key: 'in_progress', label: 'En curso',    count: counts.in_progress },
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
                      {formatDate(order.created_at)}
                      {order.chef_name && ` · ${order.chef_name}`}
                    </p>
                  </Link>
                </StaggerItem>
              )
            })}
          </StaggerList>
        )}

        {/* Alert: pending orders */}
        {counts.draft + counts.in_progress > 0 && statusFilter === 'all' && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-[#d4943a]">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>
              Hay {counts.draft + counts.in_progress} producción{counts.draft + counts.in_progress > 1 ? 'es' : ''} sin completar.{' '}
              El stock no se actualiza hasta que se confirmen.
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
