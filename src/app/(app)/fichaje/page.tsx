'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  LogIn, LogOut, MapPin, Wifi, Shield,
  CheckCircle, AlertTriangle, XCircle, Loader2,
  Clock, History, Smartphone, RefreshCw, Timer,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { FadeIn, StaggerList, StaggerItem, motion, AnimatePresence } from '@/components/ui/motion'
import { SuccessBurst } from '@/components/ui/success-burst'
import { playSchoolBell } from '@/lib/sounds'
import type { ClockEvent, AnomalyFlag } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ValidationState = 'idle' | 'checking' | 'ok' | 'warn' | 'error'

type ValidationItem = {
  label: string
  state: ValidationState
  detail?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGreeting(date: Date): string {
  const h = date.getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function formatDuration(start: string, end?: string | null): string {
  const from = new Date(start)
  const to = end ? new Date(end) : new Date()
  const diffMs = Math.max(0, to.getTime() - from.getTime())
  const totalMin = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins}m`
}

function humanizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (!msg) return 'Ocurrió un error inesperado'
  if (msg.includes('already') || msg.includes('duplicate') || msg.includes('unique')) {
    return 'Ya registraste tu ingreso hoy'
  }
  if (msg.includes('no open') || msg.includes('not found') || msg.includes('No hay turno')) {
    return 'No hay ingreso abierto para cerrar'
  }
  if (msg.includes('auth') || msg.includes('JWT') || msg.includes('session')) {
    return 'Sesión expirada. Por favor recargá la página'
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Sin conexión. Verificá tu red e intentá de nuevo'
  }
  return msg
}

// ---------------------------------------------------------------------------
// Device fingerprint (browser, async with SHA-256)
// ---------------------------------------------------------------------------

async function getDeviceFingerprint(): Promise<string> {
  const components = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}`,
    String(screen.colorDepth),
    String(new Date().getTimezoneOffset()),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency ?? 0),
  ].join('|')

  try {
    const buffer = new TextEncoder().encode(components)
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    // Fallback if crypto.subtle not available
    return btoa(components).replace(/[^a-z0-9]/gi, '').slice(0, 64)
  }
}

// ---------------------------------------------------------------------------
// Semaphore helpers
// ---------------------------------------------------------------------------

function semaphoreColor(state: ValidationState) {
  switch (state) {
    case 'ok':       return '#006d5a'
    case 'warn':     return '#d4943a'
    case 'error':    return '#ea504c'
    case 'checking': return '#a39e97'
    default:         return '#ebe6df'
  }
}

