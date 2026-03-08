'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  isWithinInterval,
} from 'date-fns'
import { es } from 'date-fns/locale/es'
import { CalendarDays, Loader2, CalendarX2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ShiftCard, type ShiftCardData } from '@/components/shifts/ShiftCard'
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

  const today = new Date()

  // ------------------------------------------
  // Week boundaries
  // ------------------------------------------
  const weekStart = useMemo(() => {
    const base =
      weekFilter === 'this_week' ? today : addWeeks(today, 1)
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
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <CalendarDays className="size-5" />
          Mis Horarios
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Consulta tus turnos programados
        </p>
      </div>

      {/* Week filter */}
      <div className="flex items-center gap-2">
        <Button
          variant={weekFilter === 'this_week' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setWeekFilter('this_week')}
        >
          Esta semana
        </Button>
        <Button
          variant={weekFilter === 'next_week' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setWeekFilter('next_week')}
        >
          Proxima semana
        </Button>
        <span className="ml-auto text-xs capitalize text-muted-foreground">
          {weekLabel}
        </span>
      </div>

      {/* Shifts list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : shifts.length === 0 ? (
        /* Empty state */
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <div className="rounded-full bg-muted p-3">
              <CalendarX2 className="size-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">
                No tienes turnos programados
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {weekFilter === 'this_week'
                  ? 'No hay turnos asignados para esta semana.'
                  : 'No hay turnos asignados para la proxima semana.'}
              </p>
            </div>
          </CardContent>
        </Card>
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
