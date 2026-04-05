'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock,
  LogIn,
  LogOut,
  CheckCircle,
  AlertCircle,
  Loader2,
  History,
  Timer,
  MapPin,
  Camera,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { SuccessBurst } from '@/components/ui/success-burst'
import { playSchoolBell } from '@/lib/sounds'
import SelfieCapture from '@/components/attendance/SelfieCapture'
import {
  getGeolocation,
  getDeviceFingerprint,
  getNetworkInfo,
  haversineDistance,
  type VenueConfig,
  type GeoResult,
} from '@/lib/attendance/security'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttendanceRecord = {
  id: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  status: 'open' | 'closed' | 'missing_checkout'
  notes: string | null
  is_suspicious?: boolean
  suspicious_reasons?: string[]
  clock_in_selfie_url?: string | null
  clock_out_selfie_url?: string | null
}

type TodayStatus = 'not_clocked_in' | 'clocked_in' | 'completed'

type CheckStep = {
  id: string
  label: string
  status: 'pending' | 'loading' | 'ok' | 'warn' | 'error'
  detail?: string
}

type FlowState = 'idle' | 'security_check' | 'selfie' | 'submitting' | 'done'

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

// ---------------------------------------------------------------------------
// Componente de paso de seguridad individual
// ---------------------------------------------------------------------------

