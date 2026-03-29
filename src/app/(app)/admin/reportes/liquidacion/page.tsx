'use client'

import { useEffect, useState, useMemo } from 'react'
import { format, subDays, startOfMonth, endOfMonth, differenceInMinutes, parseISO, subMonths } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Users, Clock, ChevronDown, ChevronUp, AlertTriangle, Download,
  Calendar, TrendingUp, Timer,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/skeleton'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttendanceLog = {
  user_id: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
}

type Profile = {
  id: string
  first_name: string
  last_name: string
  role: string
}

type EmployeeHours = {
  profile: Profile
  totalMinutes: number
  totalHours: number
  daysWorked: number
  avgHoursPerDay: number
  overtimeMinutes: number
  dailyBreakdown: { date: string; label: string; minutes: number }[]
  missingCheckouts: number
  longestDay: number
  shortestDay: number
}

// ---------------------------------------------------------------------------
// Period options
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS = [
  { key: 'current_month', label: 'Mes actual' },
  { key: 'last_month', label: 'Mes anterior' },
  { key: '15', label: 'Última quincena' },
  { key: '7', label: 'Última semana' },
] as const

function getPeriodRange(period: string): { from: string; to: string; label: string } {
  const now = new Date()
  if (period === 'current_month') {
    return {
      from: format(startOfMonth(now), 'yyyy-MM-dd'),
      to: format(now, 'yyyy-MM-dd'),
      label: format(now, 'MMMM yyyy', { locale: es }),
    }
  }
  if (period === 'last_month') {
    const prev = subMonths(now, 1)
    return {
      from: format(startOfMonth(prev), 'yyyy-MM-dd'),
      to: format(endOfMonth(prev), 'yyyy-MM-dd'),
      label: format(prev, 'MMMM yyyy', { locale: es }),
    }
  }
  const days = parseInt(period)
  return {
    from: format(subDays(now, days), 'yyyy-MM-dd'),
    to: format(now, 'yyyy-MM-dd'),
    label: `Últimos ${days} días`,
  }
}

