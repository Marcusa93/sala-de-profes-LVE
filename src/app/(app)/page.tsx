'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock,
  CalendarDays,
  Bell,
  Users,
  AlertTriangle,
  LogIn,
  ArrowRight,
  Coffee,
  Loader2,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TodayAttendance = {
  id: string
  clock_in_at: string
  clock_out_at: string | null
} | null

type NextShift = {
  shift_date: string
  start_time: string
  end_time: string
  shift_role: AppRole
} | null

type TeamMember = {
  clock_in_at: string
  profiles: { first_name: string; last_name: string; role: AppRole } | null
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [todayAttendance, setTodayAttendance] =
    useState<TodayAttendance>(null)
  const [nextShift, setNextShift] = useState<NextShift>(null)
  const [announcementCount, setAnnouncementCount] = useState(0)
  const [teamToday, setTeamToday] = useState<TeamMember[]>([])
  const [criticalStockCount, setCriticalStockCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const isEncargado = profile?.role === 'encargado'

  // Fetch all dashboard data
  useEffect(() => {
    if (!profile) return

    async function fetchData() {
      setLoading(true)
      const supabase = createClient()

      try {
        // 1. Today's attendance for current user
        const { data: attendance } = await supabase
          .from('attendance_logs')
          .select('id, clock_in_at, clock_out_at')
          .eq('user_id', profile!.id)
          .eq('operative_date', todayStr)
          .order('clock_in_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        setTodayAttendance(attendance)

        // 2. Next upcoming shift
        const { data: shift } = await supabase
          .from('shifts')
          .select('shift_date, start_time, end_time, shift_role')
          .eq('user_id', profile!.id)
          .gte('shift_date', todayStr)
          .order('shift_date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(1)
          .maybeSingle()

        setNextShift(shift)

        // 3. Active announcements count (not expired)
        const { count } = await supabase
          .from('announcements')
          .select('*', { count: 'exact', head: true })
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

        setAnnouncementCount(count ?? 0)

        // 4. Encargado-only: team working today
        if (profile!.role === 'encargado') {
          const { data: team } = await supabase
            .from('attendance_logs')
            .select(
              'clock_in_at, profiles!attendance_logs_user_id_fkey(first_name, last_name, role)',
            )
            .eq('operative_date', todayStr)
            .is('clock_out_at', null)

          setTeamToday((team as unknown as TeamMember[]) ?? [])

          // 5. Critical stock: items where current_qty <= min_qty
          const { data: allItems } = await supabase
            .from('stock_items')
            .select('id, current_qty, min_qty')
            .eq('is_active', true)

          const critical =
            allItems?.filter(
              (item) => item.current_qty <= item.min_qty,
            ) ?? []
          setCriticalStockCount(critical.length)
        }
      } catch (err) {
        console.error('Error al cargar datos del dashboard:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [profile, todayStr])

  // First name extraction
  const firstName = profile?.first_name ?? ''

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
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header / Welcome */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          <Coffee className="mb-1 mr-1.5 inline-block size-6 text-primary" />
          Hola, {firstName}
        </h1>
        <p className="mt-1 text-sm capitalize text-muted-foreground">
          {format(today, "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Mi Estado Hoy */}
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <Clock className="size-4" />
              Mi Estado Hoy
            </CardDescription>
            <CardTitle>
              {todayAttendance ? (
                todayAttendance.clock_out_at ? (
                  <span className="text-green-700">Turno completado</span>
                ) : (
                  <span className="text-amber-600">En turno</span>
                )
              ) : (
                <span className="text-muted-foreground">Sin registrar</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todayAttendance ? (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  Ingreso:{' '}
                  <span className="font-medium text-foreground">
                    {todayAttendance.clock_in_at.slice(0, 5)}
                  </span>
                </p>
                {todayAttendance.clock_out_at && (
                  <p>
                    Egreso:{' '}
                    <span className="font-medium text-foreground">
                      {todayAttendance.clock_out_at.slice(0, 5)}
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No has marcado ingreso hoy.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Mi Proximo Turno */}
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <CalendarDays className="size-4" />
              Mi Proximo Turno
            </CardDescription>
            <CardTitle>
              {nextShift ? (
                <span className="capitalize">
                  {format(
                    new Date(nextShift.shift_date + 'T12:00:00'),
                    "EEEE d 'de' MMMM",
                    { locale: es },
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Sin turnos programados
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextShift ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {nextShift.start_time.slice(0, 5)} -{' '}
                  {nextShift.end_time.slice(0, 5)}
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: ROLES[nextShift.shift_role].color + '1A',
                    color: ROLES[nextShift.shift_role].color,
                  }}
                >
                  {ROLES[nextShift.shift_role].emoji} {ROLES[nextShift.shift_role].label}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Consulta con tu encargado.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Avisos Activos */}
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <Bell className="size-4" />
              Avisos Activos
            </CardDescription>
            <CardTitle>
              <span className="text-3xl font-bold tabular-nums">
                {announcementCount}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {announcementCount === 1
                ? 'aviso pendiente'
                : 'avisos pendientes'}
            </p>
          </CardContent>
        </Card>

        {/* Equipo Hoy (encargado only) */}
        {isEncargado && (
          <Card>
            <CardHeader>
              <CardDescription className="flex items-center gap-1.5">
                <Users className="size-4" />
                Equipo Hoy
              </CardDescription>
              <CardTitle>
                <span className="text-3xl font-bold tabular-nums">
                  {teamToday.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {teamToday.length > 0 ? (
                <div className="space-y-1">
                  {teamToday.map((member, i) => (
                    <p key={i} className="text-sm text-muted-foreground">
                      {member.profiles ? `${member.profiles.first_name} ${member.profiles.last_name}` : 'Desconocido'}{' '}
                      <span className="text-xs">
                        ({ROLES[member.profiles?.role ?? 'runner'].emoji}{' '}
                        {ROLES[member.profiles?.role ?? 'runner'].label})
                      </span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nadie ha marcado ingreso aun.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stock Critico (encargado only) */}
        {isEncargado && (
          <Card>
            <CardHeader>
              <CardDescription className="flex items-center gap-1.5">
                <AlertTriangle className="size-4" />
                Stock Critico
              </CardDescription>
              <CardTitle>
                <span
                  className={`text-3xl font-bold tabular-nums ${
                    criticalStockCount > 0
                      ? 'text-red-600'
                      : 'text-green-700'
                  }`}
                >
                  {criticalStockCount}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {criticalStockCount === 0
                  ? 'Todo en orden'
                  : criticalStockCount === 1
                    ? 'producto bajo minimo'
                    : 'productos bajo minimo'}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Acciones rapidas
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/mi-turno">
            <Button
              variant="outline"
              size="lg"
              className="w-full justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <LogIn className="size-4" />
                Marcar Ingreso/Egreso
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </Button>
          </Link>

          <Link href="/mis-horarios">
            <Button
              variant="outline"
              size="lg"
              className="w-full justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <CalendarDays className="size-4" />
                Ver Horarios
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </Button>
          </Link>

          <Link href="/notificaciones">
            <Button
              variant="outline"
              size="lg"
              className="w-full justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <Bell className="size-4" />
                Ver Avisos
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