function SecurityStep({ step }: { step: CheckStep }) {
  const icons: Record<CheckStep['status'], React.ReactNode> = {
    pending: <div className="size-4 rounded-full border-2 border-[#ebe6df]" />,
    loading: <Loader2 className="size-4 animate-spin text-[#d4943a]" />,
    ok:      <CheckCircle className="size-4 text-[#006d5a]" />,
    warn:    <AlertCircle className="size-4 text-[#d4943a]" />,
    error:   <AlertCircle className="size-4 text-[#ea504c]" />,
  }

  const rowBg: Record<CheckStep['status'], string> = {
    pending: '',
    loading: 'bg-[#fdf6ec]',
    ok:      'bg-[#e8f5f1]',
    warn:    'bg-[#fdf6ec]',
    error:   'bg-red-50',
  }

  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-2.5 transition-colors ${rowBg[step.status]}`}>
      <div className="shrink-0">{icons[step.status]}</div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#3d2c24]">{step.label}</p>
        {step.detail && (
          <p className="text-xs text-[#a39e97]">{step.detail}</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page principal
// ---------------------------------------------------------------------------

export default function MiTurnoPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = createClient()

  const [currentTime, setCurrentTime] = useState(new Date())
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [history, setHistory] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Config del local
  const [venueConfig, setVenueConfig] = useState<VenueConfig | null>(null)

  // Flujo de fichaje
  const [flowAction, setFlowAction] = useState<'in' | 'out' | null>(null)
  const [flowState, setFlowState] = useState<FlowState>('idle')
  const [steps, setSteps] = useState<CheckStep[]>([])
  const [geoResult, setGeoResult] = useState<GeoResult | null>(null)

  // Stable todayStr that only changes at midnight
  const [todayStr, setTodayStr] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const msUntilMidnight = nextMidnight.getTime() - now.getTime()
    const timer = setTimeout(() => {
      setTodayStr(format(new Date(), 'yyyy-MM-dd'))
    }, msUntilMidnight)
    return () => clearTimeout(timer)
  }, [todayStr])

  // ------------------------------------------
  // Live clock
  // ------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // ------------------------------------------
  // Fetch venue config from settings
  // ------------------------------------------
  useEffect(() => {
    fetch('/api/attendance/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.attendance_location) {
          setVenueConfig({
            venue_lat: data.attendance_location.lat,
            venue_lng: data.attendance_location.lng,
            geo_radius_m: data.attendance_location.radius_meters ?? 150,
            require_photo: data.attendance_config?.require_selfie ?? true,
          })
        }
      })
      .catch(() => {})
  }, [])

  // ------------------------------------------
  // Fetch attendance data
  // ------------------------------------------
  const fetchAttendance = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const { data: today } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, is_suspicious, suspicious_reasons, clock_in_selfie_url, clock_out_selfie_url')
        .eq('user_id', profile.id)
        .eq('operative_date', todayStr)
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setTodayRecord(today as unknown as AttendanceRecord | null)

      const { data: historyData } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, is_suspicious, suspicious_reasons')
        .eq('user_id', profile.id)
        .order('operative_date', { ascending: false })
        .order('clock_in_at', { ascending: false })
        .limit(7)
      setHistory((historyData ?? []) as unknown as AttendanceRecord[])
    } catch (err) {
      console.error('Error al cargar asistencia:', err)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, todayStr])

  useEffect(() => { fetchAttendance() }, [fetchAttendance])

  // ------------------------------------------
  // Helpers
  // ------------------------------------------
  const getStatus = (): TodayStatus => {
    if (!todayRecord) return 'not_clocked_in'
    if (todayRecord.clock_out_at) return 'completed'
    return 'clocked_in'
  }
  const status = getStatus()

  // Live duration
  const liveDuration = useMemo(() => {
    if (!todayRecord) return null
    if (status === 'clocked_in') return formatDuration(todayRecord.clock_in_at)
    if (status === 'completed') return formatDuration(todayRecord.clock_in_at, todayRecord.clock_out_at)
    return null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayRecord, status, currentTime])

  function setStepStatus(id: string, st: CheckStep['status'], detail?: string) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status: st, detail } : s))
  }

  // ------------------------------------------
  // Iniciar flujo de fichaje
  // ------------------------------------------
  const startFlow = (action: 'in' | 'out') => {
    setFlowAction(action)
    setGeoResult(null)
    setSteps([
      { id: 'geo',   label: 'Verificando ubicación',  status: 'pending' },
      { id: 'wifi',  label: 'Detectando red',          status: 'pending' },
      { id: 'dev',   label: 'Registrando dispositivo', status: 'pending' },
      { id: 'photo', label: 'Selfie de verificación',  status: 'pending' },
    ])
    setFlowState('security_check')
    runSecurityChecks()
  }

  // ------------------------------------------
  // Ejecutar chequeos de seguridad
  // ------------------------------------------
  const runSecurityChecks = useCallback(async () => {
    // --- Geolocalización ---
    setStepStatus('geo', 'loading')
    try {
      const geoData = await getGeolocation(10000)
      setGeoResult(geoData)
      if (venueConfig) {
        const dist = haversineDistance(
          geoData.lat, geoData.lng,
          venueConfig.venue_lat, venueConfig.venue_lng,
        )
        const geoOk = dist <= venueConfig.geo_radius_m
        setStepStatus('geo', geoOk ? 'ok' : 'warn',
          geoOk
            ? `A ${dist}m del local`
            : `A ${dist}m del local (máx. ${venueConfig.geo_radius_m}m)`,
        )
      } else {
        setStepStatus('geo', 'ok', `Precisión: ${Math.round(geoData.accuracy)}m`)
      }
    } catch (err) {
      setStepStatus('geo', 'warn', err instanceof Error ? err.message : 'No se pudo obtener ubicación')
    }

    // --- Red ---
    setStepStatus('wifi', 'loading')
    await new Promise(r => setTimeout(r, 400))
    const net = getNetworkInfo()
    if (net.effectiveType) {
      setStepStatus('wifi', 'ok', `Conexión: ${net.effectiveType}`)
    } else {
      setStepStatus('wifi', 'warn', 'No se pudo detectar red')
    }

    // --- Dispositivo ---
    setStepStatus('dev', 'loading')
    await new Promise(r => setTimeout(r, 200))
    const dev = getDeviceFingerprint()
    setStepStatus('dev', 'ok', `ID: ${dev.id}`)

    // --- Foto (esperar en siguiente pantalla) ---
    setStepStatus('photo', 'pending', 'Pendiente')

    await new Promise(r => setTimeout(r, 600))
    setFlowState('selfie')
    setStepStatus('photo', 'loading', 'Pendiente tu selfie')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueConfig])

  // ------------------------------------------
  // Selfie capturada → enviar fichaje
  // ------------------------------------------
  const handleSelfieDone = useCallback(async (dataUrl: string) => {
    setStepStatus('photo', 'ok', 'Selfie capturada')
    await submitClock(dataUrl)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoResult, flowAction])

  // ------------------------------------------
  // Enviar fichaje al servidor
  // ------------------------------------------
  const submitClock = useCallback(async (selfieDataUrl?: string) => {
    if (!flowAction) return
    setFlowState('submitting')

    try {
      const dev = getDeviceFingerprint()

      const response = await fetch('/api/attendance/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: flowAction,
          lat: geoResult?.lat ?? null,
          lng: geoResult?.lng ?? null,
          accuracy: geoResult?.accuracy ?? null,
          selfie: selfieDataUrl ?? null,
          deviceFingerprint: dev.id,
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        toast.error(data.error ?? 'Error al fichar')
        setFlowState('idle')
        return
      }

      playSchoolBell()
      setShowSuccess(true)
      setFlowState('done')

      if (data.anomaly?.is_suspicious) {
        toast.warning('Fichaje registrado con observaciones', {
          description: (data.anomaly.reasons as string[]).map((r: string) => r.split(':')[0]).join(', '),
        })
      } else {
        toast.success(flowAction === 'in' ? '¡Ingreso registrado!' : '¡Egreso registrado!')
      }

      await fetchAttendance()
      setTimeout(() => {
        setFlowState('idle')
        setFlowAction(null)
      }, 2000)
    } catch {
      toast.error('Error de conexión')
      setFlowState('idle')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowAction, geoResult, fetchAttendance])

  const cancelFlow = () => {
    setFlowState('idle')
    setFlowAction(null)
  }

  // ------------------------------------------
  // Status badge helper
  // ------------------------------------------
  function getRecordStatusBadge(record: AttendanceRecord) {
    if (record.is_suspicious) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          <ShieldAlert className="size-3" />
          Sospechoso
        </span>
      )
    }
    if (record.clock_out_at) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f5f1] px-2.5 py-0.5 text-xs font-medium text-[#006d5a]">
          <CheckCircle className="size-3" />
          Completado
        </span>
      )
    }
    if (record.operative_date === todayStr) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf6ec] px-2.5 py-0.5 text-xs font-medium text-[#d4943a]">
          <Clock className="size-3" />
          En turno
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-[#ea504c]">
        <AlertCircle className="size-3" />
        Sin egreso
      </span>
    )
  }

  function getRecordAccentColor(record: AttendanceRecord): string {
    if (record.is_suspicious) return '#d4943a'
    if (record.clock_out_at) return '#006d5a'
    if (record.operative_date === todayStr) return '#d4943a'
    return '#ea504c'
  }

  // ------------------------------------------
  // Loading state
  // ------------------------------------------
  if (profileLoading || loading) return <LoadingState message="Cargando tu turno..." />
  if (!profile) return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-muted-foreground">No se pudo cargar el perfil.</p>
    </div>
  )

  // ------------------------------------------
  // Render: flujo de seguridad activo
  // ------------------------------------------
  if (flowState !== 'idle' && flowState !== 'done') {
    return (
      <div className="mx-auto max-w-lg space-y-6 pb-28 pt-4">
        {/* Header */}
        <FadeIn className="text-center">
          <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-[#f0f7f5]">
            <Shield className="size-8 text-[#006d5a]" strokeWidth={1.5} />
          </div>
          <h2 className="font-display text-xl font-bold text-[#3d2c24]">
            {flowAction === 'in' ? 'Verificando ingreso' : 'Verificando egreso'}
          </h2>
          <p className="mt-1 text-sm text-[#a39e97]">
            Necesitamos confirmar que estás en el local
          </p>
        </FadeIn>

        {/* Pasos de seguridad */}
        <FadeIn delay={0.1} className="card-elevated space-y-1 p-3">
          {steps.map(s => (
            <SecurityStep key={s.id} step={s} />
          ))}
        </FadeIn>

        {/* Selfie */}
        {flowState === 'selfie' && (
          <FadeIn delay={0.2} className="card-elevated p-5">
            <h3 className="mb-4 font-display text-base font-semibold text-[#3d2c24]">
              Selfie de verificación
            </h3>
            <SelfieCapture
              onCapture={handleSelfieDone}
              required={venueConfig?.require_photo ?? true}
              onSkip={venueConfig?.require_photo ? undefined : () => submitClock()}
            />
          </FadeIn>
        )}

        {flowState === 'submitting' && (
          <FadeIn className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="size-8 animate-spin text-[#006d5a]" />
            <p className="text-sm font-medium text-[#a39e97]">Registrando fichaje...</p>
          </FadeIn>
        )}

        {/* Cancelar */}
        {flowState !== 'submitting' && (
          <button
            onClick={cancelFlow}
            className="w-full text-center text-sm text-[#a39e97] underline underline-offset-2"
          >
            Cancelar
          </button>
        )}
      </div>
    )
  }

  // ------------------------------------------
  // Render: pantalla principal
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-8 pb-28">
      <SuccessBurst show={showSuccess} onComplete={() => setShowSuccess(false)} />

      {/* ============================================================= */}
      {/* Hero Clock                                                      */}
      {/* ============================================================= */}
      <FadeIn className="pt-4 text-center">
        <p className="font-display text-5xl sm:text-7xl font-bold tabular-nums tracking-tight text-[#3d2c24]">
          {format(currentTime, 'HH:mm')}
          <span className="text-2xl sm:text-3xl font-medium text-[#a39e97]">{format(currentTime, ':ss')}</span>
        </p>
        <p className="section-label mt-4">
          {format(currentTime, "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </FadeIn>

      {/* ============================================================= */}
      {/* Status Card                                                     */}
      {/* ============================================================= */}
      <FadeIn delay={0.1}>
        <div
          className="card-elevated-lg relative overflow-hidden px-6 py-10"
          style={{
            borderLeftWidth: '4px',
            borderLeftColor:
              status === 'clocked_in'
                ? '#d4943a'
                : status === 'completed'
                  ? '#006d5a'
                  : 'transparent',
          }}
        >
          {/* NOT CLOCKED IN */}
          {status === 'not_clocked_in' && (
            <div className="flex flex-col items-center gap-6">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-[#f0f7f5]">
                <LogIn className="size-9 text-[#006d5a]" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <p className="font-display text-lg font-semibold text-[#3d2c24]">
                  {getGreeting(currentTime)}
                </p>
                <p className="mt-1 text-sm text-[#a39e97]">No has registrado ingreso hoy.</p>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-[#e8f5f1] px-3 py-1.5 text-xs text-[#006d5a]">
                <ShieldCheck className="size-3.5" />
                <span>Fichaje verificado: ubicación + selfie</span>
              </div>
              <Button
                onClick={() => startFlow('in')}
                className="h-16 w-full rounded-2xl bg-[#006d5a] text-base font-semibold text-white shadow-md hover:bg-[#005a4a] active:scale-[0.98]"
              >
                <LogIn className="mr-2.5 size-5" />
                Marcar Ingreso
              </Button>
            </div>
          )}

          {/* CLOCKED IN */}
          {status === 'clocked_in' && todayRecord && (
            <div className="flex flex-col items-center gap-6">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-[#fdf6ec]">
                <Clock className="size-9 text-[#d4943a]" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <p className="section-label">Ingreso registrado</p>
                <p className="mt-2 font-display text-4xl font-bold tabular-nums text-[#3d2c24]">
                  {format(new Date(todayRecord.clock_in_at), 'HH:mm')}
                </p>
                {liveDuration && (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#fdf6ec] px-3 py-1">
                    <Timer className="size-3.5 text-[#d4943a]" />
                    <span className="text-sm font-semibold tabular-nums text-[#d4943a]">
                      {liveDuration} trabajando
                    </span>
                  </div>
                )}
                {/* Indicadores de seguridad */}
                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className={`flex items-center gap-1 text-xs ${todayRecord.clock_in_selfie_url ? 'text-[#006d5a]' : 'text-[#d4943a]'}`}>
                    <Camera className="size-3" />
                    {todayRecord.clock_in_selfie_url ? 'Foto ✓' : 'Sin foto'}
                  </span>
                  {todayRecord.is_suspicious && (
                    <>
                      <span className="text-[#ebe6df]">·</span>
                      <span className="flex items-center gap-1 text-xs text-amber-600">
                        <ShieldAlert className="size-3" />
                        Con advertencias
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Button
                onClick={() => startFlow('out')}
                className="h-16 w-full rounded-2xl bg-[#d4943a] text-base font-semibold text-white shadow-md hover:bg-[#c0852f] active:scale-[0.98]"
              >
                <LogOut className="mr-2.5 size-5" />
                Marcar Egreso
              </Button>
            </div>
          )}

          {/* COMPLETED */}
          {status === 'completed' && todayRecord && (
            <div className="flex flex-col items-center gap-6">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-[#e8f5f1]">
                <CheckCircle className="size-9 text-[#006d5a]" strokeWidth={1.5} />
              </div>
              <div className="w-full text-center">
                <p className="font-display text-xl font-semibold text-[#006d5a]">Turno completado</p>
                <div className="mt-6 flex items-center justify-center gap-8">
                  <div className="text-center">
                    <p className="section-label">Ingreso</p>
                    <p className="mt-1 font-display text-3xl font-bold tabular-nums text-[#3d2c24]">
                      {format(new Date(todayRecord.clock_in_at), 'HH:mm')}
                    </p>
                  </div>
                  <div className="h-12 w-px bg-[#ebe6df]" />
                  <div className="text-center">
                    <p className="section-label">Egreso</p>
                    <p className="mt-1 font-display text-3xl font-bold tabular-nums text-[#3d2c24]">
                      {todayRecord.clock_out_at
                        ? format(new Date(todayRecord.clock_out_at), 'HH:mm')
                        : '--:--'}
                    </p>
                  </div>
                </div>
                {liveDuration && (
                  <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#e8f5f1] px-3 py-1">
                    <Timer className="size-3.5 text-[#006d5a]" />
                    <span className="text-sm font-semibold tabular-nums text-[#006d5a]">
                      {liveDuration} trabajados
                    </span>
                  </div>
                )}
                {/* Indicadores de verificación */}
                <div className="mt-4 flex items-center justify-center gap-3">
                  {todayRecord.clock_in_selfie_url && (
                    <span className="flex items-center gap-1 text-xs text-[#006d5a]">
                      <Camera className="size-3" /> Foto guardada
                    </span>
                  )}
                  {todayRecord.is_suspicious && (
                    <span className="flex items-center gap-1 text-xs text-amber-600">
                      <ShieldAlert className="size-3" /> Con advertencias
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      {/* ============================================================= */}
      {/* Historial                                                       */}
      {/* ============================================================= */}
      <FadeIn delay={0.2} className="space-y-4">
        <button
          onClick={() => setShowHistory(v => !v)}
          className="flex w-full items-center gap-2.5 px-1"
        >
          <History className="size-4 text-[#a39e97]" strokeWidth={1.5} />
          <h2 className="font-display text-lg font-semibold text-[#3d2c24]">Historial reciente</h2>
          <div className="ml-auto">
            {showHistory
              ? <ChevronUp className="size-4 text-[#a39e97]" />
              : <ChevronDown className="size-4 text-[#a39e97]" />
            }
          </div>
        </button>

        {showHistory && (
          history.length === 0 ? (
            <div className="card-elevated flex flex-col items-center gap-2 px-6 py-10 text-center">
              <History className="size-8 text-[#ebe6df]" />
              <p className="text-sm font-medium text-[#a39e97]">Aún no hay registros</p>
            </div>
          ) : (
            <StaggerList className="space-y-2.5">
              {history.map((record) => (
                <StaggerItem key={record.id}>
                  <div
                    className="card-elevated flex items-center gap-4 rounded-xl px-4 py-3.5"
                    style={{ borderLeftWidth: '3px', borderLeftColor: getRecordAccentColor(record) }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium capitalize text-[#3d2c24]">
                        {format(new Date(record.operative_date + 'T12:00:00'), 'EEE d MMM', { locale: es })}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#a39e97]">
                        <span className="tabular-nums">{format(new Date(record.clock_in_at), 'HH:mm')}</span>
                        <span className="text-[#ebe6df]">/</span>
                        <span className="tabular-nums">
                          {record.clock_out_at ? format(new Date(record.clock_out_at), 'HH:mm') : '--:--'}
                        </span>
                        {record.clock_out_at && (
                          <>
                            <span className="text-[#ebe6df]">·</span>
                            <span>{formatDuration(record.clock_in_at, record.clock_out_at)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">{getRecordStatusBadge(record)}</div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerList>
          )
        )}
      </FadeIn>
    </div>
  )
}
