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
} from 'lucide-react'
import { toast } from 'sonner'
import { errorToast } from '@/lib/toast-helpers'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { mustClockIn } from '@/lib/roles'
import { createClient } from '@/lib/supabase/client'
import { FadeIn, StaggerList, StaggerItem, ScalePress, PulseRing, AnimatePresence, motion } from '@/components/ui/motion'
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

  const todayStr = format(new Date(), 'yyyy-MM-dd')

  // ------------------------------------------
  // Live clock — pausa cuando la pestaña no está visible
  //              (evita drenar batería si la app queda abierta).
  // ------------------------------------------
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (interval) return
      setCurrentTime(new Date())
      interval = setInterval(() => setCurrentTime(new Date()), 1000)
    }
    const stop = () => {
      if (interval) clearInterval(interval)
      interval = null
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else start()
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
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
  // Clock In — optimistic UI
  // ------------------------------------------
  const handleClockIn = async () => {
    if (!profile) return
    const previous = todayRecord
    // Optimistic update
    const optimistic: AttendanceRecord = {
      id: '__optimistic__',
      operative_date: todayStr,
      clock_in_at: new Date().toISOString(),
      clock_out_at: null,
      status: 'open',
      notes: null,
    }
    setTodayRecord(optimistic)
    playSchoolBell()
    setShowSuccess(true)
    setActionLoading(true)
    try {
      const { error } = await supabase.rpc('clock_in', { p_notes: undefined })
      if (error) throw error
      toast.success('¡Ingreso registrado!')
      await fetchAttendance()
    } catch (err) {
      setTodayRecord(previous)
      errorToast('No pudimos registrar tu ingreso', err, { retry: handleClockIn })
    } finally {
      setActionLoading(false)
    }
  }

  // ------------------------------------------
  // Clock Out — optimistic UI
  // ------------------------------------------
  const handleClockOut = async () => {
    if (!profile || !todayRecord) return
    const previous = todayRecord
    const optimistic: AttendanceRecord = {
      ...todayRecord,
      clock_out_at: new Date().toISOString(),
      status: 'closed',
    }
    setTodayRecord(optimistic)
    playSchoolBell()
    setShowSuccess(true)
    setActionLoading(true)
    try {
      const { error } = await supabase.rpc('clock_out', { p_notes: undefined })
      if (error) throw error
      toast.success('¡Egreso registrado!')
      await fetchAttendance()
    } catch (err) {
      setTodayRecord(previous)
      errorToast('No pudimos registrar tu egreso', err, { retry: handleClockOut })
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

  // Socios (excepto Ricardo) no fichan
  if (!mustClockIn(profile)) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-10 text-center">
        <div className="card-elevated-lg mx-auto max-w-sm px-6 py-12">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-[#f0f7f5]">
            <CheckCircle className="size-8 text-[#006d5a]" strokeWidth={1.5} />
          </div>
          <p className="font-display text-xl font-semibold text-[#3d2c24]">
            Sin fichaje
          </p>
          <p className="mt-2 text-sm text-[#a39e97]">
            Tu rol no requiere marcar ingreso ni egreso.
          </p>
        </div>
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
        <p className="font-display text-5xl sm:text-7xl font-bold tabular-nums tracking-tight text-[#3d2c24]">
          {format(currentTime, 'HH:mm')}
          <span className="text-2xl sm:text-3xl font-medium text-[#a39e97]">{format(currentTime, ':ss')}</span>
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
              disabled={actionLoading}
              className="h-16 w-full rounded-2xl bg-[#006d5a] text-base font-semibold text-white shadow-md hover:bg-[#005a4a] active:scale-[0.98]"
            >
              {actionLoading ? (
                <Loader2 className="mr-2.5 size-5 animate-spin" />
              ) : (
                <LogIn className="mr-2.5 size-5" />
              )}
              Marcar Ingreso
            </Button>
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
          <div className="card-elevated flex flex-col items-center gap-2 px-6 py-10 text-center">
            <History className="size-8 text-[#ebe6df]" />
            <p className="text-sm font-medium text-[#a39e97]">
              Aún no hay registros
            </p>
            <p className="text-xs text-[#a39e97]/70">
              ¡Marcá tu primer ingreso!
            </p>
          </div>
        ) : (
          <StaggerList className="space-y-2.5">
            {history.map((record) => (
              <StaggerItem key={record.id}>
              <div
                className="card-elevated flex items-center gap-4 rounded-xl px-4 py-3.5"
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

      {/* GPS dialog removed — fichaje libre */}
    </div>
  )
}
