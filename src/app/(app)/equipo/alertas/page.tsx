'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ShieldAlert,
  ShieldCheck,
  MapPin,
  Wifi,
  Camera,
  Smartphone,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AlertRecord = {
  log_id:              string
  user_id:             string
  first_name:          string
  last_name:           string
  role:                string
  operative_date:      string
  clock_in_at:         string
  clock_out_at:        string | null
  hours_worked:        number | null
  suspicious_reasons:  string[]
  geo_verified:        boolean
  geo_distance_m:      number | null
  wifi_verified:       boolean
  wifi_ssid:           string | null
  clock_in_photo_url:  string | null
  clock_out_photo_url: string | null
  device_id:           string | null
  status:              string
}

// ---------------------------------------------------------------------------
// Role colors
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  socio:     '#1a1a2e',
  encargado: '#006d5a',
  chef:      '#8b5e34',
  cocina:    '#a85d32',
  barista:   '#2d7d6a',
  runner:    '#c67b4b',
  bacha:     '#7a8b8b',
}

const ROLE_LABELS: Record<string, string> = {
  socio: 'Socio', encargado: 'Encargado', chef: 'Chef',
  cocina: 'Cocina', barista: 'Barista', runner: 'Runner', bacha: 'Bacha',
}

// ---------------------------------------------------------------------------
// Sub-componente: fila de alerta expandible
// ---------------------------------------------------------------------------

