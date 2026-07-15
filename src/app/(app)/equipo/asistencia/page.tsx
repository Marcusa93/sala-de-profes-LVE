'use client'

import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  RefreshCw, CheckCircle, Clock, AlertTriangle, UserX, Check, X,
  ShieldAlert, Loader2,
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

const ROLE_ORDER: AppRole[] = ['encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha']

export default function EquipoAsistenciaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const isEncargado = isManagerOrAbove(profile?.role)

  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), "EEEE d 'de' MMMM", { locale: es })

  const [employees, setEmployees] = useState<AttendanceDashboardRow[]>([])
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)

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

  // Sort employees by role order
  const sorted = [...employees].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.role as AppRole)
    const bi = ROLE_ORDER.indexOf(b.role as AppRole)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const present = employees.filter(e => e.is_currently_in).length
  const total = employees.length
  const pendingCount = corrections.length
  const anomalyCount = employees.reduce((s, e) => s + e.open_anomalies, 0)

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
          <p className="font-display text-2xl font-bold text-[#3d2c24]">{total - present}</p>
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
            {sorted.map(emp => {
              const roleConfig = ROLES[emp.role as AppRole] ?? { label: emp.role, color: '#a39e97', bg: '#f3efe9', emoji: '👤' }
              const hoursStr = emp.total_hours > 0 ? `${Math.floor(emp.total_hours)}h ${Math.round((emp.total_hours % 1) * 60)}m` : null
              return (
                <div
                  key={emp.employee_id}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-3 py-3',
                    emp.is_currently_in ? 'border-[#006d5a]/20 bg-[#f0faf7]' : 'border-[#ebe6df] bg-white',
                    emp.open_anomalies > 0 && 'border-l-2 border-l-[#ea504c]',
                  )}
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
                  <div className="flex flex-col items-end gap-0.5">
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
                </div>
              )
            })}

            {sorted.length === 0 && (
              <div className="rounded-xl border border-[#ebe6df] bg-white p-8 text-center text-sm text-[#a39e97]">
                No hay empleados registrados.
              </div>
            )}
          </div>

          {/* Corrections pending */}
          {corrections.length > 0 && (
            <div className="space-y-2">
              <p className="section-label flex items-center gap-1.5">
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
                           c.correction_type === 'modify' ? 'Modificar fichaje' :
                           c.correction_type === 'delete' ? 'Eliminar fichaje' : c.correction_type}
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
