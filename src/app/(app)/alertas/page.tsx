'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Package,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import type { StockAlert } from '@/types/database'
import { ALERT_TYPES, type AlertType } from '@/lib/constants'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/badge'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AlertWithItem = StockAlert & {
  stock_items: { name: string; category: string } | null
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AlertasPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [alerts, setAlerts] = useState<AlertWithItem[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [showResolved, setShowResolved] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const isEncargado = profile?.role === 'encargado'

  // -------------------------------------------------------------------------
  // Fetch alerts
  // -------------------------------------------------------------------------

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('stock_alerts')
        .select('*, stock_items(name, category)')
        .order('created_at', { ascending: false })

      if (error) throw error
      setAlerts((data as unknown as AlertWithItem[]) ?? [])
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
    let active = alerts.filter((a) => a.status === 'active')
    const resolved = alerts.filter((a) => a.status === 'resolved')

    // Filter by type
    if (typeFilter !== 'all') {
      active = active.filter((a) => a.alert_type === typeFilter)
    }

    return { activeAlerts: active, resolvedAlerts: resolved }
  }, [alerts, typeFilter])

  // -------------------------------------------------------------------------
  // Resolve handler
  // -------------------------------------------------------------------------

  async function handleResolve(alertId: string) {
    if (!profile) return

    setResolvingId(alertId)
    try {
      const supabase = createClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('resolve_alert', { p_alert_id: alertId })

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
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">Cargando...</p>
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
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">Cargando alertas...</p>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          <Bell className="mb-0.5 mr-1.5 inline-block size-5 text-primary" />
          Centro de Alertas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {activeAlerts.length === 0
            ? 'No hay alertas activas'
            : `${activeAlerts.length} alerta${activeAlerts.length === 1 ? '' : 's'} activa${activeAlerts.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {/* Type filter */}
      <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Filtrar por tipo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los tipos</SelectItem>
          {Object.entries(ALERT_TYPES).map(([key, config]) => (
            <SelectItem key={key} value={key}>
              {config.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Active alerts */}
      {activeAlerts.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Sin alertas activas"
          description="Todas las alertas han sido resueltas. Todo esta en orden."
        />
      ) : (
        <div className="grid gap-3">
          {activeAlerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onResolve={() => handleResolve(alert.id)}
              resolving={resolvingId === alert.id}
            />
          ))}
        </div>
      )}

      {/* Resolved alerts (collapsible) */}
      {resolvedAlerts.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="flex w-full items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>
              Resueltas ({resolvedAlerts.length})
            </span>
            {showResolved ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>

          {showResolved && (
            <div className="grid gap-3">
              {resolvedAlerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  resolved
                />
              ))}
            </div>
          )}
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

  return (
    <Card size="sm" className={resolved ? 'opacity-60' : undefined}>
      <CardContent className="space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-foreground">
                {alert.stock_items?.name ?? 'Item desconocido'}
              </h3>
              <Badge
                variant="secondary"
                style={{
                  backgroundColor: typeConfig.color + '1A',
                  color: typeConfig.color,
                }}
              >
                {typeConfig.label}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {alert.message}
            </p>
          </div>
        </div>

        {/* Timestamp */}
        <p className="text-xs text-muted-foreground">
          {format(new Date(alert.created_at), "d MMM yyyy, HH:mm", {
            locale: es,
          })}
          {alert.resolved_at && (
            <>
              {' '}
              - Resuelta el{' '}
              {format(new Date(alert.resolved_at), "d MMM yyyy, HH:mm", {
                locale: es,
              })}
            </>
          )}
        </p>

        {/* Actions */}
        {!resolved && (
          <div className="flex gap-2">
            <Button
              variant="default"
              size="xs"
              onClick={onResolve}
              disabled={resolving}
            >
              {resolving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3" />
              )}
              Resolver
            </Button>
            <Link href="/stock">
              <Button variant="outline" size="xs">
                <Package className="size-3" />
                Ver item
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