function SemaphoreIcon({ state }: { state: ValidationState }) {
  if (state === 'checking') return <Loader2 className="size-4 animate-spin text-[#a39e97]" />
  if (state === 'ok')       return <CheckCircle className="size-4 text-[#006d5a]" />
  if (state === 'warn')     return <AlertTriangle className="size-4 text-[#d4943a]" />
  if (state === 'error')    return <XCircle className="size-4 text-[#ea504c]" />
  return <div className="size-4 rounded-full border-2 border-[#ebe6df]" />
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FichajePage() {
  const { profile, loading: profileLoading } = useProfileContext()

  // Clock
  const [currentTime, setCurrentTime] = useState(new Date())

  // Status
  const [status, setStatus] = useState<'clocked_in' | 'clocked_out' | 'no_record' | null>(null)
  const [lastEvent, setLastEvent] = useState<ClockEvent | null>(null)
  const [todayEvents, setTodayEvents] = useState<ClockEvent[]>([])
  const [openAnomalies, setOpenAnomalies] = useState(0)
  const [loadingStatus, setLoadingStatus] = useState(true)

  // Validation states
  const [validations, setValidations] = useState<Record<string, ValidationItem>>({
    gps:    { label: 'GPS / Ubicación', state: 'idle' },
    wifi:   { label: 'Red WiFi',        state: 'idle' },
    device: { label: 'Dispositivo',     state: 'idle' },
  })

  // Captured data
  const [gpsData, setGpsData] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [wifiSSID, setWifiSSID] = useState('')
  const [deviceFingerprint, setDeviceFingerprint] = useState('')

  // Action
  const [actionLoading, setActionLoading] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [anomalyResult, setAnomalyResult] = useState<AnomalyFlag[] | null>(null)

  // -----------------------------------------------------------------------
  // Live clock
  // -----------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // -----------------------------------------------------------------------
  // Live duration (re-computes every second via currentTime)
  // -----------------------------------------------------------------------
  const liveDuration = useMemo(() => {
    if (status !== 'clocked_in' || !lastEvent) return null
    return formatDuration(lastEvent.timestamp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lastEvent, currentTime])

  // -----------------------------------------------------------------------
  // Fetch status
  // -----------------------------------------------------------------------
  const fetchStatus = useCallback(async () => {
    if (!profile) return
    setLoadingStatus(true)
    try {
      const res = await fetch('/api/attendance/status')
      if (res.ok) {
        const data = await res.json()
        setStatus(data.status)
        setLastEvent(data.last_event)
        setTodayEvents(data.today_events ?? [])
        setOpenAnomalies(data.open_anomalies ?? 0)
      }
    } catch { /* silent */ }
    finally { setLoadingStatus(false) }
  }, [profile])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // -----------------------------------------------------------------------
  // Auto-init validations on page load
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!profile) return
    initGPS()
    initDevice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  // -----------------------------------------------------------------------
  // GPS
  // -----------------------------------------------------------------------
  function initGPS() {
    if (!navigator.geolocation) {
      setValidations(v => ({ ...v, gps: { label: 'GPS / Ubicación', state: 'error', detail: 'GPS no disponible en este navegador' } }))
      return
    }

    setValidations(v => ({ ...v, gps: { label: 'GPS / Ubicación', state: 'checking' } }))

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsData({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
        const state: ValidationState = pos.coords.accuracy > 100 ? 'warn' : 'ok'
        setValidations(v => ({
          ...v,
          gps: { label: 'GPS / Ubicación', state, detail: `Precisión: ±${Math.round(pos.coords.accuracy)}m` },
        }))
      },
      (err) => {
        setValidations(v => ({
          ...v,
          gps: { label: 'GPS / Ubicación', state: 'error', detail: err.message },
        }))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  // -----------------------------------------------------------------------
  // Device fingerprint
  // -----------------------------------------------------------------------
  async function initDevice() {
    setValidations(v => ({ ...v, device: { label: 'Dispositivo', state: 'checking' } }))
    try {
      const fp = await getDeviceFingerprint()
      setDeviceFingerprint(fp)
      setValidations(v => ({
        ...v,
        device: { label: 'Dispositivo', state: 'ok', detail: fp.slice(0, 8) + '…' },
      }))
    } catch {
      setValidations(v => ({ ...v, device: { label: 'Dispositivo', state: 'warn', detail: 'No se pudo identificar' } }))
    }
  }

  // -----------------------------------------------------------------------
  // WiFi input
  // -----------------------------------------------------------------------
  function handleWifiInput(ssid: string) {
    setWifiSSID(ssid)
    setValidations(v => ({
      ...v,
      wifi: {
        label: 'Red WiFi',
        state: ssid.trim() ? 'ok' : 'warn',
        detail: ssid.trim() ? ssid : 'No especificada (se anotará como advertencia)',
      },
    }))
  }

  // -----------------------------------------------------------------------
  // Overall readiness
  // -----------------------------------------------------------------------
  function overallState(): ValidationState {
    const states = Object.values(validations).map(v => v.state)
    if (states.some(s => s === 'checking')) return 'checking'
    if (states.some(s => s === 'error')) return 'error'
    if (states.some(s => s === 'warn' || s === 'idle')) return 'warn'
    return 'ok'
  }

  // -----------------------------------------------------------------------
  // Clock In / Out
  // -----------------------------------------------------------------------
  async function handleClockAction(eventType: 'clock_in' | 'clock_out') {
    if (!profile) return
    setActionLoading(true)
    setAnomalyResult(null)

    try {
      const res = await fetch('/api/attendance/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type:         eventType,
          gps_lat:            gpsData?.lat,
          gps_lng:            gpsData?.lng,
          gps_accuracy:       gpsData?.accuracy,
          wifi_ssid:          wifiSSID || undefined,
          device_fingerprint: deviceFingerprint || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(humanizeError(data.error))
        return
      }

      playSchoolBell()
      setShowSuccess(true)

      if (data.anomaly_count > 0) {
        setAnomalyResult(data.anomaly_flags)
        toast.warning(`Fichaje registrado con ${data.anomaly_count} advertencia${data.anomaly_count > 1 ? 's' : ''}`)
      } else {
        toast.success(eventType === 'clock_in' ? '¡Ingreso registrado correctamente!' : '¡Egreso registrado correctamente!')
      }

      await fetchStatus()
    } catch {
      toast.error('Error de conexión')
    } finally {
      setActionLoading(false)
    }
  }

  // -----------------------------------------------------------------------
  // Loading
  // -----------------------------------------------------------------------
  if (profileLoading || loadingStatus) {
    return <LoadingState message="Cargando fichaje..." />
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  const overall = overallState()
  const canClock = overall !== 'checking' && !actionLoading

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-6 pb-28">
      <SuccessBurst show={showSuccess} onComplete={() => setShowSuccess(false)} />

      {/* Hero clock */}
      <FadeIn className="pt-4 text-center">
        <p className="font-display text-5xl font-bold tabular-nums tracking-tight text-[#3d2c24]">
          {format(currentTime, 'HH:mm')}
          <span className="text-2xl font-medium text-[#a39e97]">{format(currentTime, ':ss')}</span>
        </p>
        <p className="section-label mt-2">
          {format(currentTime, "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </FadeIn>

      {/* Semaphore validations */}
      <FadeIn delay={0.05}>
        <div className="card-elevated px-4 py-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="section-label">Validaciones</p>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: semaphoreColor(overall) }} />
              <span className="text-xs font-medium" style={{ color: semaphoreColor(overall) }}>
                {overall === 'ok' ? 'Listo' : overall === 'checking' ? 'Verificando…' : overall === 'warn' ? 'Con advertencias' : 'Requiere atención'}
              </span>
            </div>
          </div>

          {Object.entries(validations).map(([key, v]) => (
            <div key={key} className="flex items-center gap-3">
              <SemaphoreIcon state={v.state} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[#3d2c24]">{v.label}</p>
                {v.detail && <p className="text-[10px] text-[#a39e97] truncate">{v.detail}</p>}
              </div>
              {key === 'gps' && v.state === 'error' && (
                <button onClick={initGPS} className="text-[10px] font-medium text-[#006d5a]">
                  <RefreshCw className="size-3" />
                </button>
              )}
            </div>
          ))}

          {/* WiFi input */}
          <div className="mt-2 flex items-center gap-2">
            <Wifi className="size-4 shrink-0 text-[#a39e97]" />
            <input
              type="text"
              placeholder="Nombre de la red WiFi (ej: LVE_Staff)"
              value={wifiSSID}
              onChange={e => handleWifiInput(e.target.value)}
              className="flex-1 rounded-lg border border-[#ebe6df] bg-[#fefcf9] px-3 py-1.5 text-xs outline-none focus:border-[#006d5a]"
            />
          </div>
        </div>
      </FadeIn>

      {/* Main action card */}
      <FadeIn delay={0.1}>
        <div
          className="card-elevated-lg relative overflow-hidden px-6 py-8"
          style={{
            borderLeftWidth: '4px',
            borderLeftColor:
              status === 'clocked_in' ? '#d4943a' :
              status === 'clocked_out' || status === 'no_record' ? '#006d5a' :
              'transparent',
          }}
        >
          {/* NOT CLOCKED IN / NO RECORD */}
          {(status === 'no_record' || status === 'clocked_out') && (
            <div className="flex flex-col items-center gap-5">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-[#f0f7f5]">
                <LogIn className="size-9 text-[#006d5a]" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <p className="font-display text-lg font-semibold text-[#3d2c24]">
                  {getGreeting(currentTime)}, {profile.first_name}
                </p>
                <p className="mt-1 text-sm text-[#a39e97]">
                  {status === 'clocked_out' ? 'Tu último egreso fue registrado.' : '¿Listo para empezar?'}
                </p>
              </div>

              <Button
                onClick={() => handleClockAction('clock_in')}
                disabled={!canClock}
                className="h-16 w-full rounded-2xl bg-[#006d5a] text-base font-semibold text-white shadow-md hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-60"
              >
                {actionLoading ? <Loader2 className="mr-2.5 size-5 animate-spin" /> : <LogIn className="mr-2.5 size-5" />}
                Marcar Ingreso
              </Button>
            </div>
          )}

          {/* CLOCKED IN */}
          {status === 'clocked_in' && lastEvent && (
            <div className="flex flex-col items-center gap-5">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-[#fdf6ec]">
                <Clock className="size-9 text-[#d4943a]" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <p className="section-label">En turno desde</p>
                <p className="mt-1 font-display text-4xl font-bold tabular-nums text-[#3d2c24]">
                  {format(new Date(lastEvent.timestamp), 'HH:mm')}
                </p>
                {liveDuration && (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#fdf6ec] px-3 py-1">
                    <Timer className="size-3.5 text-[#d4943a]" />
                    <span className="text-sm font-semibold tabular-nums text-[#d4943a]">
                      {liveDuration} trabajando
                    </span>
                  </div>
                )}
                {!lastEvent.verified && (
                  <p className="mt-2 text-xs text-[#d4943a]">⚠️ Ingreso con advertencias de seguridad</p>
                )}
              </div>

              <Button
                onClick={() => handleClockAction('clock_out')}
                disabled={!canClock}
                className="h-16 w-full rounded-2xl bg-[#d4943a] text-base font-semibold text-white shadow-md hover:bg-[#c0852f] active:scale-[0.98] disabled:opacity-60"
              >
                {actionLoading ? <Loader2 className="mr-2.5 size-5 animate-spin" /> : <LogOut className="mr-2.5 size-5" />}
                Marcar Egreso
              </Button>
            </div>
          )}
        </div>
      </FadeIn>

      {/* Anomaly result */}
      <AnimatePresence>
        {anomalyResult && anomalyResult.length > 0 && (
          <motion.div
            className="rounded-2xl border border-[#d4943a]/30 bg-[#fdf6ec] p-4 space-y-2"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-[#d4943a]" />
              <p className="text-sm font-semibold text-[#d4943a]">Fichaje con advertencias</p>
            </div>
            {anomalyResult.map((f, i) => (
              <p key={i} className="text-xs text-[#a39e97]">
                • {f.type === 'gps_out_of_range'  ? 'GPS fuera del rango del local' :
                   f.type === 'wifi_mismatch'      ? 'Red WiFi no reconocida' :
                   f.type === 'unknown_device'     ? 'Dispositivo no registrado (pendiente aprobación)' :
                   f.type === 'rapid_succession'   ? 'Fichaje muy rápido' :
                   f.type === 'unusual_hour'       ? 'Horario inusual' : f.type}
              </p>
            ))}
            <p className="text-[10px] text-[#a39e97]">El encargado revisará estas advertencias.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Open anomalies notice */}
      {openAnomalies > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-[#fdf6ec] border border-[#d4943a]/30 px-4 py-2.5">
          <AlertTriangle className="size-4 text-[#d4943a] shrink-0" />
          <p className="text-xs text-[#d4943a]">
            Tenés {openAnomalies} anomalía{openAnomalies > 1 ? 's' : ''} pendiente{openAnomalies > 1 ? 's' : ''} de revisión
          </p>
        </div>
      )}

      {/* Security info */}
      <FadeIn delay={0.15}>
        <div className="flex items-start gap-3 rounded-xl border border-[#ebe6df] bg-[#fefcf9] px-4 py-3">
          <Shield className="size-4 shrink-0 mt-0.5 text-[#a39e97]" />
          <div>
            <p className="text-xs font-medium text-[#3d2c24]">Sistema anti-trampa activo</p>
            <p className="text-[10px] text-[#a39e97]">
              Se registra: ubicación GPS, red WiFi y dispositivo.
              Cualquier inconsistencia queda registrada para revisión del encargado.
            </p>
          </div>
        </div>
      </FadeIn>

      {/* Today's events */}
      {todayEvents.length > 0 && (
        <FadeIn delay={0.2} className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <History className="size-4 text-[#a39e97]" />
            <h2 className="font-display text-base font-semibold text-[#3d2c24]">Eventos de hoy</h2>
          </div>
          <StaggerList className="space-y-2">
            {todayEvents.map(evt => (
              <StaggerItem key={evt.id}>
                <div
                  className="card-elevated flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{ borderLeftWidth: '3px', borderLeftColor: evt.event_type === 'clock_in' ? '#006d5a' : '#ea504c' }}
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#3d2c24]">
                      {evt.event_type === 'clock_in' ? '🟢 Ingreso' : '🔴 Egreso'}
                    </p>
                    <p className="text-xs text-[#a39e97] tabular-nums">
                      {format(new Date(evt.timestamp), 'HH:mm:ss')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {evt.gps_lat && <MapPin className="size-3.5 text-[#a39e97]" />}
                    {evt.device_fingerprint && <Smartphone className="size-3.5 text-[#a39e97]" />}
                    {evt.verified
                      ? <CheckCircle className="size-3.5 text-[#006d5a]" />
                      : <AlertTriangle className="size-3.5 text-[#d4943a]" />
                    }
                  </div>
                </div>
              </StaggerItem>
            ))}
          </StaggerList>
        </FadeIn>
      )}
    </div>
  )
}
