'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isSameDay,
} from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  CalendarDays,
  Loader2,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { ShiftCard, type ShiftCardData } from '@/components/shifts/ShiftCard'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { ROLES, ROLE_OPTIONS } from '@/lib/constants'
import type { AppRole, ShiftInsert } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShiftWithProfile = ShiftCardData & {
  created_by: string
}

type EmployeeOption = {
  id: string
  first_name: string
  last_name: string
  role: AppRole
}

// ---------------------------------------------------------------------------
// Team Schedule Page
// ---------------------------------------------------------------------------

export default function EquipoTurnosPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [supabase] = useState(() => createClient())

  // Week navigation
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  )
  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 })
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd })

  // Data
  const [shifts, setShifts] = useState<ShiftWithProfile[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingShift, setEditingShift] = useState<ShiftWithProfile | null>(null)
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingShift, setDeletingShift] = useState<ShiftWithProfile | null>(
    null,
  )
  const [deleting, setDeleting] = useState(false)

  // Form state
  const [formUserId, setFormUserId] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formStartTime, setFormStartTime] = useState('')
  const [formEndTime, setFormEndTime] = useState('')
  const [formRole, setFormRole] = useState<AppRole>('runner')
  const [formNotes, setFormNotes] = useState('')

  const isEncargado = profile?.role === 'encargado'

  // ------------------------------------------
  // Fetch shifts for the current week
  // ------------------------------------------
  const fetchShifts = useCallback(async () => {
    setLoading(true)
    try {
      const fromDate = format(currentWeekStart, 'yyyy-MM-dd')
      const toDate = format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd')

      const { data, error } = await supabase
        .from('shifts')
        .select(
          'id, user_id, shift_date, start_time, end_time, shift_role, notes, created_by, profiles!shifts_user_id_fkey(first_name, last_name)',
        )
        .gte('shift_date', fromDate)
        .lte('shift_date', toDate)
        .order('start_time', { ascending: true })

      if (error) throw error

      const mapped: ShiftWithProfile[] = (data ?? []).map((s: any) => ({
        id: s.id,
        user_id: s.user_id,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        shift_role: s.shift_role,
        notes: s.notes,
        created_by: s.created_by,
        profile: s.profiles
          ? { first_name: s.profiles.first_name, last_name: s.profiles.last_name }
          : null,
      }))

      setShifts(mapped)
    } catch (err) {
      console.error('Error al cargar turnos:', err)
      toast.error('Error al cargar los turnos de la semana')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWeekStart, supabase])

  // ------------------------------------------
  // Fetch employees list
  // ------------------------------------------
  useEffect(() => {
    if (!isEncargado) return
    async function load() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, role')
          .eq('is_active', true)
          .order('first_name')

        if (error) throw error
        setEmployees(data ?? [])
      } catch (err) {
        console.error('Error al cargar empleados:', err)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEncargado])

  useEffect(() => {
    if (isEncargado) {
      fetchShifts()
    }
  }, [isEncargado, fetchShifts])

  // ------------------------------------------
  // Week navigation
  // ------------------------------------------
  const goToPreviousWeek = () => setCurrentWeekStart((w) => subWeeks(w, 1))
  const goToNextWeek = () => setCurrentWeekStart((w) => addWeeks(w, 1))
  const goToCurrentWeek = () =>
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))

  // ------------------------------------------
  // Open dialog for create
  // ------------------------------------------
  const openCreateDialog = () => {
    setEditingShift(null)
    setFormUserId('')
    setFormDate(format(new Date(), 'yyyy-MM-dd'))
    setFormStartTime('08:00')
    setFormEndTime('16:00')
    setFormRole('runner')
    setFormNotes('')
    setDialogOpen(true)
  }

  // ------------------------------------------
  // Open dialog for edit
  // ------------------------------------------
  const openEditDialog = (shift: ShiftWithProfile) => {
    setEditingShift(shift)
    setFormUserId(shift.user_id)
    setFormDate(shift.shift_date)
    setFormStartTime(shift.start_time.slice(0, 5))
    setFormEndTime(shift.end_time.slice(0, 5))
    setFormRole(shift.shift_role)
    setFormNotes(shift.notes ?? '')
    setDialogOpen(true)
  }

  // ------------------------------------------
  // Save shift (create or update)
  // ------------------------------------------
  const handleSave = async () => {
    if (!profile) return
    if (!formUserId || !formDate || !formStartTime || !formEndTime) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    setSaving(true)
    try {
      if (editingShift) {
        // Update
        const { error } = await supabase
          .from('shifts')
          .update({
            user_id: formUserId,
            shift_date: formDate,
            start_time: formStartTime,
            end_time: formEndTime,
            shift_role: formRole,
            notes: formNotes || null,
          })
          .eq('id', editingShift.id)

        if (error) throw error
        toast.success('Turno actualizado correctamente')
      } else {
        // Create
        const insertData: ShiftInsert = {
          user_id: formUserId,
          shift_date: formDate,
          start_time: formStartTime,
          end_time: formEndTime,
          shift_role: formRole,
          notes: formNotes || null,
          created_by: profile.id,
        }

        const { error } = await supabase.from('shifts').insert(insertData)

        if (error) throw error
        toast.success('Turno creado correctamente')
      }

      setDialogOpen(false)
      await fetchShifts()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al guardar el turno'
      toast.error('Error', { description: message })
    } finally {
      setSaving(false)
    }
  }

  // ------------------------------------------
  // Delete shift
  // ------------------------------------------
  const openDeleteDialog = (shift: ShiftWithProfile) => {
    setDeletingShift(shift)
    setDeleteDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!deletingShift) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from('shifts')
        .delete()
        .eq('id', deletingShift.id)

      if (error) throw error
      toast.success('Turno eliminado correctamente')
      setDeleteDialogOpen(false)
      setDeletingShift(null)
      await fetchShifts()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al eliminar el turno'
      toast.error('Error', { description: message })
    } finally {
      setDeleting(false)
    }
  }

  // ------------------------------------------
  // Get shifts for a specific day
  // ------------------------------------------
  const getShiftsForDay = (day: Date): ShiftWithProfile[] => {
    const dayStr = format(day, 'yyyy-MM-dd')
    return shifts.filter((s) => s.shift_date === dayStr)
  }

  // ------------------------------------------
  // Loading / Permission states
  // ------------------------------------------
  if (profileLoading) {
    return <LoadingState />
  }

  if (!profile || !isEncargado) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#e8f5f1]">
            <ShieldAlert className="size-7 text-[#006d5a]" />
          </div>
          <h3 className="font-display text-base font-semibold text-[#3d2c24]">Sin permisos</h3>
          <p className="max-w-xs text-sm text-[#a39e97]">
            Solo los encargados pueden gestionar los turnos del equipo.
          </p>
        </div>
      </div>
    )
  }

  // ------------------------------------------
  // Week label
  // ------------------------------------------
  const weekLabel = `${format(currentWeekStart, "d 'de' MMM", { locale: es })} - ${format(weekEnd, "d 'de' MMM, yyyy", { locale: es })}`

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-28">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">
          Turnos del Equipo
        </h1>
        <p className="section-label mt-2">
          Gestiona los horarios de todo tu equipo
        </p>
      </div>

      {/* Week navigation */}
      <div className="card-elevated flex items-center justify-between rounded-xl px-3 py-3">
        <button
          onClick={goToPreviousWeek}
          className="flex size-10 items-center justify-center rounded-xl text-[#a39e97] transition-colors hover:bg-[#f3efe9] hover:text-[#3d2c24]"
        >
          <ChevronLeft className="size-5" />
        </button>

        <div className="flex items-center gap-3">
          <button
            onClick={goToCurrentWeek}
            className="rounded-xl border border-[#ebe6df] bg-transparent px-3 py-1.5 text-xs font-semibold text-[#a39e97] transition-colors hover:border-[#006d5a] hover:text-[#006d5a]"
          >
            Hoy
          </button>
          <span className="text-sm font-semibold capitalize text-[#3d2c24]">
            {weekLabel}
          </span>
        </div>

        <button
          onClick={goToNextWeek}
          className="flex size-10 items-center justify-center rounded-xl text-[#a39e97] transition-colors hover:bg-[#f3efe9] hover:text-[#3d2c24]"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* Loading */}
      {loading ? (
        <LoadingState message="Cargando turnos..." />
      ) : (
        <>
          {/* ======================================== */}
          {/* Desktop: 7-column grid (Mon - Sun)       */}
          {/* ======================================== */}
          <div className="hidden md:grid md:grid-cols-7 md:gap-2.5">
            {weekDays.map((day) => {
              const dayShifts = getShiftsForDay(day)
              const isToday = isSameDay(day, new Date())

              return (
                <div key={day.toISOString()} className="min-h-[160px]">
                  {/* Day header */}
                  <div
                    className={`mb-2.5 rounded-xl px-2 py-2.5 text-center transition-colors ${
                      isToday
                        ? 'bg-[#006d5a] text-white shadow-sm'
                        : 'border border-[#ebe6df] bg-[#fefcf9]'
                    }`}
                  >
                    <p className={`text-[11px] font-semibold uppercase tracking-wider ${isToday ? 'opacity-80' : 'text-[#a39e97]'}`}>
                      {format(day, 'EEE', { locale: es })}
                    </p>
                    <p className={`text-lg font-bold tabular-nums ${isToday ? '' : 'text-[#3d2c24]'}`}>
                      {format(day, 'd')}
                    </p>
                  </div>

                  {/* Shift cards for this day */}
                  <div className="space-y-2">
                    {dayShifts.length === 0 ? (
                      <p className="py-4 text-center text-[11px] text-[#a39e97]">
                        Sin turnos
                      </p>
                    ) : (
                      dayShifts.map((shift) => (
                        <div key={shift.id} className="group relative">
                          <div
                            className="cursor-pointer"
                            onClick={() => openEditDialog(shift)}
                          >
                            <Card className="hover-lift overflow-hidden rounded-xl border border-[#ebe6df] bg-[#fefcf9] shadow-none">
                              <div className="flex">
                                {/* Left border with role color */}
                                <div
                                  className="w-1 shrink-0 rounded-l-xl"
                                  style={{
                                    backgroundColor: ROLES[shift.shift_role].color,
                                  }}
                                />
                                <CardContent className="flex-1 p-2.5">
                                  {/* Person name */}
                                  <p className="truncate text-xs font-semibold text-[#3d2c24]">
                                    {shift.profile
                                      ? `${shift.profile.first_name} ${shift.profile.last_name}`
                                      : 'Sin nombre'}
                                  </p>
                                  {/* Time */}
                                  <p className="mt-0.5 text-[11px] tabular-nums text-[#a39e97]">
                                    {shift.start_time.slice(0, 5)} -{' '}
                                    {shift.end_time.slice(0, 5)}
                                  </p>
                                  {/* Role badge */}
                                  <span
                                    className="mt-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                    style={{
                                      backgroundColor: ROLES[shift.shift_role].bg,
                                      color: ROLES[shift.shift_role].color,
                                    }}
                                  >
                                    {ROLES[shift.shift_role].emoji}{' '}
                                    {ROLES[shift.shift_role].label}
                                  </span>
                                </CardContent>
                              </div>
                            </Card>
                          </div>
                          {/* Action buttons on hover */}
                          <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex">
                            <button
                              className="flex size-6 items-center justify-center rounded-lg border border-[#ebe6df] bg-[#fefcf9]/95 shadow-sm backdrop-blur-sm transition-colors hover:bg-[#f3efe9]"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEditDialog(shift)
                              }}
                            >
                              <Pencil className="size-3 text-[#a39e97]" />
                            </button>
                            <button
                              className="flex size-6 items-center justify-center rounded-lg border border-[#ebe6df] bg-[#fefcf9]/95 shadow-sm backdrop-blur-sm transition-colors hover:bg-[#fef2f2]"
                              onClick={(e) => {
                                e.stopPropagation()
                                openDeleteDialog(shift)
                              }}
                            >
                              <Trash2 className="size-3 text-[#ea504c]" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ======================================== */}
          {/* Mobile: List view grouped by day          */}
          {/* ======================================== */}
          <div className="space-y-5 md:hidden">
            {weekDays.map((day) => {
              const dayShifts = getShiftsForDay(day)
              const isToday = isSameDay(day, new Date())

              return (
                <div key={day.toISOString()}>
                  {/* Day header */}
                  <div
                    className={`mb-3 rounded-xl px-4 py-3 ${
                      isToday
                        ? 'bg-[#006d5a] text-white shadow-sm'
                        : 'border border-[#ebe6df] bg-[#fefcf9]'
                    }`}
                  >
                    <p className={`text-sm font-semibold capitalize ${isToday ? '' : 'text-[#3d2c24]'}`}>
                      {format(day, "EEEE d 'de' MMMM", { locale: es })}
                    </p>
                  </div>

                  {/* Shift cards */}
                  {dayShifts.length === 0 ? (
                    <p className="py-4 text-center text-sm text-[#a39e97]">
                      Sin turnos programados
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {dayShifts.map((shift) => (
                        <div key={shift.id} className="relative">
                          <div onClick={() => openEditDialog(shift)}>
                            <ShiftCard shift={shift} showPerson />
                          </div>
                          <div className="absolute right-2.5 top-2.5 flex gap-1.5">
                            <button
                              className="flex size-8 items-center justify-center rounded-xl border border-[#ebe6df] bg-[#fefcf9]/95 shadow-sm backdrop-blur-sm transition-colors hover:bg-[#f3efe9]"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEditDialog(shift)
                              }}
                            >
                              <Pencil className="size-3.5 text-[#a39e97]" />
                            </button>
                            <button
                              className="flex size-8 items-center justify-center rounded-xl border border-[#ebe6df] bg-[#fefcf9]/95 shadow-sm backdrop-blur-sm transition-colors hover:bg-[#fef2f2]"
                              onClick={(e) => {
                                e.stopPropagation()
                                openDeleteDialog(shift)
                              }}
                            >
                              <Trash2 className="size-3.5 text-[#ea504c]" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Empty state when no shifts at all */}
          {shifts.length === 0 && !loading && (
            <EmptyState
              icon={CalendarDays}
              title="Sin turnos esta semana"
              description="No hay turnos programados para esta semana. Toca el boton + para crear uno."
            />
          )}
        </>
      )}

      {/* ========================================== */}
      {/* FAB: Floating Action Button (Add Shift)    */}
      {/* ========================================== */}
      <button
        onClick={openCreateDialog}
        className="fixed bottom-20 right-5 z-40 flex size-14 items-center justify-center rounded-full bg-[#006d5a] text-white shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-8 md:right-8"
        aria-label="Agregar turno"
      >
        <Plus className="size-6" />
      </button>

      {/* ========================================== */}
      {/* Create / Edit Dialog                       */}
      {/* ========================================== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">
              {editingShift ? 'Editar Turno' : 'Nuevo Turno'}
            </DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              {editingShift
                ? 'Modifica los datos del turno.'
                : 'Completa los datos para crear un nuevo turno.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            {/* Employee select */}
            <div className="space-y-2">
              <Label htmlFor="shift-employee" className="text-sm font-medium text-[#3d2c24]">Empleado</Label>
              <Select
                value={formUserId}
                onValueChange={(v) => v && setFormUserId(v)}
              >
                <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]" id="shift-employee">
                  <SelectValue placeholder="Seleccionar empleado" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[#ebe6df]">
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            backgroundColor: ROLES[emp.role].bg,
                            color: ROLES[emp.role].color,
                          }}
                        >
                          {ROLES[emp.role].emoji}
                        </span>
                        {emp.first_name} {emp.last_name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label htmlFor="shift-date" className="text-sm font-medium text-[#3d2c24]">Fecha</Label>
              <Input
                id="shift-date"
                type="date"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5]"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </div>

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="shift-start" className="text-sm font-medium text-[#3d2c24]">Hora inicio</Label>
                <Input
                  id="shift-start"
                  type="time"
                  className="rounded-xl border-[#ebe6df] bg-[#faf8f5]"
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shift-end" className="text-sm font-medium text-[#3d2c24]">Hora fin</Label>
                <Input
                  id="shift-end"
                  type="time"
                  className="rounded-xl border-[#ebe6df] bg-[#faf8f5]"
                  value={formEndTime}
                  onChange={(e) => setFormEndTime(e.target.value)}
                />
              </div>
            </div>

            {/* Role */}
            <div className="space-y-2">
              <Label htmlFor="shift-role" className="text-sm font-medium text-[#3d2c24]">Rol</Label>
              <Select
                value={formRole}
                onValueChange={(v) => v && setFormRole(v as AppRole)}
              >
                <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]" id="shift-role">
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[#ebe6df]">
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="shift-notes" className="text-sm font-medium text-[#3d2c24]">Notas (opcional)</Label>
              <Textarea
                id="shift-notes"
                placeholder="Notas adicionales..."
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5]"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24]" />}>
              Cancelar
            </DialogClose>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-[#006d5a] text-white hover:bg-[#005a4a]"
            >
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {editingShift ? 'Guardar cambios' : 'Crear turno'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================== */}
      {/* Delete Confirmation Dialog                 */}
      {/* ========================================== */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">
              Eliminar turno
            </DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              Esta accion no se puede deshacer. Se eliminara el turno de{' '}
              <strong className="text-[#3d2c24]">
                {deletingShift?.profile
                  ? `${deletingShift.profile.first_name} ${deletingShift.profile.last_name}`
                  : 'este empleado'}
              </strong>{' '}
              del dia{' '}
              <strong className="text-[#3d2c24]">
                {deletingShift
                  ? format(
                      new Date(deletingShift.shift_date + 'T12:00:00'),
                      "d 'de' MMMM",
                      { locale: es },
                    )
                  : ''}
              </strong>
              .
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24]" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              className="rounded-xl bg-[#ea504c] hover:bg-[#d4413e]"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
