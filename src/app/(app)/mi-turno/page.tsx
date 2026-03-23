'use client'

import { useEffect, useState, useCallback } from 'react'
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
  MapPin,
  MapPinOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { FadeIn, StaggerList, StaggerItem, ScalePress, PulseRing, AnimatePresence, motion } from '@/components/ui/motion'
import { SuccessBurst } from '@/components/ui/success-burst'
import { playSchoolBell } from '@/lib/sounds'

// ---------------------------------------------------------------------------
// Geolocation constants
// ---------------------------------------------------------------------------

const RESTAURANT_LOCATION = { lat: -26.8241, lng: -65.2226 }
const MAX_DISTANCE_METERS = 150

/**
 * Calculate distance between two GPS coordinates using the Haversine formula.
 * Returns distance in meters.
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000 // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

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
}

type TodayStatus = 'not_clocked_in' | 'clocked_in' | 'completed'

// ---------------------------------------------------------------------------
// Clock In/Out Page
// ---------------------------------------------------------------------------

export default function MiTurnoPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = createClient()

  const [currentTime, setCurrentTime] = useState(new Date())
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [history, setHistory] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [geoStatus, setGeoStatus] = useState<'unknown' | 'checking' | 'in_range' | 'out_of_range' | 'error'>('unknown')
  const [geoLoading, setGeoLoading] = useState(false)

  const todayStr = format(new Date(), 'yyyy-MM-dd')

  // ------------------------------------------
  // Live clock
  // ------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // ------------------------------------------
  // Fetch attendance data
  // ------------------------------------------
  const fetchAttendance = useCallback(async () => {
    if (!profile) return
    setLoading(true)

    try {
      // Today's record
      const { data: today } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes')
        .eq('user_id', profile.id)
        .eq('operative_date', todayStr)
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      setTodayRecord(today)

      // Last 7 records (history)
      const { data: historyData } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes')
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

  useEffect(() => {
    fetchAttendance()
  }, [fetchAttendance])

  // ------------------------------------------
  // Determine status
  // ------------------------------------------
  const getStatus = (): TodayStatus => {
    if (!todayRecord) return 'not_clocked_in'
    if (todayRecord.clock_out_at) return 'completed'
    return 'clocked_in'
  }

  const status = getStatus()

  // ------------------------------------------
  // Geolocation verification helper
  // ------------------------------------------
  const verifyLocation = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        toast.error('Necesitás activar la ubicación para fichar')
        setGeoStatus('error')
        resolve(false)
        return
      }

      setGeoLoading(true)
      setGeoStatus('checking')

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const distance = haversineDistance(
            position.coords.latitude,
            position.coords.longitude,
            RESTAURANT_LOCATION.lat,
            RESTAURANT_LOCATION.lng,
          )

          if (distance <= MAX_DISTANCE_METERS) {
            setGeoStatus('in_range')
            setGeoLoading(false)
            resolve(true)
          } else {
            setGeoStatus('out_of_range')
            setGeoLoading(false)
            toast.error(
              'Estás fuera del rango del local. Acercate a La Vieja Escuela para fichar.',
            )
            resolve(false)
          }
        },
        () => {
          setGeoStatus('error')
          setGeoLoading(false)
          toast.error('Necesitás activar la ubicación para fichar')
          resolve(false)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      )
    })
  }

  // ------------------------------------------
  // Clock In (with geolocation check)
  // ------------------------------------------
  const handleClockIn = async () => {
    if (!profile) return
    setActionLoading(true)

    try {
      const locationOk = await verifyLocation()
      if (!locationOk) {
        setActionLoading(false)
        return
      }

      const { error } = await supabase.rpc('clock_in')

      if (error) throw error

      playSchoolBell()
      setShowSuccess(true)
      toast.success('Ingreso registrado correctamente')
      await fetchAttendance()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al marcar ingreso'
      toast.error('Error al registrar ingreso', { description: message })
    } finally {
      setActionLoading(false)
    }
  }

  // ------------------------------------------
  // Clock Out
  // ------------------------------------------
  const handleClockOut = async () => {
    if (!profile || !todayRecord) return
    setActionLoading(true)

    try {
      const { error } = await supabase.rpc('clock_out')

      if (error) throw error

      playSchoolBell()
      setShowSuccess(true)
      toast.success('Egreso registrado correctamente')
      await fetchAttendance()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al marcar egreso'
      toast.error('Error al registrar egreso', { description: message })
    } finally {
      setActionLoading(false)
    }
  }

  // ------------------------------------------
  // Status badge helper
  // ------------------------------------------
  function getRecordStatusBadge(record: AttendanceRecord) {
    if (record.clock_out_at) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f5f1] px-2.5 py-0.5 text-xs font-medium text-[#006d5a]">
          <CheckCircle className="size-3" />
          Completado
        </span>
      )
    }

    // Check if it's today
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

  // ------------------------------------------
  // Accent color for history row left bar
  // ------------------------------------------
  function getRecordAccentColor(record: AttendanceRecord): string {
    if (record.clock_out_at) return '#006d5a'
    if (record.operative_date === todayStr) return '#d4943a'
    return '#ea504c'
  }

  // ------------------------------------------
  // Loading state
  // ------------------------------------------
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

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-8 pb-28">
      <SuccessBurst show={showSuccess} onComplete={() => setShowSuccess(false)} />
      {/* ============================================================= */}
      {/* Hero Clock — Ceremonial, display-driven                        */}
      {/* ============================================================= */}
      <FadeIn className="pt-4 text-center">
        <p className="font-display text-7xl font-bold tabular-nums tracking-tight text-[#3d2c24]">
          {format(currentTime, 'HH:mm')}
        </p>
        <p className="font-display text-2xl font-medium tabular-nums text-[#a39e97]">
          {format(currentTime, ':ss')}
        </p>
        <p className="section-label mt-4">
          {format(currentTime, "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </FadeIn>

      {/* ============================================================= */}
      {/* Status Card — card-elevated-lg, accent bar                     */}
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
                Buenos dias
              </p>
              <p className="mt-1 text-sm text-[#a39e97]">
                No has registrado ingreso hoy.
              </p>
            </div>
            <Button
              onClick={handleClockIn}
              disabled={actionLoading || geoLoading}
              className="h-16 w-full rounded-2xl bg-[#006d5a] text-base font-semibold text-white shadow-md hover:bg-[#005a4a] active:scale-[0.98]"
            >
              {actionLoading || geoLoading ? (
                <Loader2 className="mr-2.5 size-5 animate-spin" />
              ) : (
                <LogIn className="mr-2.5 size-5" />
              )}
              {geoLoading ? 'Verificando ubicación...' : 'Marcar Ingreso'}
            </Button>

            {/* Location status badge */}
            <div className="flex items-center justify-center">
              {geoStatus === 'checking' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f0e8] px-3 py-1 text-xs font-medium text-[#a39e97]">
                  <Loader2 className="size-3 animate-spin" />
                  Verificando ubicación...
                </span>
              )}
              {geoStatus === 'in_range' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f5f1] px-3 py-1 text-xs font-medium text-[#006d5a]">
                  <MapPin className="size-3" />
                  Dentro del rango del local
                </span>
              )}
              {geoStatus === 'out_of_range' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-[#ea504c]">
                  <MapPinOff className="size-3" />
                  Fuera del rango del local
                </span>
              )}
              {geoStatus === 'error' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-[#ea504c]">
                  <MapPinOff className="size-3" />
                  Ubicación no disponible
                </span>
              )}
              {geoStatus === 'unknown' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f0e8] px-3 py-1 text-xs font-medium text-[#a39e97]">
                  <MapPin className="size-3" />
                  Se verificará tu ubicación al fichar
                </span>
              )}
            </div>
          </div>
        )}

        {/* CLOCKED IN - needs clock out */}
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
              onClick={handleClockOut}
              disabled={actionLoading}
              className="h-16 w-full rounded-2xl bg-[#d4943a] text-base font-semibold text-white shadow-md hover:bg-[#c0852f] active:scale-[0.98]"
            >
              {actionLoading ? (
                <Loader2 className="mr-2.5 size-5 animate-spin" />
              ) : (
                <LogOut className="mr-2.5 size-5" />
              )}
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
            </div>
          </div>
        )}
      </div>
      </FadeIn>

      {/* ============================================================= */}
      {/* History Section                                                 */}
      {/* ============================================================= */}
      <FadeIn delay={0.2} className="space-y-4">
        <div className="flex items-center gap-2.5 px-1">
          <History className="size-4 text-[#a39e97]" strokeWidth={1.5} />
          <h2 className="font-display text-lg font-semibold text-[#3d2c24]">
            Historial reciente
          </h2>
        </div>

        {history.length === 0 ? (
          <div className="card-elevated px-6 py-10 text-center">
            <p className="text-sm text-[#a39e97]">
              No hay registros de asistencia.
            </p>
          </div>
        ) : (
          <StaggerList className="space-y-2.5">
            {history.map((record) => (
              <StaggerItem key={record.id}>
              <div
                className="card-elevated flex items-center gap-4 px-4 py-3.5"
                style={{
                  borderLeftWidth: '3px',
                  borderLeftColor: getRecordAccentColor(record),
                }}
              >
                {/* Date */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium capitalize text-[#3d2c24]">
                    {format(
                      new Date(record.operative_date + 'T12:00:00'),
                      'EEE d MMM',
                      { locale: es },
                    )}
                  </p>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-[#a39e97]">
                    <span className="tabular-nums">
                      {format(new Date(record.clock_in_at), 'HH:mm')}
                    </span>
                    <span className="text-[#ebe6df]">/</span>
                    <span className="tabular-nums">
                      {record.clock_out_at
                        ? format(new Date(record.clock_out_at), 'HH:mm')
                        : '--:--'}
                    </span>
                  </div>
                </div>

                {/* Badge */}
                <div className="shrink-0">
                  {getRecordStatusBadge(record)}
                </div>
              </div>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </FadeIn>
    </div>
  )
}
