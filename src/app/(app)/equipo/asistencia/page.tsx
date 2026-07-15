'use client'

import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  RefreshCw, CheckCircle, Clock, AlertTriangle, UserX, Check, X,
  ShieldAlert, Loader2, ChevronDown, ChevronUp, Timer, MinusCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { ROLES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { AttendanceDashboardRow } from '@/types/database'
import type { AppRole } from '@/types/database'

type Correction = {
  id: string
  employee: { first_name: string; last_name: string; role: string } | null
  requester: { first_name: string; last_name: string } | null
  correction_type: string
  reason: string
  status: string
  created_at: string
  new_value: Record<string, unknown>
}

type HistoryRecord = {
  id: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
  is_suspicious: boolean
}

const ROLE_ORDER: AppRole[] = ['encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha']

function fmtDuration(start: string, end: string | null): string {
  if (!end) return ''
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms <= 0) return ''
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60), m = totalMin % 60
  return h === 0 ? `${m}m` : `${h}h ${m > 0 ? `${m}m` : ''}`
}

// ---------------------------------------------------------------------------
// Employee row with expandable history
// ---------------------------------------------------------------------------
function EmployeeRow({
  emp,
  isExpanded,
  history,
  loadingHistory,
  onToggle,
}: {
  emp: AttendanceDashboardRow
  isExpanded: boolean
  history: HistoryRecord[] | null
  loadingHistory: boolean
  onToggle: () => void
}) {
  const roleConfig = ROLES[emp.role as AppRole] ?? { label: emp.role, color: '#a39e97', bg: '#f3efe9', emoji: '👤' }
  const hoursStr = emp.total_hours > 0
    ? `${Math.floor(emp.total_hours)}h ${Math.round((emp.total_hours % 1) * 60)}m`
    : null

  return (
    <div className={cn(
      'overflow-hidden rounded-xl border transition-colors',
      isExpanded ? 'border-[#006d5a]/30 bg-[#f7fbf9]' : 'border-[#ebe6df] bg-white',
      emp.open_anomalies > 0 && 'border-l-2 border-l-[#ea504c]',
    )}>
      {/* Row header — clickable */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        {/* Role avatar */}
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm" style={{ backgroundColor: roleConfig.bg }}>
          {roleConfig.emoji}
        </div>

        {/* Name + role */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#3d2c24]">
            {emp.first_name} {emp.last_name}
          </p>
          <span className="text-[10px] font-semibold" style={{ color: roleConfig.color }}>
            {roleConfig.label}
          </span>
        </div>

        {/* Status */}
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {emp.is_currently_in ? (
            <>
              <div className="flex items-center gap-1 text-[#006d5a]">
                <CheckCircle className="size-3.5" />
                <span className="text-xs font-semibold">Presente</span>
              </div>
              {hoursStr && <span className="text-[10px] text-[#a39e97]">{hoursStr}</span>}
            </>
          ) : emp.last_event_time ? (
            <>
              <div className="flex items-center gap-1 text-[#a39e97]">
                <Clock className="size-3.5" />
                <span className="text-xs">Salió</span>
              </div>
              <span className="text-[10px] text-[#a39e97]">
                {format(new Date(emp.last_event_time), 'HH:mm')}
              </span>
            </>
          ) : (
            <div className="flex items-center gap-1 text-[#d4943a]">
              <UserX className="size-3.5" />
              <span className="text-xs">Sin fichar</span>
            </div>
          )}
          {emp.open_anomalies > 0 && (
            <div className="flex items-center gap-0.5 text-[#ea504c]">
              <AlertTriangle className="size-3" />
              <span className="text-[10px]">{emp.open_anomalies} anomalía{emp.open_anomalies > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Expand chevron */}
        <div className="ml-1 shrink-0 text-[#a39e97]">
          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </div>
      </button>

      {/* Expandable history */}
      {isExpanded && (
        <div className="border-t border-[#ebe6df] px-3 pb-3 pt-2">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-4 animate-spin text-[#a39e97]" />
              <span className="ml-2 text-xs text-[#a39e97]">Cargando historial...</span>
            </div>
          ) : !history || history.length === 0 ? (
            <p className="py-4 text-center text-xs text-[#a39e97]">Sin registros en los últimos 14 días.</p>
          ) : (
            <div className="space-y-1">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                Últimos {history.length} días
              </p>
              {history.map(r => {
                const duration = fmtDuration(r.clock_in_at, r.clock_out_at)
                const isCompleto = !!r.clock_out_at
                const isSinEgreso = r.status === 'open'
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2.5 py-2',
                      r.is_suspicious ? 'bg-amber-50' : isCompleto ? 'bg-white' : 'bg-[#fef2f2]',
                    )}
                  >
                    {/* Date */}
                    <div className="w-16 shrink-0">
                      <p className="text-[10px] font-semibold capitalize text-[#3d2c24]">
                        {format(new Date(r.operative_date + 'T12:00:00'), 'EEE d', { locale: es })}
                      </p>
                      <p className="text-[9px] capitalize text-[#a39e97]">
                        {format(new Date(r.operative_date + 'T12:00:00'), 'MMMM', { locale: es })}
                      </p>
                    </div>

                    {/* Times */}
                    <div className="flex flex-1 items-center gap-1.5 font-mono text-xs tabular-nums">
                      <span className="text-[#3d2c24]">{format(new Date(r.clock_in_at), 'HH:mm')}</span>
                      <span className="text-[#d1cdc7]">→</span>
                      <span className={isSinEgreso ? 'text-[#ea504c]' : 'text-[#3d2c24]'}>
                        {r.clock_out_at ? format(new Date(r.clock_out_at), 'HH:mm') : '--:--'}
                      </span>
                    </div>

                    {/* Duration */}
                    {duration && (
                      <div className="flex items-center gap-1 text-[10px] text-[#a39e97]">
                        <Timer className="size-3" />
                        <span>{duration}</span>
                      </div>
                    )}

                    {/* Status badge */}
                    <div className="shrink-0">
                      {r.is_suspicious ? (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">⚠</span>
                      ) : isCompleto ? (
                        <CheckCircle className="size-3.5 text-[#006d5a]" />
                      ) : (
                        <MinusCircle className="size-3.5 text-[#ea504c]" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function EquipoAsistenciaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const isEncargado = isManagerOrAbove(profile?.role)

  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), "EEEE d 'de' MMMM", { locale: es })

  const [employees, setEmployees] = useState<AttendanceDashboardRow[]>([])
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)

  // Expanded employee + history cache
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [historyCache, setHistoryCache] = useState<Record<string, HistoryRecord[]>>({})
  const [loadingHistoryFor, setLoadingHistoryFor] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [dashRes, corrRes] = await Promise.all([
        fetch(`/api/attendance/dashboard?from=${today}&to=${today}`),
        fetch('/api/attendance/corrections?status=pending'),
      ])
      const dash = await dashRes.json()
      const corr = await corrRes.json()
      setEmployees(dash.employees ?? [])
      setCorrections(corr.corrections ?? [])
    } catch {
      toast.error('No se pudo cargar la asistencia')
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => {
    if (isEncargado) fetchData()
  }, [isEncargado, fetchData])

  async function toggleEmployee(empId: string) {
    if (expandedId === empId) {
      setExpandedId(null)
      return
    }
    setExpandedId(empId)
    if (historyCache[empId]) return // already fetched

    setLoadingHistoryFor(empId)
    try {
      const res = await fetch(`/api/attendance/history?user_id=${empId}&limit=14`)
      const data = await res.json()
      setHistoryCache(prev => ({ ...prev, [empId]: data.records ?? [] }))
    } catch {
      toast.error('No se pudo cargar el historial')
      setHistoryCache(prev => ({ ...prev, [empId]: [] }))
    } finally {
      setLoadingHistoryFor(null)
    }
  }

  async function handleCorrection(id: string, action: 'approved' | 'rejected') {
    setProcessingId(id)
    try {
      const res = await fetch('/api/attendance/corrections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: action }),
      })
      if (!res.ok) throw new Error()
      toast.success(action === 'approved' ? 'Corrección aprobada' : 'Corrección rechazada')
      setCorrections(prev => prev.filter(c => c.id !== id))
    } catch {
      toast.error('No se pudo procesar la corrección')
    } finally {
      setProcessingId(null)
    }
  }

  if (profileLoading) return <LoadingState />

  if (!profile || !isEncargado) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#e8f5f1]">
            <ShieldAlert className="size-7 text-[#006d5a]" />
          </div>
          <p className="text-sm text-[#a39e97]">Solo los encargados pueden ver este panel.</p>
        </div>
      </div>
    )
  }

  const sorted = [...employees].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.role as AppRole)
    const bi = ROLE_ORDER.indexOf(b.role as AppRole)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const present = employees.filter(e => e.is_currently_in).length
  const anomalyCount = employees.reduce((s, e) => s + e.open_anomalies, 0)
  const pendingCount = corrections.length

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">Asistencia</h1>
          <p className="section-label mt-1 capitalize">{todayLabel}</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-xs font-semibold text-[#3d2c24] hover:border-[#006d5a] hover:text-[#006d5a] disabled:opacity-50"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Actualizar
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card-elevated rounded-xl p-3 text-center">
          <p className="font-display text-2xl font-bold text-[#006d5a]">{present}</p>
          <p className="mt-0.5 text-[10px] text-[#a39e97]">Presentes</p>
        </div>
        <div className="card-elevated rounded-xl p-3 text-center">
          <p className="font-display text-2xl font-bold text-[#3d2c24]">{employees.length - present}</p>
          <p className="mt-0.5 text-[10px] text-[#a39e97]">Fuera / Sin fichar</p>
        </div>
        <div className={cn('rounded-xl p-3 text-center', anomalyCount > 0 ? 'bg-[#fef2f2]' : 'card-elevated')}>
          <p className={cn('font-display text-2xl font-bold', anomalyCount > 0 ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>{anomalyCount}</p>
          <p className={cn('mt-0.5 text-[10px]', anomalyCount > 0 ? 'text-[#ea504c]' : 'text-[#a39e97]')}>Anomalías</p>
        </div>
      </div>

      {loading ? (
        <LoadingState message="Cargando asistencia..." />
      ) : (
        <>
          {/* Employee list */}
          <div className="space-y-1.5">
            <p className="section-label px-1">Equipo — tocá para ver historial</p>
            {sorted.map(emp => (
              <EmployeeRow
                key={emp.employee_id}
                emp={emp}
                isExpanded={expandedId === emp.employee_id}
                history={historyCache[emp.employee_id] ?? null}
                loadingHistory={loadingHistoryFor === emp.employee_id}
                onToggle={() => toggleEmployee(emp.employee_id)}
              />
            ))}
            {sorted.length === 0 && (
              <div className="rounded-xl border border-[#ebe6df] bg-white p-8 text-center text-sm text-[#a39e97]">
                No hay empleados registrados.
              </div>
            )}
          </div>

          {/* Corrections pending */}
          {corrections.length > 0 && (
            <div className="space-y-2">
              <p className="section-label flex items-center gap-1.5 px-1">
                <AlertTriangle className="size-3.5 text-[#d4943a]" />
                Correcciones pendientes ({pendingCount})
              </p>
              {corrections.map(c => {
                const emp = c.employee
                const roleConfig = emp ? (ROLES[emp.role as AppRole] ?? { label: emp.role, color: '#a39e97' }) : null
                return (
                  <div key={c.id} className="rounded-xl border border-[#e8c97c] bg-[#fdf6ec] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#3d2c24]">
                          {emp ? `${emp.first_name} ${emp.last_name}` : 'Empleado'}
                          {roleConfig && (
                            <span className="ml-1.5 text-[10px] font-medium" style={{ color: roleConfig.color }}>
                              {roleConfig.label}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-[#8b5e34]">
                          {c.correction_type === 'add_entry' ? 'Agregar entrada' :
                           c.correction_type === 'add_exit' ? 'Agregar salida' :
                           c.correction_type === 'add_missing' ? 'Agregar fichaje' :
                           c.correction_type === 'change_time' ? 'Cambiar horario' :
                           c.correction_type === 'remove_event' ? 'Eliminar fichaje' : c.correction_type}
                          {' · '}{format(new Date(c.created_at), "d MMM, HH:mm", { locale: es })}
                        </p>
                        <p className="mt-1 text-xs text-[#3d2c24]">"{c.reason}"</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => handleCorrection(c.id, 'approved')}
                          disabled={processingId === c.id}
                          className="flex size-8 items-center justify-center rounded-lg bg-[#006d5a] text-white disabled:opacity-50"
                        >
                          {processingId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        </button>
                        <button
                          onClick={() => handleCorrection(c.id, 'rejected')}
                          disabled={processingId === c.id}
                          className="flex size-8 items-center justify-center rounded-lg border border-[#ebe6df] bg-white text-[#ea504c] disabled:opacity-50"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