function AlertRow({ alert }: { alert: AlertRecord }) {
  const [expanded, setExpanded] = useState(false)

  const isSuspicious = (alert.suspicious_reasons?.length ?? 0) > 0
  const isMissingCheckout = alert.status === 'open' || alert.status === 'missing_checkout'

  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-all ${
        isSuspicious ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'
      }`}
    >
      {/* Fila principal */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white"
          style={{ backgroundColor: ROLE_COLORS[alert.role] ?? '#666' }}
        >
          {alert.first_name[0]}{alert.last_name[0]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#3d2c24]">
            {alert.first_name} {alert.last_name}
            <span className="ml-2 text-xs font-normal text-[#a39e97]">
              {ROLE_LABELS[alert.role] ?? alert.role}
            </span>
          </p>
          <p className="text-xs text-[#a39e97]">
            {format(new Date(alert.operative_date + 'T12:00:00'), "EEEE d/MM", { locale: es })}
            {' · '}
            {format(new Date(alert.clock_in_at), 'HH:mm')}
            {alert.clock_out_at ? ` → ${format(new Date(alert.clock_out_at), 'HH:mm')}` : ' → ?'}
            {alert.hours_worked !== null && ` (${alert.hours_worked}h)`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isMissingCheckout && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              Sin egreso
            </span>
          )}
          {isSuspicious && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              ⚠ {alert.suspicious_reasons.length}
            </span>
          )}
          {expanded ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
        </div>
      </button>

      {/* Detalle expandido */}
      {expanded && (
        <div className="border-t border-amber-200/60 px-4 py-4 space-y-4">
          {/* Motivos de alerta */}
          {isSuspicious && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#a39e97]">Motivos de alerta</p>
              {alert.suspicious_reasons.map((reason, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {reason}
                </div>
              ))}
            </div>
          )}

          {/* Verificaciones */}
          <div className="grid grid-cols-2 gap-2">
            {/* GPS */}
            <div className={`flex items-center gap-2 rounded-xl p-3 ${alert.geo_verified ? 'bg-[#e8f5f1]' : 'bg-red-100'}`}>
              <MapPin className={`size-4 ${alert.geo_verified ? 'text-[#006d5a]' : 'text-red-600'}`} />
              <div>
                <p className="text-xs font-medium text-[#3d2c24]">
                  GPS {alert.geo_verified ? '✓' : '✗'}
                </p>
                {alert.geo_distance_m !== null && (
                  <p className="text-xs text-[#a39e97]">{alert.geo_distance_m}m del local</p>
                )}
              </div>
            </div>

            {/* WiFi */}
            <div className={`flex items-center gap-2 rounded-xl p-3 ${alert.wifi_verified ? 'bg-[#e8f5f1]' : 'bg-gray-100'}`}>
              <Wifi className={`size-4 ${alert.wifi_verified ? 'text-[#006d5a]' : 'text-[#a39e97]'}`} />
              <div>
                <p className="text-xs font-medium text-[#3d2c24]">
                  WiFi {alert.wifi_verified ? '✓' : '—'}
                </p>
                {alert.wifi_ssid && (
                  <p className="text-xs text-[#a39e97] truncate max-w-[80px]">{alert.wifi_ssid}</p>
                )}
              </div>
            </div>

            {/* Foto ingreso */}
            <div className={`flex items-center gap-2 rounded-xl p-3 ${alert.clock_in_photo_url ? 'bg-[#e8f5f1]' : 'bg-red-100'}`}>
              <Camera className={`size-4 ${alert.clock_in_photo_url ? 'text-[#006d5a]' : 'text-red-600'}`} />
              <div>
                <p className="text-xs font-medium text-[#3d2c24]">
                  Foto entrada {alert.clock_in_photo_url ? '✓' : '✗'}
                </p>
                {alert.clock_in_photo_url && (
                  <a
                    href={alert.clock_in_photo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#006d5a] underline"
                  >
                    Ver foto
                  </a>
                )}
              </div>
            </div>

            {/* Foto egreso */}
            <div className={`flex items-center gap-2 rounded-xl p-3 ${alert.clock_out_photo_url ? 'bg-[#e8f5f1]' : 'bg-gray-100'}`}>
              <Camera className={`size-4 ${alert.clock_out_photo_url ? 'text-[#006d5a]' : 'text-[#a39e97]'}`} />
              <div>
                <p className="text-xs font-medium text-[#3d2c24]">
                  Foto salida {alert.clock_out_photo_url ? '✓' : '—'}
                </p>
                {alert.clock_out_photo_url && (
                  <a
                    href={alert.clock_out_photo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#006d5a] underline"
                  >
                    Ver foto
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Device ID */}
          {alert.device_id && (
            <div className="flex items-center gap-2 text-xs text-[#a39e97]">
              <Smartphone className="size-3.5" />
              <span>Dispositivo: {alert.device_id}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AlertasAsistenciaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(7)

  const isManager = profile?.role === 'socio' || profile?.role === 'encargado'

  const fetchAlerts = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/attendance/alerts?from_date=${
        format(new Date(Date.now() - days * 86400000), 'yyyy-MM-dd')
      }`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAlerts(data.alerts ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar alertas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (profile && isManager) fetchAlerts()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, days])

  if (profileLoading) return <LoadingState message="Cargando alertas..." />
  if (!isManager) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <ShieldAlert className="size-12 text-[#ebe6df]" />
        <p className="font-display text-lg font-semibold text-[#3d2c24]">Sin acceso</p>
        <p className="text-sm text-[#a39e97]">Solo encargados y socios pueden ver las alertas.</p>
      </div>
    )
  }

  const suspicious = alerts.filter(a => a.suspicious_reasons?.length > 0)
  const missingCheckout = alerts.filter(a => a.status === 'open' || a.status === 'missing_checkout')

  return (
    <div className="mx-auto max-w-lg space-y-6 pb-28">
      {/* Header */}
      <FadeIn className="pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-[#3d2c24]">Alertas de fichaje</h1>
            <p className="mt-0.5 text-sm text-[#a39e97]">
              Últimos {days} días · {alerts.length} registros con alertas
            </p>
          </div>
          <button
            onClick={fetchAlerts}
            disabled={loading}
            className="flex size-10 items-center justify-center rounded-xl border border-[#ebe6df] bg-white"
          >
            {loading
              ? <Loader2 className="size-4 animate-spin text-[#a39e97]" />
              : <RefreshCw className="size-4 text-[#a39e97]" />
            }
          </button>
        </div>

        {/* Filtro de días */}
        <div className="mt-3 flex gap-2">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                days === d
                  ? 'bg-[#006d5a] text-white'
                  : 'bg-[#f5f0ea] text-[#a39e97]'
              }`}
            >
              {d} días
            </button>
          ))}
        </div>
      </FadeIn>

      {/* KPIs rápidos */}
      <FadeIn delay={0.1} className="grid grid-cols-2 gap-3">
        <div className="card-elevated flex items-center gap-3 p-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-100">
            <ShieldAlert className="size-5 text-amber-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#3d2c24]">{suspicious.length}</p>
            <p className="text-xs text-[#a39e97]">Sospechosos</p>
          </div>
        </div>
        <div className="card-elevated flex items-center gap-3 p-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-red-100">
            <Clock className="size-5 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#3d2c24]">{missingCheckout.length}</p>
            <p className="text-xs text-[#a39e97]">Sin egreso</p>
          </div>
        </div>
      </FadeIn>

      {/* Lista de alertas */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-[#a39e97]" />
        </div>
      ) : alerts.length === 0 ? (
        <FadeIn delay={0.2}>
          <div className="card-elevated flex flex-col items-center gap-3 px-6 py-12 text-center">
            <ShieldCheck className="size-12 text-[#e8f5f1]" />
            <p className="font-display text-lg font-semibold text-[#3d2c24]">Todo limpio</p>
            <p className="text-sm text-[#a39e97]">
              No hay fichajes sospechosos en los últimos {days} días.
            </p>
          </div>
        </FadeIn>
      ) : (
        <FadeIn delay={0.2} className="space-y-3">
          <StaggerList className="space-y-2.5">
            {alerts.map(alert => (
              <StaggerItem key={alert.log_id}>
                <AlertRow alert={alert} />
              </StaggerItem>
            ))}
          </StaggerList>
        </FadeIn>
      )}
    </div>
  )
}
