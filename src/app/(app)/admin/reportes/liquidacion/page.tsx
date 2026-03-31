'use client'

import { useState, useCallback } from 'react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock, Users, AlertTriangle, Download, DollarSign,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Loader2,
} from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'

type DayDetail = {
  date: string
  hours: number
  clockIn: string
  clockOut: string | null
  status: string
  clockOutType: string
}

type Employee = {
  id: string
  firstName: string
  lastName: string
  role: string
  hourlyRate: number
  totalHours: number
  totalDays: number
  avgHoursPerDay: number
  missingCheckouts: number
  totalPay: number
  days: DayDetail[]
}

type Summary = {
  totalEmployees: number
  totalHours: number
  totalDays: number
  totalPay: number
  missingCheckouts: number
}

const PERIOD_OPTIONS = [
  { key: '1q', label: '1° Quincena' },
  { key: '2q', label: '2° Quincena' },
  { key: 'mes', label: 'Mes completo' },
] as const

export default function LiquidacionPage() {
  const [refDate, setRefDate] = useState(new Date())
  const [periodType, setPeriodType] = useState<string>('mes')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const getPeriod = useCallback(() => {
    const monthStart = startOfMonth(refDate)
    const monthEnd = endOfMonth(refDate)
    if (periodType === '1q') {
      return {
        from: format(monthStart, 'yyyy-MM-dd'),
        to: format(new Date(refDate.getFullYear(), refDate.getMonth(), 15), 'yyyy-MM-dd'),
      }
    }
    if (periodType === '2q') {
      return {
        from: format(new Date(refDate.getFullYear(), refDate.getMonth(), 16), 'yyyy-MM-dd'),
        to: format(monthEnd, 'yyyy-MM-dd'),
      }
    }
    return { from: format(monthStart, 'yyyy-MM-dd'), to: format(monthEnd, 'yyyy-MM-dd') }
  }, [refDate, periodType])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = getPeriod()
      const res = await fetch(`/api/admin/liquidacion?from=${from}&to=${to}`, { credentials: 'include' })
      const json = await res.json()
      if (json.employees) {
        setEmployees(json.employees)
        setSummary(json.summary)
        setLoaded(true)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [getPeriod])

  const formatMoney = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const handleExport = () => {
    if (!employees.length) return
    const { from, to } = getPeriod()
    const header = 'Nombre,Rol,Tarifa/h,Días,Horas,Sin egreso,Total a pagar\n'
    const rows = employees.map(e =>
      `"${e.firstName} ${e.lastName}",${e.role},$${e.hourlyRate},${e.totalDays},${e.totalHours},${e.missingCheckouts},$${e.totalPay}`
    ).join('\n')
    const detailHeader = '\n\nDetalle por día\nNombre,Fecha,Ingreso,Egreso,Tipo egreso,Horas\n'
    const detailRows = employees.flatMap(e =>
      e.days.map(d =>
        `"${e.firstName} ${e.lastName}",${d.date},${d.clockIn},${d.clockOut ?? '-'},${d.clockOutType},${d.hours}`
      )
    ).join('\n')

    const totalLine = `\n\nTOTAL A PAGAR,,,,,,${formatMoney(summary?.totalPay ?? 0)}`

    const csv = header + rows + detailHeader + detailRows + totalLine
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `liquidacion_${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <FadeIn>
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Liquidación de Horas</h2>
        <p className="section-label mt-0.5">Cálculo de haberes por período</p>
      </FadeIn>

      {/* Controls */}
      <div className="space-y-3">
        {/* Month selector */}
        <div className="flex items-center justify-between">
          <button onClick={() => setRefDate(subMonths(refDate, 1))} className="icon-btn flex items-center justify-center rounded-xl bg-secondary">
            <ChevronLeft className="size-4" />
          </button>
          <p className="text-sm font-semibold capitalize text-[#3d2c24]">
            {format(refDate, 'MMMM yyyy', { locale: es })}
          </p>
          <button onClick={() => setRefDate(prev => { const n = new Date(prev); n.setMonth(n.getMonth() + 1); return n })} className="icon-btn flex items-center justify-center rounded-xl bg-secondary">
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Period type */}
        <div className="flex rounded-full bg-secondary p-0.5">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setPeriodType(opt.key)}
              className={`flex-1 rounded-full py-2 text-[11px] font-semibold transition-colors ${periodType === opt.key ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] text-sm font-bold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <DollarSign className="size-4" />}
          {loading ? 'Calculando...' : 'Calcular liquidación'}
        </button>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <>
          {/* Total a pagar — hero */}
          <FadeIn>
            <div className="rounded-2xl bg-[#006d5a] p-5 text-center text-white">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/60">Total a pagar</p>
              <p className="mt-1 font-display text-3xl font-bold tabular-nums">{formatMoney(summary.totalPay)}</p>
              <p className="mt-1 text-xs text-white/60">
                {summary.totalHours}h · {summary.totalEmployees} empleados · {summary.totalDays} jornadas
              </p>
            </div>
          </FadeIn>

          <StaggerList className="grid grid-cols-2 gap-2.5" staggerDelay={0.04}>
            <StaggerItem>
              <div className="card-elevated rounded-xl p-3">
                <div className="flex items-center gap-1.5">
                  <Clock className="size-3 text-[#006d5a]" />
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Horas</span>
                </div>
                <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
                  {summary.totalHours}h
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className={`card-elevated rounded-xl p-3 ${summary.missingCheckouts > 0 ? 'border-[#ea504c]/30' : ''}`}>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className={`size-3 ${summary.missingCheckouts > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`} />
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Sin egreso</span>
                </div>
                <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${summary.missingCheckouts > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`}>
                  {summary.missingCheckouts > 0 ? summary.missingCheckouts : '✓'}
                </p>
              </div>
            </StaggerItem>
          </StaggerList>
        </>
      )}

      {/* Export */}
      {loaded && employees.length > 0 && (
        <button
          onClick={handleExport}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#006d5a] py-2.5 text-sm font-semibold text-[#006d5a] transition-all hover:bg-[#e8f5f1] active:scale-[0.98]"
        >
          <Download className="size-4" />
          Descargar CSV para Excel
        </button>
      )}

      {/* Employee list */}
      {loaded && (
        <div className="space-y-2">
          <span className="section-label">Detalle por empleado</span>
          {employees.length === 0 ? (
            <p className="py-4 text-center text-sm text-[#a39e97]">Sin registros en este período</p>
          ) : (
            employees.map(emp => {
              const roleConfig = ROLES[emp.role as AppRole]
              const isExpanded = expandedId === emp.id

              return (
                <div key={emp.id} className="card-elevated overflow-hidden rounded-xl">
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : emp.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: roleConfig?.color ?? '#a39e97' }}
                    >
                      {emp.firstName[0]}{emp.lastName[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#3d2c24]">
                        {emp.firstName} {emp.lastName}
                      </p>
                      <p className="text-[11px] text-[#a39e97]">
                        {roleConfig?.emoji} {roleConfig?.label} · ${emp.hourlyRate}/h · {emp.totalDays} día{emp.totalDays !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold tabular-nums text-[#006d5a]">{formatMoney(emp.totalPay)}</p>
                        <p className="text-[10px] tabular-nums text-[#a39e97]">{emp.totalHours}h</p>
                      </div>
                      {emp.missingCheckouts > 0 && (
                        <span className="rounded-full bg-[#fef2f2] px-1.5 py-0.5 text-[9px] font-bold text-[#ea504c]">
                          {emp.missingCheckouts}
                        </span>
                      )}
                      {isExpanded ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
                    </div>
                  </button>

                  {/* Detail per day */}
                  {isExpanded && (
                    <div className="border-t bg-[#faf8f5] px-4 py-3">
                      <div className="space-y-1.5">
                        {/* Header */}
                        <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">
                          <span>Fecha</span>
                          <div className="flex gap-8">
                            <span>Ingreso</span>
                            <span>Egreso</span>
                            <span>Horas</span>
                          </div>
                        </div>
                        {emp.days.map(d => {
                          const clockOutLabel = d.clockOut ?? '—'
                          const typeIcon = d.clockOutType === 'auto' ? '⏱' : d.clockOutType === 'edited' ? '✏️' : ''
                          return (
                            <div key={d.date} className="flex items-center justify-between text-xs">
                              <span className="capitalize text-[#3d2c24] w-20">
                                {format(new Date(d.date + 'T12:00:00'), 'EEE d', { locale: es })}
                              </span>
                              <div className="flex items-center gap-6 tabular-nums">
                                <span className="w-12 text-center text-[#3d2c24]">{d.clockIn}</span>
                                <span className={`w-16 text-center ${!d.clockOut ? 'text-[#ea504c] font-semibold' : 'text-[#3d2c24]'}`}>
                                  {clockOutLabel} {typeIcon}
                                </span>
                                <span className={`w-10 text-right font-semibold ${d.hours > 0 ? 'text-[#3d2c24]' : 'text-[#ea504c]'}`}>
                                  {d.hours > 0 ? `${d.hours}h` : '—'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                        {/* Subtotal */}
                        <div className="flex items-center justify-between border-t pt-2 mt-2 text-xs font-bold">
                          <span className="text-[#3d2c24]">Total</span>
                          <div className="flex items-center gap-4">
                            <span className="tabular-nums text-[#3d2c24]">{emp.totalHours}h × ${emp.hourlyRate}</span>
                            <span className="tabular-nums text-[#006d5a]">{formatMoney(emp.totalPay)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
