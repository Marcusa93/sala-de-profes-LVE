'use client'

import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Users,
  ClipboardList,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  Phone,
  ShieldAlert,
  Pencil,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { FadeIn, StaggerList, StaggerItem, ScalePress, AnimatedNumber, AnimatedSwitch, PulseRing } from '@/components/ui/motion'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { ROLES } from '@/lib/constants'
import type { Profile, AppRole } from '@/types/database'

import { CreateUserDialog } from '@/components/equipo/CreateUserDialog'
import { EditUserDialog } from '@/components/equipo/EditUserDialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttendanceRecord = {
  id: string
  user_id: string
  clock_in_at: string
  clock_out_at: string | null
  status: 'open' | 'closed' | 'missing_checkout'
  clock_out_type?: string | null
  edited_by?: string | null
}

type EmployeeAttendance = {
  profile: Profile
  attendance: AttendanceRecord | null
}

type TabValue = 'asistencia' | 'equipo'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EquipoPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = createClient()

  const [tab, setTab] = useState<TabValue>('asistencia')
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [employees, setEmployees] = useState<EmployeeAttendance[]>([])
  const [allProfiles, setAllProfiles] = useState<Profile[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<Profile | null>(null)

  // Edit egreso
  const [editingEgresoId, setEditingEgresoId] = useState<string | null>(null)
  const [egresoTime, setEgresoTime] = useState('')
  const [egresoReason, setEgresoReason] = useState('')
  const [savingEgreso, setSavingEgreso] = useState(false)

  const isManager = profile?.role === 'socio' || profile?.role === 'encargado'

  const handleSaveEgreso = async (attendanceId: string, operativeDate: string) => {
    if (!egresoTime || savingEgreso) return
    setSavingEgreso(true)
    try {
      const clockOut = new Date(`${operativeDate}T${egresoTime}:00-03:00`)
      // If time is before 06:00, it's next day (after midnight)
      const [h] = egresoTime.split(':').map(Number)
      if (h < 6) {
        clockOut.setDate(clockOut.getDate() + 1)
      }

      const res = await fetch('/api/admin/extend-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendance_id: attendanceId,
          new_clock_out: clockOut.toISOString(),
          reason: egresoReason.trim() || 'Ajuste de egreso por encargado',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      toast.success('Egreso actualizado')
      setEditingEgresoId(null)
      setEgresoTime('')
      setEgresoReason('')
      // Refresh
      fetchAttendance()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setSavingEgreso(false)
    }
  }

  const dateStr = format(selectedDate, 'yyyy-MM-dd')
  const isToday = dateStr === format(new Date(), 'yyyy-MM-dd')

  // ---------------------------------------------------------------------------
  // Fetch data
  // ---------------------------------------------------------------------------

  const fetchAttendance = useCallback(async () => {
    if (!profile) return
    setLoading(true)

    try {
      // Fetch all active profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .eq('is_active', true)
        .order('first_name')

      // Fetch attendance for the selected date
      const { data: attendance } = await supabase
        .from('attendance_logs')
        .select('id, user_id, clock_in_at, clock_out_at, status, clock_out_type, edited_by')
        .eq('operative_date', dateStr)

      const attendanceMap = new Map(
        (attendance ?? []).map((a) => [a.user_id, a as AttendanceRecord]),
      )

      const result: EmployeeAttendance[] = (profiles ?? []).map((p) => ({
        profile: p as Profile,
        attendance: attendanceMap.get(p.id) ?? null,
      }))

      setEmployees(result)
    } catch (err) {
      console.error('Error fetching attendance:', err)
      toast.error('Error al cargar asistencia')
    } finally {
      setLoading(false)
    }
  }, [profile, dateStr, supabase])

  const fetchProfiles = useCallback(async () => {
    if (!profile) return

    try {
      const query = supabase.from('profiles').select('*').order('first_name')
      if (!showInactive) {
        query.eq('is_active', true)
      }

      const { data } = await query
      setAllProfiles((data ?? []) as Profile[])
    } catch (err) {
      console.error('Error fetching profiles:', err)
    }
  }, [profile, showInactive, supabase])

  useEffect(() => {
    if (tab === 'asistencia') fetchAttendance()
    else fetchProfiles()
  }, [tab, fetchAttendance, fetchProfiles])

  // ---------------------------------------------------------------------------
  // Date navigation
  // ---------------------------------------------------------------------------

  function goDay(delta: number) {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + delta)
    if (d <= new Date()) setSelectedDate(d)
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getAttendanceStatus(ea: EmployeeAttendance) {
    if (!ea.attendance) {
      return { label: 'Sin registrar', color: '#ea504c', bg: '#fef2f2', icon: XCircle }
    }
    if (ea.attendance.clock_out_at) {
      return { label: 'Completado', color: '#006d5a', bg: '#e8f5f1', icon: CheckCircle }
    }
    return { label: 'En turno', color: '#d4943a', bg: '#fdf6ec', icon: Clock }
  }

  function getInitials(p: Profile) {
    return `${p.first_name[0] ?? ''}${p.last_name[0] ?? ''}`.toUpperCase()
  }

  function getRoleBadge(role: AppRole) {
    const r = ROLES[role]
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
        style={{ color: r.color, backgroundColor: r.bg }}
      >
        {r.emoji} {r.label}
      </span>
    )
  }

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------

  if (profileLoading) return <LoadingState message="Cargando..." />

  if (!profile || (profile.role !== 'encargado' && profile.role !== 'socio')) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <ShieldAlert className="size-12 text-[#ea504c]" strokeWidth={1.5} />
        <h2 className="font-display text-xl font-semibold text-[#3d2c24]">Acceso restringido</h2>
        <p className="text-sm text-[#a39e97]">Solo el encargado puede gestionar el equipo.</p>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-28">
      {/* Header */}
      <FadeIn className="flex items-center justify-between pt-2">
        <h1 className="font-display text-2xl font-bold text-[#3d2c24]">Equipo</h1>
        <Link
          href="/equipo/turnos"
          className="flex items-center gap-1.5 rounded-xl bg-[#f0f7f5] px-3 py-2 text-xs font-medium text-[#006d5a] transition hover:bg-[#e0efe9]"
        >
          <Calendar className="size-3.5" />
          Turnos
        </Link>
      </FadeIn>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-[#f3efe9] p-1">
        <button
          onClick={() => setTab('asistencia')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            tab === 'asistencia'
              ? 'bg-white text-[#3d2c24] shadow-sm'
              : 'text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          <ClipboardList className="size-4" />
          Asistencia
        </button>
        <button
          onClick={() => setTab('equipo')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            tab === 'equipo'
              ? 'bg-white text-[#3d2c24] shadow-sm'
              : 'text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          <Users className="size-4" />
          Miembros
        </button>
      </div>

      {/* ================================================================= */}
      {/* TAB: ASISTENCIA                                                    */}
      {/* ================================================================= */}
      {tab === 'asistencia' && (
        <div className="space-y-4">
          {/* Date picker */}
          <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-[#ebe6df]">
            <button
              onClick={() => goDay(-1)}
              className="icon-btn"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold capitalize text-[#3d2c24]">
                {isToday
                  ? 'Hoy'
                  : format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
              </p>
              {isToday && (
                <p className="text-xs capitalize text-[#a39e97]">
                  {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
                </p>
              )}
            </div>
            <button
              onClick={() => goDay(1)}
              disabled={isToday}
              className="icon-btn disabled:opacity-30"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>

          {/* Summary badges */}
          {!loading && (
            <div className="flex gap-2">
              {(() => {
                const completed = employees.filter((e) => e.attendance?.clock_out_at).length
                const inProgress = employees.filter(
                  (e) => e.attendance && !e.attendance.clock_out_at,
                ).length
                const missing = employees.filter((e) => !e.attendance).length
                return (
                  <>
                    <span className="rounded-full bg-[#e8f5f1] px-3 py-1 text-xs font-medium text-[#006d5a]">
                      {completed} completados
                    </span>
                    <span className="rounded-full bg-[#fdf6ec] px-3 py-1 text-xs font-medium text-[#d4943a]">
                      {inProgress} en turno
                    </span>
                    <span className="rounded-full bg-[#fef2f2] px-3 py-1 text-xs font-medium text-[#ea504c]">
                      {missing} sin registrar
                    </span>
                  </>
                )
              })()}
            </div>
          )}

          {/* Employee list */}
          {loading ? (
            <LoadingState message="Cargando asistencia..." />
          ) : employees.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin empleados"
              description="No hay empleados activos registrados"
            />
          ) : (
            <div className="space-y-2">
              {employees.map((ea) => {
                const status = getAttendanceStatus(ea)
                const StatusIcon = status.icon
                return (
                  <div
                    key={ea.profile.id}
                    className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-[#ebe6df]"
                    style={{ borderLeftWidth: '3px', borderLeftColor: status.color }}
                  >
                    {/* Avatar */}
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: ROLES[ea.profile.role]?.color ?? '#a39e97' }}
                    >
                      {getInitials(ea.profile)}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[#3d2c24]">
                          {ea.profile.first_name} {ea.profile.last_name}
                        </p>
                        {getRoleBadge(ea.profile.role)}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[#a39e97]">
                        {ea.attendance ? (
                          <>
                            <span className="tabular-nums">
                              {format(new Date(ea.attendance.clock_in_at), 'HH:mm')}
                            </span>
                            <span>→</span>
                            <span className="tabular-nums">
                              {ea.attendance.clock_out_at
                                ? format(new Date(ea.attendance.clock_out_at), 'HH:mm')
                                : '...'}
                            </span>
                          </>
                        ) : (
                          <span>Sin registro</span>
                        )}
                      </div>
                    </div>

                    {/* Status badge + edit button */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ color: status.color, backgroundColor: status.bg }}
                      >
                        <StatusIcon className="size-3" />
                        {status.label}
                      </span>
                      {isManager && ea.attendance && (
                        <button
                          onClick={() => {
                            if (editingEgresoId === ea.attendance!.id) {
                              setEditingEgresoId(null)
                            } else {
                              setEditingEgresoId(ea.attendance!.id)
                              setEgresoTime(ea.attendance!.clock_out_at
                                ? format(new Date(ea.attendance!.clock_out_at), 'HH:mm')
                                : ''
                              )
                              setEgresoReason('')
                            }
                          }}
                          className="rounded-lg p-1.5 text-[#a39e97] hover:bg-[#f3efe9] hover:text-[#3d2c24]"
                          title="Editar egreso"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Inline edit egreso */}
                    {editingEgresoId === ea.attendance?.id && ea.attendance && (
                      <div className="col-span-full mt-2 rounded-lg bg-[#faf8f5] p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-[#3d2c24]">Egreso:</label>
                          <input
                            type="time"
                            value={egresoTime}
                            onChange={(e) => setEgresoTime(e.target.value)}
                            className="rounded-lg border border-[#ebe6df] bg-white px-2.5 py-1.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                          />
                        </div>
                        <input
                          value={egresoReason}
                          onChange={(e) => setEgresoReason(e.target.value)}
                          placeholder="Motivo (opcional)"
                          className="w-full rounded-lg border border-[#ebe6df] bg-white px-2.5 py-1.5 text-sm placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingEgresoId(null)}
                            className="flex-1 rounded-lg border border-[#ebe6df] py-2 text-xs font-semibold text-[#a39e97] hover:bg-white"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => {
                              handleSaveEgreso(
                                ea.attendance!.id,
                                format(selectedDate, 'yyyy-MM-dd')
                              )
                            }}
                            disabled={!egresoTime || savingEgreso}
                            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#006d5a] py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {savingEgreso ? <Loader2 className="size-3 animate-spin" /> : null}
                            Guardar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB: EQUIPO (MIEMBROS)                                            */}
      {/* ================================================================= */}
      {tab === 'equipo' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowInactive(!showInactive)}
              className="text-xs font-medium text-[#a39e97] transition hover:text-[#3d2c24]"
            >
              {showInactive ? 'Ocultar inactivos' : 'Mostrar inactivos'}
            </button>
            <Button
              onClick={() => setCreateOpen(true)}
              size="sm"
              className="gap-1.5 bg-[#006d5a] text-white hover:bg-[#005a4a]"
            >
              <Plus className="size-4" />
              Nuevo
            </Button>
          </div>

          {/* Members list */}
          {allProfiles.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin miembros"
              description="Creá el primer miembro del equipo"
            />
          ) : (
            <div className="space-y-2">
              {allProfiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setEditUser(p)}
                  className="flex w-full items-center gap-3 rounded-xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-[#ebe6df] transition hover:ring-[#006d5a]/20"
                >
                  {/* Avatar */}
                  <div
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                      !p.is_active ? 'opacity-40' : ''
                    }`}
                    style={{ backgroundColor: ROLES[p.role]?.color ?? '#a39e97' }}
                  >
                    {getInitials(p)}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={`truncate text-sm font-semibold ${p.is_active ? 'text-[#3d2c24]' : 'text-[#a39e97] line-through'}`}
                      >
                        {p.first_name} {p.last_name}
                      </p>
                      {getRoleBadge(p.role)}
                      {!p.is_active && (
                        <span className="rounded-full bg-[#f3efe9] px-2 py-0.5 text-[10px] font-medium text-[#a39e97]">
                          Inactivo
                        </span>
                      )}
                    </div>
                    {p.phone && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-[#a39e97]">
                        <Phone className="size-3" />
                        {p.phone}
                      </div>
                    )}
                  </div>

                  <ChevronRight className="size-4 shrink-0 text-[#d1cdc7]" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={fetchProfiles}
      />
      <EditUserDialog
        open={!!editUser}
        onOpenChange={(open) => { if (!open) setEditUser(null) }}
        user={editUser}
        onUpdated={() => {
          fetchProfiles()
          if (tab === 'asistencia') fetchAttendance()
        }}
      />
    </div>
  )
}
