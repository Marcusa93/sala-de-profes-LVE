'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock, LogIn, LogOut, CheckCircle, AlertCircle, Loader2,
  History, Timer, MapPin, Shield, ShieldAlert, ShieldCheck,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { SuccessBurst } from '@/components/ui/success-burst'
import { playSchoolBell } from '@/lib/sounds'
import {
  getGeolocation, getDeviceFingerprint, getNetworkInfo,
  type GeoResult,
} from '@/lib/attendance/security'

// ---------------------------------------------------------------------------
type AttendanceRecord = {
  id: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  status: 'open' | 'closed' | 'missing_checkout'
  notes: string | null
  is_suspicious?: boolean
  clock_in_lat?: number | null
}
type TodayStatus = 'not_clocked_in' | 'clocked_in' | 'completed'
type FlowState = 'idle' | 'working' | 'done'

// ---------------------------------------------------------------------------
function getGreeting(d: Date) {
  const h = d.getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

function fmtDuration(start: string, end?: string | null) {
  const ms = Math.max(0, (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime())
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60), m = totalMin % 60
  return h === 0 ? `${m}m` : `${h}h ${m}m`
}

function humanErr(e: unknown) {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('abierto')) return m
  if (m.includes('No hay')) return m
  if (m.includes('auth') || m.includes('JWT')) return 'Sesión expirada. Recargá la página.'
  return m || 'Error inesperado'
}

