'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import Link from 'next/link'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Loader2,
  Package,
  MessageCircle,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import type { StockAlert } from '@/types/database'
import { ALERT_TYPES, type AlertType } from '@/lib/constants'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SupplierInfo = {
  id: string
  name: string
  phone: string | null
  contact_name: string | null
}

type AlertWithItem = StockAlert & {
  stock_items: {
    name: string
    category: string
    current_qty: number
    min_qty: number
    unit: string
    supplier_id: string | null
  } | null
  supplier?: SupplierInfo | null
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AlertasPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [alerts, setAlerts] = useState<AlertWithItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'active' | 'resolved'>('active')
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const isEncargado = isManagerOrAbove(profile?.role)

  // -------------------------------------------------------------------------
  // Fetch alerts
  // -------------------------------------------------------------------------

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('stock_alerts')
        .select('*, stock_items(name, category, current_qty, min_qty, unit, supplier_id)')
        .order('created_at', { ascending: false })

      if (error) throw error

      const alertsData = (data as unknown as AlertWithItem[]) ?? []

      // Fetch suppliers for alerts that have linked stock items
      const supplierIds = [
        ...new Set(
          alertsData
            .map((a) => a.stock_items?.supplier_id)
            .filter(Boolean) as string[],
        ),
      ]

      if (supplierIds.length > 0) {
        const { data: suppliers } = await supabase
          .from('suppliers')
          .select('id, name, phone, contact_name')
          .in('id', supplierIds as unknown as number[])

        const supplierMap = new Map(
          (suppliers ?? []).map((s) => [s.id, s as unknown as SupplierInfo]),
        )

        for (const alert of alertsData) {
          if (alert.stock_items?.supplier_id) {
            alert.supplier = supplierMap.get(alert.stock_items.supplier_id as unknown as number) ?? null
          }
        }
      }

      setAlerts(alertsData)
    } catch (err) {
      console.error(err)
      toast.error('Error al cargar alertas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (profile) fetchAlerts()
  }, [profile, fetchAlerts])

  // -------------------------------------------------------------------------
  // Split active / resolved
  // -------------------------------------------------------------------------

  const { activeAlerts, resolvedAlerts } = useMemo(() => {
    const active = alerts.filter((a) => a.status === 'active')
    const resolved = alerts.filter((a) => a.status === 'resolved')
    return { activeAlerts: active, resolvedAlerts: resolved }
  }, [alerts])

  // -------------------------------------------------------------------------
  // Resolve handler
  // -------------------------------------------------------------------------

  async function handleResolve(alertId: string) {
    if (!profile) return

    setResolvingId(alertId)
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc('resolve_alert', { p_alert_id: alertId })

      if (error) throw error

      toast.success('Alerta resuelta')
      fetchAlerts()
    } catch (err) {
      console.error(err)
      toast.error('Error al resolver alerta')
    } finally {
      setResolvingId(null)
    }
  }

  // -------------------------------------------------------------------------
  // Access control: only encargado
  // -------------------------------------------------------------------------

  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-[#006d5a]" />
          <p className="text-sm text-[#a39e97]">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!isEncargado) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          icon={AlertTriangle}
          title="Acceso restringido"
          description="Solo los encargados pueden ver las alertas"
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-[#006d5a]" />
          <p className="text-sm text-[#a39e97]">Cargando alertas...</p>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Current tab data
  // -------------------------------------------------------------------------

  const displayedAlerts =
    activeTab === 'active' ? activeAlerts : resolvedAlerts

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#3d2c24]">
          Alertas
        </h1>
        <p className="section-label">Seguimiento de incidencias</p>
      </div>

      {/* Segmented control: Activas / Resueltas */}
      <div className="card-elevated inline-flex rounded-xl p-1">
        <button
          onClick={() => setActiveTab('active')}
          className={`relative flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
            activeTab === 'active'
              ? 'bg-[#006d5a] text-white shadow-sm shadow-[#006d5a]/20'
              : 'text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          Activas
          {activeAlerts.length > 0 && (
            <span
              className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${
                activeTab === 'active'
                  ? 'bg-white/20 text-white'
                  : 'bg-[#ea504c] text-white'
              }`}
            >
              {activeAlerts.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('resolved')}
          className={`relative flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
            activeTab === 'resolved'
              ? 'bg-[#006d5a] text-white shadow-sm shadow-[#006d5a]/20'
              : 'text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          Resueltas
          {resolvedAlerts.length > 0 && (
            <span
              className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${
                activeTab === 'resolved'
                  ? 'bg-white/20 text-white'
                  : 'bg-[#ebe6df] text-[#3d2c24]'
              }`}
            >
              {resolvedAlerts.length}
            </span>
          )}
        </button>
      </div>

      {/* Alert cards */}
      {displayedAlerts.length === 0 ? (
        <EmptyState
          icon={activeTab === 'active' ? CheckCircle2 : Bell}
          title={
            activeTab === 'active'
              ? 'Sin alertas activas'
              : 'Sin alertas resueltas'
          }
          description={
            activeTab === 'active'
              ? 'Todas las alertas han sido resueltas. Todo esta en orden.'
              : 'Todavia no se han resuelto alertas.'
          }
        />
      ) : (
        <div className="relative space-y-3">
          {/* Timeline connector line */}
          <div className="absolute left-[19px] top-6 bottom-6 hidden w-px bg-[#ebe6df] sm:block" />

          {displayedAlerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              resolved={activeTab === 'resolved'}
              onResolve={() => handleResolve(alert.id)}
              resolving={resolvingId === alert.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AlertCard
// ---------------------------------------------------------------------------

type AlertCardProps = {
  alert: AlertWithItem
  resolved?: boolean
  onResolve?: () => void
  resolving?: boolean
}

function AlertCard({
  alert,
  resolved = false,
  onResolve,
  resolving = false,
}: AlertCardProps) {
  const typeConfig =
    ALERT_TYPES[alert.alert_type as AlertType] ?? ALERT_TYPES.low_stock

  // Priority border color: critical = rojo, warning = amber, resolved = verde
  const isCritical = alert.alert_type === 'critical'
  const borderAccent = resolved
    ? 'bg-[#006d5a]'
    : isCritical
      ? 'bg-[#ea504c]'
      : 'bg-[#d4943a]'

  return (
    <div
      className={`card-elevated hover-lift relative flex overflow-hidden rounded-xl ${
        resolved ? 'opacity-60' : ''
      }`}
    >
      {/* Left colored accent bar */}
      <div className={`w-1 shrink-0 ${borderAccent}`} />

      {/* Card content */}
      <div className="flex-1 p-5 space-y-3">
        {/* Header: item name + type badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="font-semibold text-[#3d2c24]">
                {alert.stock_items?.name ?? 'Item desconocido'}
              </h3>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                style={{
                  backgroundColor: typeConfig.color + '14',
                  color: typeConfig.color,
                }}
              >
                {typeConfig.label}
              </span>
            </div>

            {/* Message */}
            <p className="text-sm text-[#a39e97] leading-relaxed">
              {alert.message}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        {alert.stock_items && !resolved && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/stock"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#006d5a]/15 bg-[#f0f7f5] px-3 py-1 text-xs font-semibold text-[#006d5a] transition-all hover:bg-[#006d5a] hover:text-white"
            >
              <Package className="size-3" />
              Ver en stock
            </Link>
            {alert.supplier?.phone ? (
              <a
                href={`https://wa.me/${alert.supplier.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                  `Hola${alert.supplier.contact_name ? ` ${alert.supplier.contact_name}` : ''}, soy de La Vieja Escuela.\nNecesitamos: ${alert.stock_items.name} — quedan ${alert.stock_items.current_qty} ${alert.stock_items.unit}, necesitamos al menos ${alert.stock_items.min_qty}.`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#25d366] px-3 py-1 text-xs font-bold text-white transition-all hover:bg-[#1da851] active:scale-95"
              >
                <MessageCircle className="size-3" />
                {alert.supplier.name}
              </a>
            ) : alert.supplier ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-[#a39e97] italic">
                <Truck className="size-3" />
                {alert.supplier.name} (sin tel.)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-[#a39e97] italic">
                Sin proveedor asignado
              </span>
            )}
          </div>
        )}

        {/* Timestamp */}
        <p className="text-xs text-[#a39e97]">
          {format(new Date(alert.created_at), 'd MMM yyyy, HH:mm', {
            locale: es,
          })}
        </p>

        {/* Resolved info */}
        {resolved && alert.resolved_at && (
          <p className="text-xs text-[#006d5a]">
            Resuelta el{' '}
            {format(new Date(alert.resolved_at), 'd MMM yyyy, HH:mm', {
              locale: es,
            })}
          </p>
        )}

        {/* Resolve button */}
        {!resolved && onResolve && (
          <button
            onClick={onResolve}
            disabled={resolving}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#006d5a] px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-[#006d5a]/20 transition-all disabled:opacity-50 active:scale-95 hover:bg-[#004d3f]"
          >
            {resolving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3" />
            )}
            Resolver
          </button>
        )}
      </div>
    </div>
  )
}
