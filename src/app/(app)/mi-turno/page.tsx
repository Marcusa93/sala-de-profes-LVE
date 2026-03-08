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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'

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
  // Clock In
  // ------------------------------------------
  const handleClockIn = async () => {
    if (!profile) return
    setActionLoading(true)

    try {
      const { error } = await supabase.rpc('clock_in')

      if (error) throw error

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
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
          <CheckCircle className="size-3" />
          Completado
        </span>
      )
    }

    // Check if it's today
    if (record.operative_date === todayStr) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          <Clock className="size-3" />
          En turno
        </span>
      )
    }

    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        <AlertCircle className="size-3" />
        Sin egreso
      </span>
    )
  }

  // ------------------------------------------
  // Loading state
  // ------------------------------------------
  if (profileLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">Cargando...</p>
        </div>
      </div>
    )
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
    <div className="mx-auto max-w-lg space-y-6 py-6">
      {/* Current Date & Time */}
      <div className="text-center">
        <p className="text-sm capitalize text-muted-foreground">
          {format(currentTime, "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
        <p className="mt-1 font-mono text-4xl font-bold tabular-nums tracking-tight">
          {format(currentTime, 'HH:mm:ss')}
        </p>
      </div>

      {/* Status Card */}
      <Card>
        <CardContent className="py-8">
          {/* NOT CLOCKED IN */}
          {status === 'not_clocked_in' && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-green-100 p-4">
                <LogIn className="size-8 text-green-700" />
              </div>
              <p className="text-center text-sm text-muted-foreground">
                No has registrado ingreso hoy.
              </p>
              <Button
                onClick={handleClockIn}
                disabled={actionLoading}
                className="h-14 w-full max-w-xs bg-green-600 text-base font-semibold text-white hover:bg-green-700"
              >
                {actionLoading ? (
                  <Loader2 className="mr-2 size-5 animate-spin" />
                ) : (
                  <LogIn className="mr-2 size-5" />
                )}
                MARCAR INGRESO
              </Button>
            </div>
          )}

          {/* CLOCKED IN - needs clock out */}
          {status === 'clocked_in' && todayRecord && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-amber-100 p-4">
                <Clock className="size-8 text-amber-600" />
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Ingreso registrado a las
                </p>
                <p className="mt-1 font-mono text-2xl font-bold text-foreground">
                  {format(new Date(todayRecord.clock_in_at), 'HH:mm')}
                </p>
              </div>
              <Button
                onClick={handleClockOut}
                disabled={actionLoading}
                className="h-14 w-full max-w-xs bg-amber-500 text-base font-semibold text-white hover:bg-amber-600"
              >
                {actionLoading ? (
                  <Loader2 className="mr-2 size-5 animate-spin" />
                ) : (
                  <LogOut className="mr-2 size-5" />
                )}
                MARCAR EGRESO
              </Button>
            </div>
          )}

          {/* COMPLETED */}
          {status === 'completed' && todayRecord && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-green-100 p-4">
                <CheckCircle className="size-8 text-green-700" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-green-700">
                  Turno completado
                </p>
                <div className="mt-3 flex items-center justify-center gap-6 text-sm">
                  <div>
                    <p className="text-muted-foreground">Ingreso</p>
                    <p className="font-mono text-lg font-bold">
                      {format(new Date(todayRecord.clock_in_at), 'HH:mm')}
                    </p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div>
                    <p className="text-muted-foreground">Egreso</p>
                    <p className="font-mono text-lg font-bold">
                      {todayRecord.clock_out_at?.slice(0, 5)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" />
            Historial reciente
          </CardTitle>
          <CardDescription>Ultimos 7 registros</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No hay registros de asistencia.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Fecha</th>
                    <th className="pb-2 pr-4 font-medium">Ingreso</th>
                    <th className="pb-2 pr-4 font-medium">Egreso</th>
                    <th className="pb-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((record) => (
                    <tr key={record.id}>
                      <td className="py-2.5 pr-4 capitalize">
                        {format(
                          new Date(record.operative_date + 'T12:00:00'),
                          'EEE d MMM',
                          { locale: es },
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono">
                        {format(new Date(record.clock_in_at), 'HH:mm')}
                      </td>
                      <td className="py-2.5 pr-4 font-mono">
                        {record.clock_out_at
                          ? format(new Date(record.clock_out_at), 'HH:mm')
                          : '—'}
                      </td>
                      <td className="py-2.5">
                        {getRecordStatusBadge(record)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