// ---------------------------------------------------------------------------
export default function MiTurnoPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = createClient()

  const [now, setNow] = useState(new Date())
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [history, setHistory] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [flowState, setFlowState] = useState<FlowState>('idle')
  const [flowMsg, setFlowMsg] = useState('')

  const todayStr = useMemo(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }),
  [])

  // Live clock
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  // Fetch attendance
  const fetchAttendance = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const { data: today } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, is_suspicious, clock_in_lat')
        .eq('user_id', profile.id)
        .eq('operative_date', todayStr)
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setTodayRecord(today as AttendanceRecord | null)

      const { data: hist } = await supabase
        .from('attendance_logs')
        .select('id, operative_date, clock_in_at, clock_out_at, status, notes, is_suspicious, clock_in_lat')
        .eq('user_id', profile.id)
        .order('operative_date', { ascending: false })
        .limit(7)
      setHistory((hist ?? []) as AttendanceRecord[])
    } catch {
      toast.error('No se pudo cargar tu turno')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, todayStr])

  useEffect(() => { fetchAttendance() }, [fetchAttendance])

  // Status
  const status: TodayStatus = !todayRecord
    ? 'not_clocked_in'
    : todayRecord.clock_out_at ? 'completed' : 'clocked_in'

  const liveDuration = useMemo(() => {
    if (!todayRecord) return null
    if (status === 'clocked_in') return fmtDuration(todayRecord.clock_in_at)
    if (status === 'completed') return fmtDuration(todayRecord.clock_in_at, todayRecord.clock_out_at)
    return null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayRecord, status, now])

  // ------------------------------------------
  // Flujo completo: verificar + enviar
  // ------------------------------------------
  async function handleClock(action: 'in' | 'out') {
    setFlowState('working')
    setFlowMsg('Verificando ubicación...')

    // 1. GPS
    let geo: GeoResult | null = null
    try {
      geo = await getGeolocation(10000)
      setFlowMsg('Registrando dispositivo...')
    } catch {
      setFlowMsg('GPS no disponible, continuando...')
    }

    // 2. Device + network
    const dev = getDeviceFingerprint()
    const net = getNetworkInfo()
    setFlowMsg('Registrando fichaje...')

    // 3. Send
    try {
      const res = await fetch('/api/attendance/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: action === 'in' ? 'clock_in' : 'clock_out',
          gps_lat: geo?.lat,
          gps_lng: geo?.lng,
          gps_accuracy: geo?.accuracy,
          wifi_ssid: net.effectiveType ?? undefined,
          device_fingerprint: dev.id,
        }),
      })

      const data = await res.json()

      if (!res.ok || data.error) {
        toast.error(humanErr(data.error))
        setFlowState('idle')
        return
      }

      playSchoolBell()
      setShowSuccess(true)
      setFlowState('done')
      toast.success(action === 'in' ? '¡Ingreso registrado!' : '¡Egreso registrado!')
      await fetchAttendance()
      setTimeout(() => setFlowState('idle'), 2000)
    } catch {
      toast.error('Error de conexión')
      setFlowState('idle')
    }
  }

  // ------------------------------------------
  // Loading
  // ------------------------------------------
  if (profileLoading || loading) return <LoadingState message="Cargando tu turno..." />
  if (!profile) return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-muted-foreground">No se pudo cargar el perfil.</p>
    </div>
  )

  // ------------------------------------------
  // Working overlay
  // ------------------------------------------
  if (flowState === 'working') {
    return (
      <div className="mx-auto max-w-lg flex flex-col items-center gap-6 pt-20 pb-28">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-[#f0f7f5]">
          <Shield className="size-8 text-[#006d5a]" strokeWidth={1.5} />
        </div>
        <h2 className="font-display text-xl font-bold text-[#3d2c24]">Registrando fichaje</h2>
        <Loader2 className="size-10 animate-spin text-[#006d5a]" />
        <p className="text-sm text-[#a39e97]">{flowMsg}</p>
        <button
          onClick={() => { setFlowState('idle'); toast.error('Fichaje cancelado') }}
          className="mt-4 rounded-xl border border-[#ebe6df] px-5 py-2 text-sm font-medium text-[#a39e97] hover:bg-[#faf8f5]"
        >
          Cancelar
        </button>
      </div>
    )
  }

  // ------------------------------------------
  // Main render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-8 pb-28">
      <SuccessBurst show={showSuccess} onComplete={() => setShowSuccess(false)} />

      {/* Hero Clock */}
      <FadeIn className="pt-4 text-center">
        <p className="font-display text-5xl sm:text-7xl font-bold tabular-nums tracking-tight text-[#3d2c24]">
          {format(now, 'HH:mm')}
          <span className="text-2xl sm:text-3xl font-medium text-[#a39e97]">{format(now, ':ss')}</span>
        </p>
        <p className="section-label mt-4">
          {format(now, "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </FadeIn>

      {/* Status Card */}
      <FadeIn delay={0.1}>
        <div
          className="card-elevated-lg relative overflow-hidden px-6 py-10"
          style={{
            borderLeftWidth: '4px',
            borderLeftColor:
              status === 'clocked_in' ? '#d4943a' :
              status === 'completed' ? '#006d5a' : 'transparent',
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
                  {getGreeting(now)}
                </p>
                <p className="mt-1 text-sm text-[#a39e97]">No registraste ingreso hoy.</p>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-[#e8f5f1] px-3 py-1.5 text-xs text-[#006d5a]">
                <ShieldCheck className="size-3.5" />
                <span>Fichaje verificado: ubicación + dispositivo</span>
              </div>
              <Button
                onClick={() => handleClock('in')}
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
                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className={`flex items-center gap-1 text-xs ${todayRecord.clock_in_lat ? 'text-[#006d5a]' : 'text-[#d4943a]'}`}>
                    <MapPin className="size-3" />
                    {todayRecord.clock_in_lat ? 'GPS ✓' : 'GPS ⚠'}
                  </span>
                  {todayRecord.is_suspicious && (
                    <>
                      <span className="text-[#ebe6df]">·</span>
                      <span className="flex items-center gap-1 text-xs text-amber-600">
                        <ShieldAlert className="size-3" /> Con advertencias
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Button
                onClick={() => handleClock('out')}
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
                {todayRecord.is_suspicious && (
                  <div className="mt-4 flex items-center justify-center gap-1 text-xs text-amber-600">
                    <ShieldAlert className="size-3" /> Con advertencias
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      {/* Historial */}
      <FadeIn delay={0.2} className="space-y-4">
        <button
          onClick={() => setShowHistory(v => !v)}
          className="flex w-full items-center gap-2.5 px-1"
        >
          <History className="size-4 text-[#a39e97]" strokeWidth={1.5} />
          <h2 className="font-display text-lg font-semibold text-[#3d2c24]">Historial reciente</h2>
          <div className="ml-auto">
            {showHistory ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
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
              {history.map(r => (
                <StaggerItem key={r.id}>
                  <div
                    className="card-elevated flex items-center gap-4 rounded-xl px-4 py-3.5"
                    style={{
                      borderLeftWidth: '3px',
                      borderLeftColor: r.is_suspicious ? '#d4943a' : r.clock_out_at ? '#006d5a' : '#ea504c',
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium capitalize text-[#3d2c24]">
                        {format(new Date(r.operative_date + 'T12:00:00'), 'EEE d MMM', { locale: es })}
                      </p>
                      <div className="mt-0.5 flex items-center gap-x-3 text-xs text-[#a39e97]">
                        <span className="tabular-nums">{format(new Date(r.clock_in_at), 'HH:mm')}</span>
                        <span className="text-[#ebe6df]">/</span>
                        <span className="tabular-nums">{r.clock_out_at ? format(new Date(r.clock_out_at), 'HH:mm') : '--:--'}</span>
                        {r.clock_out_at && (
                          <>
                            <span className="text-[#ebe6df]">·</span>
                            <span>{fmtDuration(r.clock_in_at, r.clock_out_at)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      r.is_suspicious ? 'bg-amber-50 text-amber-700' :
                      r.clock_out_at ? 'bg-[#e8f5f1] text-[#006d5a]' :
                      'bg-red-50 text-[#ea504c]'
                    }`}>
                      {r.is_suspicious ? '⚠ Sospechoso' : r.clock_out_at ? '✓ Completo' : 'Sin egreso'}
                    </span>
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
