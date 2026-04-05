'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock, LogIn, LogOut, CheckCircle, AlertCircle, Loader2,
  History, MapPin, Camera, Shield, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { FadeIn, StaggerList, StaggerItem, AnimatePresence, motion } from '@/components/ui/motion'
import { SuccessBurst } from '@/components/ui/success-burst'
import { playSchoolBell } from '@/lib/sounds'
import { generateDeviceFingerprint } from '@/lib/attendance/device-fingerprint'
import { getCurrentPosition, checkDistance, type GeoResult, type DistanceResult } from '@/lib/attendance/geolocation'
import { startCamera, capturePhoto, stopCamera } from '@/lib/attendance/camera'
import SecurityBadge from '@/components/attendance/SecurityBadge'

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
}

type TodayStatus = 'not_clocked_in' | 'clocked_in' | 'completed'

type AttendanceSettings = {
  attendance_location?: { lat: number; lng: number; radius_meters: number }
  attendance_config?: { require_selfie: boolean; require_geo: boolean; max_shift_hours: number; alert_new_device: boolean }
}

type ClockStep = 'idle' | 'geo' | 'selfie' | 'confirm' | 'submitting'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MiTurnoPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = createClient()

  const [currentTime, setCurrentTime] = useState(new Date())
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [history, setHistory] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showSuccess, setShowSuccess] = useState(false)

  // Security flow state
  const [clockAction, setClockAction] = useState<'in' | 'out' | null>(null)
  const [step, setStep] = useState<ClockStep>('idle')
  const [settings, setSettings] = useState<AttendanceSettings | null>(null)
  const [geoResult, setGeoResult] = useState<GeoResult | null>(null)
  const [distResult, setDistResult] = useState<DistanceResult | null>(null)
  const [selfieData, setSelfieData] = useState<string | null>(null)
  const [deviceFp, setDeviceFp] = useState<string | null>(null)

  // Camera refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const todayStr = format(new Date(), 'yyyy-MM-dd')

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Load settings on mount
  useEffect(() => {
    fetch('/api/attendance/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setSettings(data) })
      .catch(() => {})
  }, [])

  // Device fingerprint
  useEffect(() => {
    setDeviceFp(generateDeviceFingerprint())
  }, [])

  // Fetch attendance
  const fetchAttendance = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const { data: today } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, is_suspicious, suspicious_reasons')
        .eq('user_id', profile.id)
        .eq('operative_date', todayStr)
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setTodayRecord(today)

      const { data: historyData } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, is_suspicious, suspicious_reasons')
        .eq('user_id', profile.id)
        .order('operative_date', { ascending: false })
        .order('clock_in_at', { ascending: false })
        .limit(7)
      setHistory(historyData ?? [])
    } catch (err) {
      console.error('Error al cargar asistencia:', err)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, todayStr])

  useEffect(() => { fetchAttendance() }, [fetchAttendance])

  const getStatus = (): TodayStatus => {
    if (!todayRecord) return 'not_clocked_in'
    if (todayRecord.clock_out_at) return 'completed'
    return 'clocked_in'
  }
  const status = getStatus()

  // -------------------------------------------------------
  // Security flow
  // -------------------------------------------------------

  const startClockFlow = (action: 'in' | 'out') => {
    setClockAction(action)
    setStep('geo')
    setGeoResult(null)
    setDistResult(null)
    setSelfieData(null)
    setCameraReady(false)
    setCameraError(null)

    // Start geo check
    const loc = settings?.attendance_location
    getCurrentPosition().then(geo => {
      setGeoResult(geo)
      if (geo.status === 'success' && geo.lat != null && geo.lng != null && loc) {
        const dist = checkDistance(geo.lat, geo.lng, loc.lat, loc.lng, loc.radius_meters)
        setDistResult(dist)
      }
      // Auto-advance to selfie after 1s
      setTimeout(() => setStep('selfie'), 800)
    })
  }

  // Camera management for selfie step
  useEffect(() => {
    if (step === 'selfie' && videoRef.current) {
      startCamera(videoRef.current).then(result => {
        if (result.status === 'success') setCameraReady(true)
        else setCameraError(result.error ?? 'Cámara no disponible')
      })
    }
    return () => {
      if (step !== 'selfie' && videoRef.current) {
        stopCamera(videoRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const handleCapture = () => {
    if (!videoRef.current) return
    const photo = capturePhoto(videoRef.current)
    if (photo) {
      setSelfieData(photo)
      stopCamera(videoRef.current)
      setStep('confirm')
    }
  }

  const handleSkipSelfie = () => {
    if (videoRef.current) stopCamera(videoRef.current)
    setStep('confirm')
  }

  const handleRetakeSelfie = () => {
    setSelfieData(null)
    setCameraReady(false)
    setStep('selfie')
  }

  const handleSubmit = async () => {
    if (!clockAction) return
    setStep('submitting')

    try {
      const res = await fetch('/api/attendance/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: clockAction,
          lat: geoResult?.lat,
          lng: geoResult?.lng,
          accuracy: geoResult?.accuracy,
          selfie: selfieData,
          deviceFingerprint: deviceFp,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        toast.error(data.error ?? 'Error al fichar')
        setStep('idle')
        setClockAction(null)
        return
      }

      playSchoolBell()
      setShowSuccess(true)

      if (data.anomaly?.is_suspicious) {
        toast.warning('Fichaje registrado con observaciones', {
          description: (data.anomaly.reasons as string[]).map((r: string) => r.split(':')[0]).join(', '),
        })
      } else {
        toast.success(clockAction === 'in' ? '¡Ingreso registrado!' : '¡Egreso registrado!')
      }

      setStep('idle')
      setClockAction(null)
      await fetchAttendance()
    } catch {
      toast.error('Error de conexión')
      setStep('idle')
      setClockAction(null)
    }
  }

  const cancelFlow = () => {
    if (videoRef.current) stopCamera(videoRef.current)
    setStep('idle')
    setClockAction(null)
  }

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------
  function getRecordStatusBadge(record: AttendanceRecord) {
    if (record.is_suspicious) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-[#ea504c]">
          <AlertCircle className="size-3" />
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
    if (record.is_suspicious) return '#ea504c'
    if (record.clock_out_at) return '#006d5a'
    if (record.operative_date === todayStr) return '#d4943a'
    return '#ea504c'
  }

  const geoStatusBadge = !geoResult ? 'grey'
    : distResult?.status === 'verde' ? 'verde'
    : distResult?.status === 'amber' ? 'amber'
    : 'rojo'

  // -------------------------------------------------------
  // Loading
  // -------------------------------------------------------
  if (profileLoading || loading) {
    return <LoadingState message="Cargando tu turno..." />
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-8 pb-28">
      <SuccessBurst show={showSuccess} onComplete={() => setShowSuccess(false)} />

      {/* Hero Clock */}
      <FadeIn className="pt-4 text-center">
        <p className="font-display text-5xl sm:text-7xl font-bold tabular-nums tracking-tight text-[#3d2c24]">
          {format(currentTime, 'HH:mm')}
          <span className="text-2xl sm:text-3xl font-medium text-[#a39e97]">{format(currentTime, ':ss')}</span>
        </p>
        <p className="section-label mt-4">
          {format(currentTime, "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </FadeIn>

      {/* Status Card */}
      <FadeIn delay={0.1}>
        <div
          className="card-elevated-lg relative overflow-hidden px-6 py-10"
          style={{
            borderLeftWidth: '4px',
            borderLeftColor: status === 'clocked_in' ? '#d4943a' : status === 'completed' ? '#006d5a' : 'transparent',
          }}
        >
          {/* NOT CLOCKED IN */}
          {status === 'not_clocked_in' && (
            <div className="flex flex-col items-center gap-6">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-[#f0f7f5]">
                <LogIn className="size-9 text-[#006d5a]" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <p className="font-display text-lg font-semibold text-[#3d2c24]">Buenos dias</p>
                <p className="mt-1 text-sm text-[#a39e97]">No has registrado ingreso hoy.</p>
              </div>
              <Button
                onClick={() => startClockFlow('in')}
                disabled={step !== 'idle'}
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
              </div>
              <Button
                onClick={() => startClockFlow('out')}
                disabled={step !== 'idle'}
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
                      {todayRecord.clock_out_at ? format(new Date(todayRecord.clock_out_at), 'HH:mm') : '--:--'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      {/* ================================================================= */}
      {/* Security Flow Overlay                                              */}
      {/* ================================================================= */}
      <AnimatePresence>
        {step !== 'idle' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={(e) => { if (e.target === e.currentTarget && step !== 'submitting') cancelFlow() }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-lg rounded-t-3xl bg-[#faf8f5] px-5 pb-8 pt-4 shadow-2xl"
            >
              {/* Handle + close */}
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="size-4 text-[#006d5a]" />
                  <span className="text-sm font-semibold text-[#3d2c24]">
                    Verificación — {clockAction === 'in' ? 'Ingreso' : 'Egreso'}
                  </span>
                </div>
                {step !== 'submitting' && (
                  <button onClick={cancelFlow} className="rounded-full p-1.5 hover:bg-[#f5f2ee]">
                    <X className="size-4 text-[#a39e97]" />
                  </button>
                )}
              </div>

              {/* Step indicators */}
              <div className="mb-5 flex items-center justify-center gap-2">
                {['geo', 'selfie', 'confirm'].map((s, i) => {
                  const steps: ClockStep[] = ['geo', 'selfie', 'confirm']
                  const currentIdx = steps.indexOf(step === 'submitting' ? 'confirm' : step)
                  return (
                    <div
                      key={s}
                      className={`h-1.5 w-8 rounded-full transition-colors ${
                        i <= currentIdx ? 'bg-[#006d5a]' : 'bg-[#ebe6df]'
                      }`}
                    />
                  )
                })}
              </div>

              {/* STEP: GEO */}
              {step === 'geo' && (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="flex size-16 items-center justify-center rounded-full bg-[#f0f7f5]">
                    {!geoResult ? (
                      <Loader2 className="size-7 animate-spin text-[#006d5a]" />
                    ) : distResult?.status === 'verde' ? (
                      <MapPin className="size-7 text-[#006d5a]" />
                    ) : (
                      <MapPin className="size-7 text-[#d4943a]" />
                    )}
                  </div>
                  <p className="text-sm text-[#a39e97]">
                    {!geoResult ? 'Verificando ubicación...' : distResult
                      ? `${distResult.distance_m}m del local`
                      : geoResult.error ?? 'Ubicación no disponible'}
                  </p>
                </div>
              )}

              {/* STEP: SELFIE */}
              {step === 'selfie' && (
                <div className="flex flex-col items-center gap-3">
                  <p className="mb-1 text-center text-sm text-[#a39e97]">Sacate una selfie para confirmar tu identidad</p>
                  <div className="relative overflow-hidden rounded-2xl bg-black" style={{ width: 280, height: 210 }}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="h-full w-full object-cover"
                      style={{ transform: 'scaleX(-1)' }}
                    />
                    {!cameraReady && !cameraError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <Loader2 className="size-8 animate-spin text-white" />
                      </div>
                    )}
                  </div>
                  {cameraError ? (
                    <div className="text-center">
                      <p className="text-sm text-[#ea504c]">{cameraError}</p>
                      <button onClick={handleSkipSelfie} className="mt-2 rounded-xl bg-[#f5f2ee] px-4 py-2 text-sm font-medium text-[#3d2c24]">
                        Continuar sin foto
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={handleCapture}
                        disabled={!cameraReady}
                        className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-40"
                      >
                        <Camera className="size-4" />
                        Capturar
                      </button>
                      <button onClick={handleSkipSelfie} className="rounded-xl bg-[#f5f2ee] px-4 py-2.5 text-sm font-medium text-[#3d2c24]">
                        Omitir
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* STEP: CONFIRM */}
              {(step === 'confirm' || step === 'submitting') && (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
                    <p className="text-center text-sm font-semibold text-[#3d2c24]">
                      {clockAction === 'in' ? 'Confirmar Ingreso' : 'Confirmar Egreso'} — {format(new Date(), 'HH:mm')}
                    </p>
                    <div className="mt-3 flex items-center justify-center gap-4">
                      {/* Geo status */}
                      <div className="flex items-center gap-1.5 text-xs">
                        <MapPin className={`size-4 ${geoStatusBadge === 'verde' ? 'text-[#006d5a]' : geoStatusBadge === 'amber' ? 'text-[#d4943a]' : 'text-[#ea504c]'}`} />
                        <span className="text-[#a39e97]">{distResult ? `${distResult.distance_m}m` : 'N/A'}</span>
                      </div>
                      {/* Selfie status */}
                      <div className="flex items-center gap-1.5 text-xs">
                        <Camera className={`size-4 ${selfieData ? 'text-[#006d5a]' : 'text-[#ccc7c0]'}`} />
                        <span className="text-[#a39e97]">{selfieData ? 'OK' : 'Sin foto'}</span>
                      </div>
                      {/* Device */}
                      <div className="flex items-center gap-1.5 text-xs">
                        <Shield className="size-4 text-[#006d5a]" />
                        <span className="text-[#a39e97]">Dispositivo</span>
                      </div>
                    </div>
                    {/* Selfie preview */}
                    {selfieData && (
                      <div className="mt-3 flex justify-center">
                        <div className="relative">
                          <img src={selfieData} alt="Selfie" className="h-16 w-20 rounded-lg object-cover ring-1 ring-[#ebe6df]" />
                          {step === 'confirm' && (
                            <button
                              onClick={handleRetakeSelfie}
                              className="absolute -right-1 -top-1 rounded-full bg-white p-0.5 shadow ring-1 ring-[#ebe6df]"
                            >
                              <X className="size-3 text-[#a39e97]" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={handleSubmit}
                    disabled={step === 'submitting'}
                    className={`h-14 w-full rounded-2xl text-base font-semibold text-white shadow-md active:scale-[0.98] ${
                      clockAction === 'in' ? 'bg-[#006d5a] hover:bg-[#005a4a]' : 'bg-[#d4943a] hover:bg-[#c0852f]'
                    }`}
                  >
                    {step === 'submitting' ? (
                      <Loader2 className="mr-2.5 size-5 animate-spin" />
                    ) : clockAction === 'in' ? (
                      <LogIn className="mr-2.5 size-5" />
                    ) : (
                      <LogOut className="mr-2.5 size-5" />
                    )}
                    {step === 'submitting' ? 'Registrando...' : 'Confirmar Fichaje'}
                  </Button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Section */}
      <FadeIn delay={0.2} className="space-y-4">
        <div className="flex items-center gap-2.5 px-1">
          <History className="size-4 text-[#a39e97]" strokeWidth={1.5} />
          <h2 className="font-display text-lg font-semibold text-[#3d2c24]">Historial reciente</h2>
        </div>

        {history.length === 0 ? (
          <div className="card-elevated flex flex-col items-center gap-2 px-6 py-10 text-center">
            <History className="size-8 text-[#ebe6df]" />
            <p className="text-sm font-medium text-[#a39e97]">Aún no hay registros</p>
            <p className="text-xs text-[#a39e97]/70">¡Marcá tu primer ingreso!</p>
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
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-[#a39e97]">
                      <span className="tabular-nums">{format(new Date(record.clock_in_at), 'HH:mm')}</span>
                      <span className="text-[#ebe6df]">/</span>
                      <span className="tabular-nums">
                        {record.clock_out_at ? format(new Date(record.clock_out_at), 'HH:mm') : '--:--'}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">{getRecordStatusBadge(record)}</div>
                </div>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </FadeIn>
    </div>
  )
}