// Standard workday in minutes (8h)
const STANDARD_DAY_MINUTES = 480

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LiquidacionPage() {
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<string>('current_month')
  const [logs, setLogs] = useState<AttendanceLog[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'hours' | 'name'>('hours')

  const { from, to, label: periodLabel } = useMemo(() => getPeriodRange(period), [period])

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const supabase = createClient()

      const [logsRes, profilesRes] = await Promise.all([
        supabase
          .from('attendance_logs')
          .select('user_id, operative_date, clock_in_at, clock_out_at, status')
          .gte('operative_date', from)
          .lte('operative_date', to),
        supabase
          .from('profiles')
          .select('id, first_name, last_name, role')
          .eq('is_active', true),
      ])

      setLogs(logsRes.data ?? [])
      setProfiles(profilesRes.data ?? [])
      setLoading(false)
    }
    fetchData()
  }, [from, to])

  // Compute employee hours
  const employees = useMemo<EmployeeHours[]>(() => {
    const empMap = new Map<string, {
      totalMin: number; days: Map<string, number>; missing: number; overtimeMin: number
    }>()

    for (const log of logs) {
      if (!empMap.has(log.user_id)) {
        empMap.set(log.user_id, { totalMin: 0, days: new Map(), missing: 0, overtimeMin: 0 })
      }
      const e = empMap.get(log.user_id)!

      if (log.clock_out_at) {
        const mins = differenceInMinutes(parseISO(log.clock_out_at), parseISO(log.clock_in_at))
        if (mins > 0 && mins < 1440) { // sanity check: less than 24h
          e.totalMin += mins
          e.days.set(log.operative_date, (e.days.get(log.operative_date) ?? 0) + mins)

          // Overtime: anything over 8h in a day
          const dayTotal = e.days.get(log.operative_date) ?? 0
          if (dayTotal > STANDARD_DAY_MINUTES) {
            const prevOvertime = dayTotal - mins > STANDARD_DAY_MINUTES ? mins : dayTotal - STANDARD_DAY_MINUTES
            e.overtimeMin = Math.max(0, e.overtimeMin + prevOvertime)
          }
        }
      }

      if ((log.status === 'open' || log.status === 'missing_checkout') && !log.clock_out_at) {
        e.missing++
      }
    }

    return profiles
      .filter((p) => empMap.has(p.id))
      .map((p) => {
        const e = empMap.get(p.id)!
        const dayEntries = Array.from(e.days.entries()).sort(([a], [b]) => a.localeCompare(b))
        const dayMinutes = dayEntries.map(([, m]) => m)

        // Recalculate overtime properly
        let overtime = 0
        for (const mins of dayMinutes) {
          if (mins > STANDARD_DAY_MINUTES) overtime += mins - STANDARD_DAY_MINUTES
        }

        return {
          profile: p,
          totalMinutes: e.totalMin,
          totalHours: Math.round((e.totalMin / 60) * 100) / 100,
          daysWorked: e.days.size,
          avgHoursPerDay: e.days.size > 0 ? Math.round((e.totalMin / 60 / e.days.size) * 10) / 10 : 0,
          overtimeMinutes: overtime,
          dailyBreakdown: dayEntries.map(([date, mins]) => ({
            date,
            label: format(new Date(date + 'T12:00:00'), 'EEE d/M', { locale: es }),
            minutes: mins,
          })),
          missingCheckouts: e.missing,
          longestDay: dayMinutes.length > 0 ? Math.max(...dayMinutes) : 0,
          shortestDay: dayMinutes.length > 0 ? Math.min(...dayMinutes) : 0,
        }
      })
      .sort((a, b) => sortBy === 'hours' ? b.totalMinutes - a.totalMinutes : a.profile.first_name.localeCompare(b.profile.first_name))
  }, [logs, profiles, sortBy])

  // Global totals
  const totals = useMemo(() => {
    const totalMin = employees.reduce((s, e) => s + e.totalMinutes, 0)
    const totalOvertime = employees.reduce((s, e) => s + e.overtimeMinutes, 0)
    return {
      totalHours: Math.round((totalMin / 60) * 10) / 10,
      totalOvertime: Math.round((totalOvertime / 60) * 10) / 10,
      totalEmployees: employees.length,
      avgPerEmployee: employees.length > 0 ? Math.round((totalMin / 60 / employees.length) * 10) / 10 : 0,
      missingTotal: employees.reduce((s, e) => s + e.missingCheckouts, 0),
    }
  }, [employees])

  // Chart data: hours per employee (horizontal bar)
  const chartData = useMemo(() => {
    return employees.slice(0, 20).map((e) => ({
      name: `${e.profile.first_name} ${e.profile.last_name?.[0] || ''}.`,
      hours: e.totalHours,
      role: e.profile.role,
    }))
  }, [employees])

  function formatMinutes(mins: number): string {
    const h = Math.floor(mins / 60)
    const m = Math.round(mins % 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }

  if (loading) {
    return (
      <div className="space-y-4 pt-2">
        <Skeleton className="h-12 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header + period selector */}
      <FadeIn>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Liquidación de Horas</h2>
            <p className="section-label mt-0.5 capitalize">{periodLabel}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPeriod(opt.key)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                  period === opt.key
                    ? 'bg-[#006d5a] text-white'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </FadeIn>

      {/* KPI grid */}
      <StaggerList className="grid grid-cols-2 gap-3" staggerDelay={0.04}>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-[#e8f5f1]">
                <Clock className="size-3.5 text-[#006d5a]" />
              </div>
              <span className="section-label">Total horas</span>
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
              {totals.totalHours}h
            </p>
            <p className="text-[11px] text-[#a39e97]">equipo completo</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-[#faf0e4]">
                <Users className="size-3.5 text-[#8b5e34]" />
              </div>
              <span className="section-label">Promedio</span>
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
              {totals.avgPerEmployee}h
            </p>
            <p className="text-[11px] text-[#a39e97]">por persona</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-[#eef4fc]">
                <TrendingUp className="size-3.5 text-[#4a90d9]" />
              </div>
              <span className="section-label">Extras</span>
            </div>
            <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${totals.totalOvertime > 0 ? 'text-[#d4943a]' : 'text-[#3d2c24]'}`}>
              {totals.totalOvertime}h
            </p>
            <p className="text-[11px] text-[#a39e97]">horas extra (&gt;8h/día)</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2">
              <div className={`flex size-7 items-center justify-center rounded-lg ${totals.missingTotal > 0 ? 'bg-[#fef2f2]' : 'bg-[#e8f5f1]'}`}>
                <AlertTriangle className={`size-3.5 ${totals.missingTotal > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`} />
              </div>
              <span className="section-label">Sin egreso</span>
            </div>
            <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${totals.missingTotal > 0 ? 'text-[#ea504c]' : 'text-[#3d2c24]'}`}>
              <AnimatedNumber value={totals.missingTotal} />
            </p>
            <p className="text-[11px] text-[#a39e97]">egresos pendientes</p>
          </div>
        </StaggerItem>
      </StaggerList>

      {/* Comparative bar chart */}
      {chartData.length > 0 && (
        <FadeIn delay={0.1}>
          <ChartCard title="Horas por empleado" subtitle="Comparativo del período seleccionado">
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 36)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} unit="h" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#3d2c24' }} axisLine={false} tickLine={false} width={100} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [`${v}h`, 'Horas trabajadas']}
                />
                <Bar dataKey="hours" radius={[0, 6, 6, 0]} barSize={20}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={ROLES[entry.role as AppRole]?.color ?? '#006d5a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </FadeIn>
      )}

      {/* Sort toggle + employee list */}
      {employees.length > 0 && (
        <FadeIn delay={0.2}>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="section-label">Detalle para liquidar</span>
              <button
                onClick={() => setSortBy(sortBy === 'hours' ? 'name' : 'hours')}
                className="rounded-full bg-secondary px-3 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Ordenar: {sortBy === 'hours' ? 'por horas' : 'por nombre'}
              </button>
            </div>

            <div className="space-y-2">
              {employees.map((emp) => {
                const roleConfig = ROLES[emp.profile.role as AppRole]
                const isExpanded = expandedEmployee === emp.profile.id
                const overtimeHours = Math.round((emp.overtimeMinutes / 60) * 10) / 10

                return (
                  <div key={emp.profile.id} className="card-elevated overflow-hidden rounded-xl">
                    {/* Summary row */}
                    <button
                      onClick={() => setExpandedEmployee(isExpanded ? null : emp.profile.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <div
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: roleConfig?.color ?? '#a39e97' }}
                      >
                        {(emp.profile.first_name?.[0] ?? '')}{(emp.profile.last_name?.[0] ?? '')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#3d2c24]">
                          {emp.profile.first_name} {emp.profile.last_name}
                        </p>
                        <p className="text-[11px] text-[#a39e97]">
                          {roleConfig?.emoji} {roleConfig?.label} · {emp.daysWorked} día{emp.daysWorked !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <p className="text-base font-bold tabular-nums text-[#3d2c24]">
                            {formatMinutes(emp.totalMinutes)}
                          </p>
                          <p className="text-[10px] text-[#a39e97]">~{emp.avgHoursPerDay}h/día</p>
                        </div>
                        {overtimeHours > 0 && (
                          <span className="rounded-md bg-[#fdf6ec] px-1.5 py-0.5 text-[10px] font-bold text-[#d4943a]">
                            +{overtimeHours}h
                          </span>
                        )}
                        {isExpanded ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t px-4 py-3 space-y-3">
                        {/* Summary pills */}
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div className="rounded-lg bg-[#f8f5f0] p-2.5 text-center">
                            <p className="text-[10px] font-medium text-[#a39e97]">Total</p>
                            <p className="mt-0.5 text-sm font-bold text-[#3d2c24]">{formatMinutes(emp.totalMinutes)}</p>
                          </div>
                          <div className="rounded-lg bg-[#f8f5f0] p-2.5 text-center">
                            <p className="text-[10px] font-medium text-[#a39e97]">Días</p>
                            <p className="mt-0.5 text-sm font-bold text-[#3d2c24]">{emp.daysWorked}</p>
                          </div>
                          <div className="rounded-lg bg-[#f8f5f0] p-2.5 text-center">
                            <p className="text-[10px] font-medium text-[#a39e97]">Día más largo</p>
                            <p className="mt-0.5 text-sm font-bold text-[#3d2c24]">{formatMinutes(emp.longestDay)}</p>
                          </div>
                          <div className="rounded-lg bg-[#f8f5f0] p-2.5 text-center">
                            <p className="text-[10px] font-medium text-[#a39e97]">Día más corto</p>
                            <p className="mt-0.5 text-sm font-bold text-[#3d2c24]">{formatMinutes(emp.shortestDay)}</p>
                          </div>
                        </div>

                        {emp.missingCheckouts > 0 && (
                          <div className="flex items-center gap-2 rounded-lg bg-[#fef2f2] px-3 py-2 text-xs text-[#ea504c]">
                            <AlertTriangle className="size-3.5 shrink-0" />
                            {emp.missingCheckouts} egreso{emp.missingCheckouts > 1 ? 's' : ''} sin marcar — estas horas NO están contabilizadas
                          </div>
                        )}

                        {/* Daily breakdown chart */}
                        {emp.dailyBreakdown.length > 0 && (
                          <div>
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                              Desglose diario
                            </p>
                            <ResponsiveContainer width="100%" height={120}>
                              <BarChart data={emp.dailyBreakdown} margin={{ left: -25, right: 4 }}>
                                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                                <Tooltip
                                  contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', fontSize: 11 }}
                                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                  formatter={(v: any) => [formatMinutes(v), 'Trabajado']}
                                />
                                <Bar dataKey="minutes" radius={[4, 4, 0, 0]} barSize={16}>
                                  {emp.dailyBreakdown.map((entry, i) => (
                                    <Cell
                                      key={i}
                                      fill={entry.minutes > STANDARD_DAY_MINUTES ? '#d4943a' : (roleConfig?.color ?? '#006d5a')}
                                    />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                            {/* 8h reference line note */}
                            <p className="mt-1 text-center text-[9px] text-[#a39e97]">
                              Barras naranjas = días con más de 8h
                            </p>
                          </div>
                        )}

                        {/* Daily detail table */}
                        <div className="max-h-48 overflow-y-auto rounded-lg border">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-[#f8f5f0]">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold text-[#a39e97]">Fecha</th>
                                <th className="px-3 py-2 text-right font-semibold text-[#a39e97]">Horas</th>
                                <th className="px-3 py-2 text-right font-semibold text-[#a39e97]">Extra</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {emp.dailyBreakdown.map((day) => {
                                const extra = day.minutes > STANDARD_DAY_MINUTES ? day.minutes - STANDARD_DAY_MINUTES : 0
                                return (
                                  <tr key={day.date} className="hover:bg-[#f8f5f0]/50">
                                    <td className="px-3 py-1.5 capitalize text-[#3d2c24]">{day.label}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[#3d2c24]">
                                      {formatMinutes(day.minutes)}
                                    </td>
                                    <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${extra > 0 ? 'text-[#d4943a]' : 'text-[#a39e97]'}`}>
                                      {extra > 0 ? `+${formatMinutes(extra)}` : '—'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                            <tfoot className="bg-[#f8f5f0] font-semibold">
                              <tr>
                                <td className="px-3 py-2 text-[#3d2c24]">Total</td>
                                <td className="px-3 py-2 text-right tabular-nums text-[#3d2c24]">{formatMinutes(emp.totalMinutes)}</td>
                                <td className={`px-3 py-2 text-right tabular-nums ${emp.overtimeMinutes > 0 ? 'text-[#d4943a]' : 'text-[#a39e97]'}`}>
                                  {emp.overtimeMinutes > 0 ? `+${formatMinutes(emp.overtimeMinutes)}` : '—'}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </FadeIn>
      )}

      {employees.length === 0 && !loading && (
        <FadeIn>
          <div className="flex flex-col items-center py-12 text-center">
            <Timer className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">Sin registros en este período</p>
            <p className="mt-1 text-xs text-[#a39e97]/70">Probá seleccionando otro rango de fechas</p>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
