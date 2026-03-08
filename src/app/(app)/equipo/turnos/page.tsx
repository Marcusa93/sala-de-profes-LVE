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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/ui/EmptyState'
import { ShiftCard, type ShiftCardData } from '@/components/shifts/ShiftCard'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { ROLES, ROLE_OPTIONS } from '@/lib/constants'
import type { AppRole, Profile, ShiftInsert } from '@/types/database'

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
  const supabase = createClient()

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
      const toDate = format(weekEnd, 'yyyy-MM-dd')

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
  }, [currentWeekStart, weekEnd, supabase])

  // ------------------------------------------
  // Fetch employees list
  // ------------------------------------------
  const fetchEmployees = useCallback(async () => {
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
  }, [supabase])

  useEffect(() => {
    if (isEncargado) {
      fetchShifts()
      fetchEmployees()
    }
  }, [isEncargado, fetchShifts, fetchEmployees])

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
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!profile || !isEncargado) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center justify-center rounded-xl bg-muted p-3">
            <ShieldAlert className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium text-foreground">Sin permisos</h3>
          <p className="max-w-xs text-sm text-muted-foreground">
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
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <CalendarDays className="mb-1 mr-1.5 inline-block size-6 text-primary" />
            Turnos del Equipo
          </h1>
          <p className="mt-1 text-sm capitalize text-muted-foreground">
            {weekLabel}
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="size-4" />
          Agregar Turno
        </Button>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="icon" onClick={goToPreviousWeek}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={goToCurrentWeek}>
          Semana actual
        </Button>
        <Button variant="outline" size="icon" onClick={goToNextWeek}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Desktop: 7-column grid */}
          <div className="hidden md:grid md:grid-cols-7 md:gap-2">
            {weekDays.map((day) => {
              const dayShifts = getShiftsForDay(day)
              const isToday = isSameDay(day, new Date())

              return (
                <div key={day.toISOString()} className="min-h-[160px]">
                  {/* Day header */}
                  <div
                    className={`mb-2 rounded-lg px-2 py-1.5 text-center ${
                      isToday
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-xs font-medium capitalize">
                      {format(day, 'EEE', { locale: es })}
                    </p>
                    <p className="text-lg font-bold tabular-nums">
                      {format(day, 'd')}
                    </p>
                  </div>

                  {/* Shift cards */}
                  <div className="space-y-2">
                    {dayShifts.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        Sin turnos
                      </p>
                    ) : (
                      dayShifts.map((shift) => (
                        <div key={shift.id} className="group relative">
                          <div
                            className="cursor-pointer"
                            onClick={() => openEditDialog(shift)}
                          >
                            <Card className="overflow-hidden">
                              <div className="flex">
                                <div
                                  className="w-1 shrink-0"
                                  style={{
                                    backgroundColor: ROLES[shift.shift_role].color,
                                  }}
                                />
                                <CardContent className="flex-1 py-2 px-2.5">
                                  {/* Person name */}
                                  <p className="text-xs font-medium text-foreground truncate">
                                    {shift.profile ? `${shift.profile.first_name} ${shift.profile.last_name}` : 'Sin nombre'}
                                  </p>
                                  {/* Time */}
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {shift.start_time.slice(0, 5)} -{' '}
                                    {shift.end_time.slice(0, 5)}
                                  </p>
                                  {/* Role badge */}
                                  <span
                                    className="mt-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                    style={{
                                      backgroundColor:
                                        ROLES[shift.shift_role].color + '1A',
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
                          <div className="absolute top-1 right-1 hidden gap-0.5 group-hover:flex">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEditDialog(shift)
                              }}
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="icon-xs"
                              onClick={(e) => {
                                e.stopPropagation()
                                openDeleteDialog(shift)
                              }}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Mobile: scrollable daily list */}
          <div className="space-y-4 md:hidden">
            {weekDays.map((day) => {
              const dayShifts = getShiftsForDay(day)
              const isToday = isSameDay(day, new Date())

              return (
                <div key={day.toISOString()}>
                  {/* Day header */}
                  <div
                    className={`mb-2 rounded-lg px-3 py-2 ${
                      isToday
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-sm font-medium capitalize">
                      {format(day, "EEEE d 'de' MMMM", { locale: es })}
                    </p>
                  </div>

                  {/* Shift cards */}
                  {dayShifts.length === 0 ? (
                    <p className="py-3 text-center text-sm text-muted-foreground">
                      Sin turnos programados
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {dayShifts.map((shift) => (
                        <div key={shift.id} className="relative">
                          <div onClick={() => openEditDialog(shift)}>
                            <ShiftCard shift={shift} showPerson />
                          </div>
                          <div className="absolute top-2 right-2 flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEditDialog(shift)
                              }}
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="icon-xs"
                              onClick={(e) => {
                                e.stopPropagation()
                                openDeleteDialog(shift)
                              }}
                            >
                              <Trash2 className="size-3" />
                            </Button>
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
              description="No hay turnos programados para esta semana. Usa el boton 'Agregar Turno' para crear uno."
            />
          )}
        </>
      )}

      {/* ========================================== */}
      {/* Create / Edit Dialog                       */}
      {/* ========================================== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingShift ? 'Editar Turno' : 'Agregar Turno'}
            </DialogTitle>
            <DialogDescription>
              {editingShift
                ? 'Modifica los datos del turno.'
                : 'Completa los datos para crear un nuevo turno.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Employee select */}
            <div className="space-y-2">
              <Label htmlFor="shift-employee">Empleado</Label>
              <Select
                value={formUserId}
                onValueChange={(v) => v && setFormUserId(v)}
              >
                <SelectTrigger className="w-full" id="shift-employee">
                  <SelectValue placeholder="Seleccionar empleado" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name} ({ROLES[emp.role].emoji}{' '}
                      {ROLES[emp.role].label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label htmlFor="shift-date">Fecha</Label>
              <Input
                id="shift-date"
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </div>

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="shift-start">Hora inicio</Label>
                <Input
                  id="shift-start"
                  type="time"
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shift-end">Hora fin</Label>
                <Input
                  id="shift-end"
                  type="time"
                  value={formEndTime}
                  onChange={(e) => setFormEndTime(e.target.value)}
                />
              </div>
            </div>

            {/* Role */}
            <div className="space-y-2">
              <Label htmlFor="shift-role">Rol</Label>
              <Select
                value={formRole}
                onValueChange={(v) => v && setFormRole(v as AppRole)}
              >
                <SelectTrigger className="w-full" id="shift-role">
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
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
              <Label htmlFor="shift-notes">Notas (opcional)</Label>
              <Textarea
                id="shift-notes"
                placeholder="Notas adicionales..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleSave} disabled={saving}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar turno</DialogTitle>
            <DialogDescription>
              Esta accion no se puede deshacer. Se eliminara el turno de{' '}
              <strong>
                {deletingShift?.profile ? `${deletingShift.profile.first_name} ${deletingShift.profile.last_name}` : 'este empleado'}
              </strong>{' '}
              del dia{' '}
              <strong>
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
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
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
