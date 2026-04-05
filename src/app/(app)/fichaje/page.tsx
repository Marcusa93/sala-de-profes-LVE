'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
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
  Smartphone,
  ShieldCheck,
  ShieldAlert,
  X,
  ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { FadeIn, StaggerList, StaggerItem, motion, AnimatePresence } from '@/components/ui/motion'
import { SuccessBurst } from '@/components/ui/success-burst'
import { playSchoolBell } from '@/lib/sounds'

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
  clock_out_type?: string | null
}

type TodayStatus = 'not_clocked_in' | 'clocked_in' | 'completed'

type GpsStatus = 'idle' | 'loading' | 'ok' | 'denied' | 'error'

type GpsData = {
  lat: number
  lng: number
  accuracy: number
}

// ---------------------------------------------------------------------------
// Device fingerprint — deterministic, no external service
// ---------------------------------------------------------------------------

function computeDeviceFingerprint(): string {
  if (typeof navigator === 'undefined') return 'ssr'
  const parts = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}`,
    String(screen.colorDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency ?? ''),
  ].join('|')
  let hash = 5381
  for (let i = 0; i < parts.length; i++) {
    hash = ((hash << 5) + hash) ^ parts.charCodeAt(i)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
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
  return msg || 'Ocurrió un error inesperado'
}

function getClockOutTypeLabel(type?: string | null): string | null {
  if (!type || type === 'manual') return null
  if (type === 'auto') return 'Auto'
  if (type === 'edited') return 'Editado'
  return type
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FichajePage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = createClient()

  const [currentTime, setCurrentTime] = useState(new Date())
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [history, setHistory] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showSuccess, setShowSuccess] = useState(false)

  // Anti-trampa modal
  const [modalOpen, setModalOpen] = useState(false)
  const [modalAction, setModalAction] = useState<'in' | 'out'>('in')
  const [submitting, setSubmitting] = useState(false)

  // GPS
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle')
  const [gpsData, setGpsData] = useState<GpsData | null>(null)

  // Device fingerprint (computed once)
  const deviceFp = useRef<string>('')
  useEffect(() => {
    deviceFp.current = computeDeviceFingerprint()
  }, [])

  // Stable todayStr with midnight refresh
  const [todayStr, setTodayStr] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const msUntilMidnight = nextMidnight.getTime() - now.getTime()
    const timer = setTimeout(() => setTodayStr(format(new Date(), 'yyyy-MM-dd')), msUntilMidnight)
    return () => clearTimeout(timer)
  }, [todayStr])

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // ------------------------------------------
  // Fetch attendance
  // ------------------------------------------
  const fetchAttendance = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const { data: today, error: e1 } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, clock_out_type')
        .eq('user_id', profile.id)
        .eq('operative_date', todayStr)
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (e1) throw e1
      setTodayRecord(today)

      const { data: hist, error: e2 } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, clock_out_type')
        .eq('user_id', profile.id)
        .order('operative_date', { ascending: false })
        .order('clock_in_at', { ascending: false })
        .limit(7)
      if (e2) throw e2
      setHistory(hist ?? [])
    } catch (err) {
      console.error('Error al cargar asistencia:', err)
      toast.error('No se pudo cargar tu turno. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, todayStr])

  useEffect(() => {
    fetchAttendance()
  }, [fetchAttendance])

  // ------------------------------------------
  // GPS request
  // ------------------------------------------
  const requestGps = useCallback(() => {
    setGpsStatus('loading')
    setGpsData(null)
    if (!navigator.geolocation) {
      setGpsStatus('error')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsData({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        })
        setGpsStatus('ok')
      },
      (err) => {
        if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
          setGpsStatus('denied')
        } else {
          setGpsStatus('error')
        }
      },
      { timeout: 8000, maximumAge: 30000 },
    )
  }, [])

  // ------------------------------------------
  // Open modal + start GPS
  // ------------------------------------------
  const openModal = (action: 'in' | 'out') => {
    setModalAction(action)
    setModalOpen(true)
    setGpsStatus('loading')
    setGpsData(null)
    // Small delay so modal animation starts before GPS request
    setTimeout(requestGps, 300)
  }

  // ------------------------------------------
  // Submit clock event
  // ------------------------------------------
  const handleSubmit = async () => {
    if (!profile) return
    setSubmitting(true)
    try {
      const notes = JSON.stringify({
        device: deviceFp.current,
        gps: gpsData ?? 'unavailable',
        via: 'fichaje',
      })

      if (modalAction === 'in') {
        const { error } = await supabase.rpc('clock_in', { p_notes: notes })
        if (error) throw error
        toast.success('¡Ingreso registrado!')
      } else {
        const { error } = await supabase.rpc('clock_out', { p_notes: notes })
        if (error) throw error
        toast.success('¡Egreso registrado!')
      }

      playSchoolBell()
      setShowSuccess(true)
      setModalOpen(false)
      await fetchAttendance()
    } catch (err) {
      toast.error(humanizeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ------------------------------------------
  // Derived state
  // ------------------------------------------
  const getStatus = (): TodayStatus => {
    if (!todayRecord) return 'not_clocked_in'
    if (todayRecord.clock_out_at) return 'completed'
    return 'clocked_in'
  }
  const status = getStatus()

  const liveDuration = useMemo(() => {
    if (!todayRecord) return null
    if (status === 'clocked_in') return formatDuration(todayRecord.clock_in_at)
    if (status === 'completed') return formatDuration(todayRecord.clock_in_at, todayRecord.clock_out_at)
    return null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayRecord, status, currentTime])

  const canSubmit = gpsStatus === 'ok' || gpsStatus === 'denied' || gpsStatus === 'error'

  // ------------------------------------------
  // Loading / access
  // ------------------------------------------
  if (profileLoading || loading) return <LoadingState message="Cargando fichaje..." />
  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-8 pb-28">
      <SuccessBurst show={showSuccess} onComplete={() => setShowSuccess(false)} />

      {/* =========================================================== */}
      {/* Hero Clock                                                    */}
      {/* =========================================================== */}
      <FadeIn className="pt-4 text-center">
        <p className="font-display text-5xl sm:text-7xl font-bold tabular-nums tracking-tight text-[#3d2c24]">
          {format(currentTime, 'HH:mm')}
          <span className="text-2xl sm:text-3xl font-medium text-[#a39e97]">
            {format(currentTime, ':ss')}
          </span>
        </p>
        <p className="section-label mt-4">
          {format(currentTime, "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </FadeIn>

      {/* =========================================================== */}
      {/* Status Card                                                   */}
      {/* =========================================================== */}
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
                <p className="mt-1 text-sm text-[#a39e97]">
                  No has registrado ingreso hoy.
                </p>
              </div>
              <Button
                onClick={() => openModal('in')}
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
              </div>
              <Button
                onClick={() => openModal('out')}
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
              <div className="text-center">
                <p className="font-display text-xl font-semibold text-[#006d5a]">
                  Turno completado
                </p>
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
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      {/* =========================================================== */}
      {/* History                                                       */}
      {/* =========================================================== */}
      <FadeIn delay={0.2} className="space-y-4">
        <div className="flex items-center gap-2.5 px-1">
          <History className="size-4 text-[#a39e97]" strokeWidth={1.5} />
          <h2 className="font-display text-lg font-semibold text-[#3d2c24]">
            Historial reciente
          </h2>
        </div>

        {history.length === 0 ? (
          <div className="card-elevated flex flex-col items-center gap-2 px-6 py-10 text-center">
            <History className="size-8 text-[#ebe6df]" />
            <p className="text-sm font-medium text-[#a39e97]">Aún no hay registros</p>
            <p className="text-xs text-[#a39e97]/70">¡Marcá tu primer ingreso!</p>
          </div>
        ) : (
          <StaggerList className="space-y-2.5">
            {history.map((record) => {
              const hasOut = !!record.clock_out_at
              const isToday = record.operative_date === todayStr
              const accentColor = hasOut ? '#006d5a' : isToday ? '#d4943a' : '#ea504c'
              const typeLabel = getClockOutTypeLabel(record.clock_out_type)

              return (
                <StaggerItem key={record.id}>
                  <div
                    className="card-elevated flex items-center gap-4 rounded-xl px-4 py-3.5"
                    style={{ borderLeftWidth: '3px', borderLeftColor: accentColor }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium capitalize text-[#3d2c24]">
                        {format(
                          new Date(record.operative_date + 'T12:00:00'),
                          'EEE d MMM',
                          { locale: es },
                        )}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#a39e97]">
                        <span className="tabular-nums">
                          {format(new Date(record.clock_in_at), 'HH:mm')}
                        </span>
                        <span className="text-[#ebe6df]">/</span>
                        <span className="tabular-nums">
                          {record.clock_out_at
                            ? format(new Date(record.clock_out_at), 'HH:mm')
                            : '--:--'}
                        </span>
                        {hasOut && (
                          <>
                            <span className="text-[#ebe6df]">·</span>
                            <span>{formatDuration(record.clock_in_at, record.clock_out_at)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {/* Status badge */}
                      {hasOut ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f5f1] px-2.5 py-0.5 text-xs font-medium text-[#006d5a]">
                          <CheckCircle className="size-3" />
                          Completado
                        </span>
                      ) : isToday ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf6ec] px-2.5 py-0.5 text-xs font-medium text-[#d4943a]">
                          <Clock className="size-3" />
                          En turno
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-[#ea504c]">
                          <AlertCircle className="size-3" />
                          Sin egreso
                        </span>
                      )}
                      {/* Clock-out type label */}
                      {typeLabel && (
                        <span className="rounded-full bg-[#f3efe9] px-2 py-0.5 text-[10px] font-medium text-[#a39e97]">
                          {typeLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </StaggerItem>
              )
            })}
          </StaggerList>
        )}
      </FadeIn>

      {/* =========================================================== */}
      {/* Anti-trampa modal                                             */}
      {/* =========================================================== */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-[3px]"
              onClick={() => !submitting && setModalOpen(false)}
            />

            {/* Sheet */}
            <motion.div
              className="relative z-10 w-full max-w-lg rounded-t-3xl bg-white px-6 pb-10 pt-5 shadow-2xl"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            >
              {/* Handle */}
              <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[#ebe6df]" />

              {/* Header */}
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h2 className="font-display text-xl font-bold text-[#3d2c24]">
                    {modalAction === 'in' ? 'Marcar Ingreso' : 'Marcar Egreso'}
                  </h2>
                  <p className="mt-0.5 text-sm text-[#a39e97]">
                    Verificando identidad anti-trampa
                  </p>
                </div>
                {!submitting && (
                  <button
                    onClick={() => setModalOpen(false)}
                    className="rounded-full p-1.5 text-[#a39e97] hover:bg-[#f3efe9]"
                  >
                    <X className="size-5" />
                  </button>
                )}
              </div>

              {/* Verification steps */}
              <div className="mb-6 space-y-3">
                {/* GPS Step */}
                <div className="flex items-center gap-4 rounded-xl bg-[#faf8f5] px-4 py-3.5">
                  <div
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor:
                        gpsStatus === 'ok'
                          ? '#e8f5f1'
                          : gpsStatus === 'denied' || gpsStatus === 'error'
                            ? '#fef2f2'
                            : '#f3efe9',
                    }}
                  >
                    {gpsStatus === 'loading' ? (
                      <Loader2 className="size-5 animate-spin text-[#d4943a]" />
                    ) : gpsStatus === 'ok' ? (
                      <MapPin className="size-5 text-[#006d5a]" />
                    ) : gpsStatus === 'denied' || gpsStatus === 'error' ? (
                      <ShieldAlert className="size-5 text-[#ea504c]" />
                    ) : (
                      <MapPin className="size-5 text-[#a39e97]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#3d2c24]">Ubicación GPS</p>
                    <p className="text-xs text-[#a39e97]">
                      {gpsStatus === 'loading' && 'Obteniendo ubicación...'}
                      {gpsStatus === 'ok' && gpsData &&
                        `${gpsData.lat.toFixed(4)}, ${gpsData.lng.toFixed(4)} (±${gpsData.accuracy}m)`}
                      {gpsStatus === 'denied' && 'Permiso denegado — se registrará sin GPS'}
                      {gpsStatus === 'error' && 'No disponible — se registrará sin GPS'}
                      {gpsStatus === 'idle' && 'Esperando...'}
                    </p>
                  </div>
                  {gpsStatus === 'ok' && (
                    <ShieldCheck className="size-5 shrink-0 text-[#006d5a]" />
                  )}
                  {(gpsStatus === 'denied' || gpsStatus === 'error') && (
                    <button
                      onClick={requestGps}
                      className="shrink-0 rounded-lg bg-[#f3efe9] px-2 py-1 text-xs font-medium text-[#3d2c24] hover:bg-[#ebe6df]"
                    >
                      Reintentar
                    </button>
                  )}
                </div>

                {/* Device Step */}
                <div className="flex items-center gap-4 rounded-xl bg-[#faf8f5] px-4 py-3.5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#e8f5f1]">
                    <Smartphone className="size-5 text-[#006d5a]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#3d2c24]">Dispositivo</p>
                    <p className="font-mono text-xs text-[#a39e97]">
                      ID: {deviceFp.current || '...'}
                    </p>
                  </div>
                  <ShieldCheck className="size-5 shrink-0 text-[#006d5a]" />
                </div>
              </div>

              {/* Time display */}
              <div className="mb-6 rounded-xl bg-[#f3efe9] px-4 py-3 text-center">
                <p className="section-label">Hora de fichaje</p>
                <p className="mt-1 font-display text-3xl font-bold tabular-nums text-[#3d2c24]">
                  {format(currentTime, 'HH:mm:ss')}
                </p>
              </div>

              {/* CTA */}
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className={`h-14 w-full rounded-2xl text-base font-semibold text-white shadow-md transition ${
                  modalAction === 'in'
                    ? 'bg-[#006d5a] hover:bg-[#005a4a]'
                    : 'bg-[#d4943a] hover:bg-[#c0852f]'
                } disabled:opacity-50`}
              >
                {submitting ? (
                  <Loader2 className="mr-2 size-5 animate-spin" />
                ) : gpsStatus === 'loading' ? (
                  <>
                    <Loader2 className="mr-2 size-5 animate-spin" />
                    Verificando ubicación...
                  </>
                ) : (
                  <>
                    {modalAction === 'in' ? (
                      <LogIn className="mr-2 size-5" />
                    ) : (
                      <LogOut className="mr-2 size-5" />
                    )}
                    Confirmar {modalAction === 'in' ? 'Ingreso' : 'Egreso'}
                    <ChevronRight className="ml-1 size-4" />
                  </>
                )}
              </Button>

              {gpsStatus === 'loading' && (
                <p className="mt-3 text-center text-xs text-[#a39e97]">
                  Podés confirmar después de obtener la ubicación
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
