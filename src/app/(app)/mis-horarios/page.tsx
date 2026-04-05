'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
} from 'date-fns'
import { es } from 'date-fns/locale/es'
import { ChevronLeft, ChevronRight, CalendarX2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShiftCard, type ShiftCardData } from '@/components/shifts/ShiftCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// My Schedule Page
// ---------------------------------------------------------------------------

type WeekFilter = 'this_week' | 'next_week'

export default function MisHorariosPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [shifts, setShifts] = useState<ShiftCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [weekFilter, setWeekFilter] = useState<WeekFilter>('this_week')

  // ------------------------------------------
  // Week boundaries
  // ------------------------------------------
  const weekStart = useMemo(() => {
    const now = new Date()
    const base =
      weekFilter === 'this_week' ? now : addWeeks(now, 1)
    return startOfWeek(base, { weekStartsOn: 1 }) // Monday
  }, [weekFilter])

  const weekEnd = useMemo(() => {
    return endOfWeek(weekStart, { weekStartsOn: 1 })
  }, [weekStart])

  // ------------------------------------------
  // Fetch shifts
  // ------------------------------------------
  useEffect(() => {
    if (!profile) return

    async function fetchShifts() {
      setLoading(true)
      const supabase = createClient()

      try {
        const startStr = format(weekStart, 'yyyy-MM-dd')
        const endStr = format(weekEnd, 'yyyy-MM-dd')

        const { data } = await supabase
          .from('shifts')
          .select('id, shift_date, start_time, end_time, shift_role, notes, user_id')
          .eq('user_id', profile!.id)
          .gte('shift_date', startStr)
          .lte('shift_date', endStr)
          .order('shift_date', { ascending: true })
          .order('start_time', { ascending: true })

        setShifts((data as ShiftCardData[]) ?? [])
      } catch (err) {
        console.error('Error al cargar horarios:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchShifts()
  }, [profile, weekStart, weekEnd])

  // ------------------------------------------
  // Week label
  // ------------------------------------------
  const weekLabel = useMemo(() => {
    const start = format(weekStart, "d 'de' MMM", { locale: es })
    const end = format(weekEnd, "d 'de' MMM", { locale: es })
    return `${start} - ${end}`
  }, [weekStart, weekEnd])

  // ------------------------------------------
  // Loading state
  // ------------------------------------------
  if (profileLoading) {
    return <LoadingState />
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-28">
      {/* ============================================================= */}
      {/* Header                                                         */}
      {/* ============================================================= */}
      <div className="px-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">
          Mis Horarios
        </h1>
        <p className="section-label mt-1.5">
          Consulta tus turnos programados
        </p>
      </div>

      {/* ============================================================= */}
      {/* Week segmented control                                         */}
      {/* ============================================================= */}
      <div className="card-elevated flex items-center gap-1 p-1.5">
        <button
          onClick={() => setWeekFilter('this_week')}
          className={`pill flex-1 ${weekFilter === 'this_week' ? 'pill-active' : 'pill-inactive'}`}
        >
          Esta semana
        </button>
        <button
          onClick={() => setWeekFilter('next_week')}
          className={`pill flex-1 ${weekFilter === 'next_week' ? 'pill-active' : 'pill-inactive'}`}
        >
          Proxima semana
        </button>
      </div>

      {/* ============================================================= */}
      {/* Week navigation                                                */}
      {/* ============================================================= */}
      <div className="flex items-center justify-between px-1">
        <Button
          variant="ghost"
          size="icon"
          className="icon-btn rounded-xl text-[#a39e97] hover:text-[#3d2c24]"
          onClick={() => setWeekFilter('this_week')}
          disabled={weekFilter === 'this_week'}
        >
          <ChevronLeft className="size-5" />
        </Button>

        <div className="text-center">
          <span className="section-label capitalize block">
            {weekFilter === 'this_week' ? 'Esta semana' : 'Proxima semana'}
          </span>
          <span className="text-xs text-[#a39e97] capitalize">
            {weekLabel}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="icon-btn rounded-xl text-[#a39e97] hover:text-[#3d2c24]"
          onClick={() => setWeekFilter('next_week')}
          disabled={weekFilter === 'next_week'}
        >
          <ChevronRight className="size-5" />
        </Button>
      </div>

      {/* ============================================================= */}
      {/* Shifts list                                                    */}
      {/* ============================================================= */}
      {loading ? (
        <LoadingState message="Cargando turnos..." />
      ) : shifts.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title="Sin turnos programados"
          description={
            weekFilter === 'this_week'
              ? 'No tenés turnos esta semana. Consultá con tu encargado para que te asigne.'
              : 'Aún no hay turnos para la próxima semana. Se suelen cargar con anticipación.'
          }
        />
      ) : (
        <div className="space-y-3">
          {shifts.map((shift) => (
            <ShiftCard key={shift.id} shift={shift} />
          ))}
        </div>
      )}
    </div>
  )
}
