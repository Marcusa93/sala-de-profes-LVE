'use client'

import { useEffect, useState, useCallback } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
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
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
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
import { logAuditClient } from '@/lib/audit'

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

  // Excel upload
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    created: number; skipped: number; errors: number
    details: { created: string[]; skipped: string[]; errors: string[] }
  } | null>(null)
  const [showUploadResult, setShowUploadResult] = useState(false)

  // Replace confirmation
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [existingCount, setExistingCount] = useState(0)

  // Preview
  const [previewData, setPreviewData] = useState<{ name: string; shifts: { day: string; time: string }[] }[] | null>(null)
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false)

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setPendingFile(file)

    // Quick client-side preview using xlsx
    try {
      const XLSX = (await import('xlsx'))
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })

      const dayNames = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo']
      const preview: { name: string; shifts: { day: string; time: string }[] }[] = []
      let currentRole = ''

      for (const row of rows) {
        if (!row || row.length === 0) continue
        const first = String(row[0] ?? '').trim()
        if (!first) continue

        // Role header (all uppercase, no time data)
        if (first === first.toUpperCase() && first.length > 2 && !String(row[1] ?? '').match(/\d/)) {
          currentRole = first
          continue
        }

        // Employee row
        const shifts: { day: string; time: string }[] = []
        for (let i = 1; i <= 7 && i < row.length; i++) {
          const val = String(row[i] ?? '').trim()
          if (!val) continue
          const day = dayNames[i - 1] ?? `Día ${i}`
          shifts.push({ day, time: val })
        }

        if (shifts.length > 0) {
          preview.push({ name: `${first}${currentRole ? ` (${currentRole.toLowerCase()})` : ''}`, shifts })
        }
      }

      setPreviewData(preview)
      setPreviewDialogOpen(true)
    } catch {
      // If preview fails, go straight to upload
      await checkAndUpload(file)
    }
  }

  const confirmPreviewUpload = async () => {
    setPreviewDialogOpen(false)
    if (!pendingFile) return
    await checkAndUpload(pendingFile)
  }

  const checkAndUpload = async (file: File) => {
    // Check if shifts already exist for this week
    try {
      const checkForm = new FormData()
      checkForm.append('checkOnly', 'true')
      checkForm.append('weekStart', format(currentWeekStart, 'yyyy-MM-dd'))
      const checkRes = await fetch('/api/shifts/upload', { method: 'POST', body: checkForm })
      const checkData = await checkRes.json()

      if (checkData.exists && checkData.count > 0) {
        setExistingCount(checkData.count)
        setReplaceDialogOpen(true)
        return
      }
    } catch {
      // If check fails, proceed
    }

    await doUpload(file, false)
  }

  const doUpload = async (file: File, replace: boolean) => {
    setUploading(true)
    setReplaceDialogOpen(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('weekStart', format(currentWeekStart, 'yyyy-MM-dd'))
      if (replace) formData.append('replace', 'true')

      const res = await fetch('/api/shifts/upload', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error)

      setUploadResult(data)
      setShowUploadResult(true)

      if (data.created > 0) {
        toast.success(`${data.created} turno${data.created > 1 ? 's' : ''} ${replace ? 'reemplazado' : 'creado'}${data.created > 1 ? 's' : ''}`)
        await fetchShifts()
      }
      if (data.skipped > 0 && !replace) {
        toast.info(`${data.skipped} turno${data.skipped > 1 ? 's' : ''} ya existía${data.skipped > 1 ? 'n' : ''}`)
      }
      if (data.errors > 0) {
        toast.error(`${data.errors} fila${data.errors > 1 ? 's' : ''} con error`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al procesar archivo')
    } finally {
      setUploading(false)
      setPendingFile(null)
    }
  }

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

  const isEncargado = isManagerOrAbove(profile?.role)

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
        const emp = employees.find(e => e.id === formUserId)
        toast.success('Turno actualizado correctamente')
        logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'update_shift', module: 'turnos', entityType: 'shift', description: `Admin editó turno de: ${emp?.first_name ?? formUserId}` })
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
        const emp = employees.find(e => e.id === formUserId)
        toast.success('Turno creado correctamente')
        logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'create_shift', module: 'turnos', entityType: 'shift', description: `Admin creó turno para: ${emp?.first_name ?? formUserId}` })
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
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'delete_shift', module: 'turnos', entityType: 'shift', description: `Admin eliminó turno de: ${deletingShift.profile?.first_name ?? deletingShift.user_id}` })
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">
            Turnos del Equipo
          </h1>
          <p className="section-label mt-2">
            Gestiona los horarios de todo tu equipo
          </p>
        </div>
        <div className="flex gap-2">
          {/* Upload Excel */}
          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-xs font-semibold text-[#3d2c24] transition-colors hover:border-[#006d5a] hover:text-[#006d5a]">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            <span className="hidden sm:inline">Subir Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
          {/* Create shift */}
          <button
            onClick={openCreateDialog}
            className="flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#005a4a]"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">Nuevo turno</span>
          </button>
        </div>
      </div>

      {/* Upload result banner */}
      {showUploadResult && uploadResult && (
        <div className="rounded-xl border border-[#ebe6df] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-[#006d5a]" />
              <span className="text-sm font-semibold text-[#3d2c24]">Resultado de carga</span>
            </div>
            <button onClick={() => setShowUploadResult(false)} className="text-xs text-[#a39e97] hover:text-[#3d2c24]">Cerrar</button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-[#e8f5f1] p-2">
              <p className="font-bold text-[#006d5a]">{uploadResult.created}</p>
              <p className="text-[#006d5a]">Creados</p>
            </div>
            <div className="rounded-lg bg-[#fdf6ec] p-2">
              <p className="font-bold text-[#d4943a]">{uploadResult.skipped}</p>
              <p className="text-[#d4943a]">Duplicados</p>
            </div>
            <div className="rounded-lg bg-[#fef2f2] p-2">
              <p className="font-bold text-[#ea504c]">{uploadResult.errors}</p>
              <p className="text-[#ea504c]">Errores</p>
            </div>
          </div>
          {uploadResult.details.errors.length > 0 && (
            <div className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-[#fef2f2] p-2 text-[11px] text-[#ea504c]">
              {uploadResult.details.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
        </div>
      )}

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
          {/* PLANILLA: Filas = empleados, Cols = días  */}
          {/* Agrupado por rol                         */}
          {/* ======================================== */}
          {(() => {
            // Group employees by role with their shifts
            const roleOrder: AppRole[] = ['encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha' as AppRole]
            const employeesWithShifts = employees.map(emp => {
              const empShifts = weekDays.map(day => {
                const dayStr = format(day, 'yyyy-MM-dd')
                return shifts.find(s => s.user_id === emp.id && s.shift_date === dayStr) ?? null
              })
              return { ...emp, weekShifts: empShifts }
            })

            const byRole = new Map<string, typeof employeesWithShifts>()
            for (const emp of employeesWithShifts) {
              const role = emp.role
              if (!byRole.has(role)) byRole.set(role, [])
              byRole.get(role)!.push(emp)
            }

            // Sort roles
            const sortedRoles = roleOrder.filter(r => byRole.has(r))
            // Add any roles not in the order
            for (const r of byRole.keys()) {
              if (!sortedRoles.includes(r as AppRole)) sortedRoles.push(r as AppRole)
            }

            return (
              <div className="space-y-4">
                {/* Day headers — sticky */}
                <div className="overflow-x-auto -mx-4 px-4 scrollbar-none">
                  <div className="min-w-[700px]">
                    <div className="grid grid-cols-[140px_repeat(7,1fr)] gap-1">
                      <div /> {/* empty cell for name column */}
                      {weekDays.map(day => {
                        const isToday = isSameDay(day, new Date())
                        return (
                          <div
                            key={day.toISOString()}
                            className={`rounded-lg px-1 py-2 text-center text-[11px] font-semibold ${
                              isToday ? 'bg-[#006d5a] text-white' : 'bg-[#f8f5f0] text-[#3d2c24]'
                            }`}
                          >
                            <span className="uppercase">{format(day, 'EEE', { locale: es })}</span>
                            <span className="ml-1 tabular-nums">{format(day, 'd')}</span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Roles + employees */}
                    {sortedRoles.map(role => {
                      const roleEmps = byRole.get(role) ?? []
                      if (roleEmps.length === 0) return null
                      const roleConfig = ROLES[role] ?? { label: role, emoji: '👤', color: '#a39e97', bg: '#f3efe9' }

                      return (
                        <div key={role} className="mt-3">
                          {/* Role header */}
                          <div className="mb-1 flex items-center gap-1.5 px-1">
                            <span className="text-sm">{roleConfig.emoji}</span>
                            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: roleConfig.color }}>
                              {roleConfig.label}s
                            </span>
                            <span className="text-[10px] text-[#a39e97]">({roleEmps.length})</span>
                          </div>

                          {/* Employee rows */}
                          {roleEmps.map(emp => (
                            <div
                              key={emp.id}
                              className="grid grid-cols-[140px_repeat(7,1fr)] gap-1 mb-1"
                            >
                              {/* Name cell */}
                              <div className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-2 ring-1 ring-[#ebe6df]">
                                <div
                                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                                  style={{ backgroundColor: roleConfig.color }}
                                >
                                  {(emp.first_name?.[0] ?? '')}{(emp.last_name?.[0] ?? '')}
                                </div>
                                <span className="truncate text-xs font-medium text-[#3d2c24]">
                                  {emp.first_name}
                                </span>
                              </div>

                              {/* Day cells */}
                              {emp.weekShifts.map((shift, i) => {
                                const day = weekDays[i]
                                const isToday = isSameDay(day, new Date())

                                if (!shift) {
                                  return (
                                    <div
                                      key={day.toISOString()}
                                      className={`flex items-center justify-center rounded-lg text-[10px] ${
                                        isToday ? 'bg-[#f0f7f5] ring-1 ring-[#006d5a]/20' : 'bg-[#faf8f5]'
                                      } text-[#d1cdc7] cursor-pointer hover:bg-[#f3efe9]`}
                                      onClick={() => {
                                        setEditingShift(null)
                                        setFormUserId(emp.id)
                                        setFormDate(format(day, 'yyyy-MM-dd'))
                                        setFormStartTime('08:00')
                                        setFormEndTime('16:00')
                                        setFormRole(emp.role)
                                        setFormNotes('')
                                        setDialogOpen(true)
                                      }}
                                    >
                                      —
                                    </div>
                                  )
                                }

                                // Has shift
                                const time = `${shift.start_time.slice(0, 5)}-${shift.end_time.slice(0, 5)}`
                                const isDescanso = shift.notes?.toLowerCase().includes('descanso')

                                return (
                                  <div
                                    key={day.toISOString()}
                                    className={`group relative flex flex-col items-center justify-center rounded-lg px-1 py-1.5 cursor-pointer transition-colors ${
                                      isDescanso
                                        ? 'bg-[#f3efe9] text-[#a39e97]'
                                        : isToday
                                          ? 'bg-[#e8f5f1] ring-1 ring-[#006d5a]/30'
                                          : 'bg-white ring-1 ring-[#ebe6df]'
                                    } hover:ring-[#006d5a]/50`}
                                    onClick={() => openEditDialog(shift)}
                                  >
                                    {isDescanso ? (
                                      <span className="text-[10px] font-medium">Desc.</span>
                                    ) : (
                                      <>
                                        <span className="text-[10px] font-bold tabular-nums text-[#3d2c24]">
                                          {time}
                                        </span>
                                      </>
                                    )}
                                    {/* Delete on hover */}
                                    <button
                                      className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-[#ea504c] text-white shadow-sm group-hover:flex"
                                      onClick={(e) => { e.stopPropagation(); openDeleteDialog(shift) }}
                                    >
                                      <Trash2 className="size-2.5" />
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Mobile: compact list by employee */}
                <div className="md:hidden space-y-3">
                  {sortedRoles.map(role => {
                    const roleEmps = byRole.get(role) ?? []
                    if (roleEmps.length === 0) return null
                    const roleConfig = ROLES[role] ?? { label: role, emoji: '👤', color: '#a39e97', bg: '#f3efe9' }

                    return (
                      <div key={role}>
                        <div className="mb-2 flex items-center gap-1.5">
                          <span>{roleConfig.emoji}</span>
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: roleConfig.color }}>
                            {roleConfig.label}s
                          </span>
                        </div>
                        {roleEmps.map(emp => (
                          <div key={emp.id} className="mb-2 rounded-xl bg-white p-3 ring-1 ring-[#ebe6df]">
                            <p className="text-sm font-semibold text-[#3d2c24]">{emp.first_name} {emp.last_name}</p>
                            <div className="mt-2 grid grid-cols-7 gap-1">
                              {emp.weekShifts.map((shift, i) => {
                                const day = weekDays[i]
                                const isToday = isSameDay(day, new Date())
                                const dayLabel = format(day, 'EEE', { locale: es }).slice(0, 2).toUpperCase()

                                return (
                                  <div key={day.toISOString()} className="text-center">
                                    <p className={`text-[9px] font-semibold ${isToday ? 'text-[#006d5a]' : 'text-[#a39e97]'}`}>
                                      {dayLabel}
                                    </p>
                                    {shift ? (
                                      <button
                                        onClick={() => openEditDialog(shift)}
                                        className={`mt-0.5 w-full rounded-md px-0.5 py-1 text-[9px] font-bold tabular-nums ${
                                          shift.notes?.toLowerCase().includes('descanso')
                                            ? 'bg-[#f3efe9] text-[#a39e97]'
                                            : isToday
                                              ? 'bg-[#e8f5f1] text-[#006d5a]'
                                              : 'bg-[#faf8f5] text-[#3d2c24]'
                                        }`}
                                      >
                                        {shift.notes?.toLowerCase().includes('descanso')
                                          ? 'D'
                                          : `${shift.start_time.slice(0, 2)}-${shift.end_time.slice(0, 2)}`
                                        }
                                      </button>
                                    ) : (
                                      <div className="mt-0.5 rounded-md bg-[#faf8f5] py-1 text-[9px] text-[#d1cdc7]">—</div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

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
        className="fixed bottom-24 right-5 z-40 flex size-14 items-center justify-center rounded-full bg-[#006d5a] text-white shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-8 md:right-8"
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

      {/* ========================================== */}
      {/* Preview Dialog                             */}
      {/* ========================================== */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">
              Preview del archivo
            </DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              {previewData?.length ?? 0} empleados detectados. Verificá antes de importar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            {previewData?.map((emp, i) => (
              <div key={i} className="rounded-xl border border-[#ebe6df] bg-white p-3">
                <p className="text-sm font-semibold text-[#3d2c24]">{emp.name}</p>
                <div className="mt-1.5 grid grid-cols-7 gap-1">
                  {emp.shifts.map((s, j) => {
                    const isDescanso = s.time.toLowerCase().includes('descanso') || s.time.toLowerCase().includes('franco') || s.time === '-' || s.time === 'X'
                    return (
                      <div key={j} className="text-center">
                        <p className="text-[8px] font-semibold text-[#a39e97]">{s.day.slice(0, 3)}</p>
                        <p className={`text-[9px] font-bold mt-0.5 ${isDescanso ? 'text-[#a39e97]' : 'text-[#3d2c24]'}`}>
                          {isDescanso ? 'D' : s.time.replace(/ [Aa] /g, '-').slice(0, 9)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1 rounded-xl border-[#ebe6df] text-[#a39e97]"
              onClick={() => { setPreviewDialogOpen(false); setPendingFile(null); setPreviewData(null) }}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 rounded-xl bg-[#006d5a] text-white hover:bg-[#005a4a]"
              onClick={confirmPreviewUpload}
            >
              <CheckCircle className="size-4 mr-1" />
              Importar turnos
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ========================================== */}
      {/* Replace Confirmation Dialog                */}
      {/* ========================================== */}
      <Dialog open={replaceDialogOpen} onOpenChange={setReplaceDialogOpen}>
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">
              Ya hay turnos cargados
            </DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              Esta semana ya tiene <strong className="text-[#3d2c24]">{existingCount} turnos</strong> cargados.
              ¿Qué querés hacer?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Button
              className="w-full rounded-xl bg-[#ea504c] text-white hover:bg-[#d4413e]"
              onClick={() => pendingFile && doUpload(pendingFile, true)}
            >
              Reemplazar todos los turnos de la semana
            </Button>
            <Button
              variant="outline"
              className="w-full rounded-xl border-[#ebe6df] text-[#3d2c24]"
              onClick={() => pendingFile && doUpload(pendingFile, false)}
            >
              Agregar sin borrar los existentes
            </Button>
            <Button
              variant="outline"
              className="w-full rounded-xl border-[#ebe6df] text-[#a39e97]"
              onClick={() => { setReplaceDialogOpen(false); setPendingFile(null) }}
            >
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
