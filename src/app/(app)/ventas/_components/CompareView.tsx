'use client'

import { useState, useCallback } from 'react'
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Loader2 } from 'lucide-react'
import { FadeIn } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { DashboardData } from './types'
import { formatPrice } from './types'

type Props = {
  data: DashboardData
  compareData: DashboardData | null
  selectedDate: Date
  compareDate: Date
  setSelectedDate: (d: Date) => void
  setCompareDate: (d: Date) => void
  loadingCompare: boolean
  onFetch: () => void
}

type PeriodRange = { from: string; to: string }

function fmtRange(from: string, to: string) {
  const a = new Date(from + 'T12:00:00')
  const b = new Date(to + 'T12:00:00')
  return `${format(a, 'd MMM', { locale: es })} – ${format(b, 'd MMM', { locale: es })}`
}

function defaultPeriodA(): PeriodRange {
  const now = new Date()
  return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(now, 'yyyy-MM-dd'),
  }
}

function defaultPeriodB(): PeriodRange {
  const prev = subMonths(new Date(), 1)
  return {
    from: format(startOfMonth(prev), 'yyyy-MM-dd'),
    to: format(endOfMonth(prev), 'yyyy-MM-dd'),
  }
}

export function CompareView({
  data,
  compareData,
  selectedDate,
  compareDate,
  setSelectedDate,
  setCompareDate,
  loadingCompare,
  onFetch,
}: Props) {
  const [mode, setMode] = useState<'dia' | 'periodo'>('dia')
  const [periodA, setPeriodA] = useState<PeriodRange>(defaultPeriodA)
  const [periodB, setPeriodB] = useState<PeriodRange>(defaultPeriodB)
  const [periodAData, setPeriodAData] = useState<DashboardData | null>(null)
  const [periodBData, setPeriodBData] = useState<DashboardData | null>(null)
  const [loadingPeriod, setLoadingPeriod] = useState(false)

  const fetchPeriod = useCallback(async () => {
    setLoadingPeriod(true)
    setPeriodAData(null)
    setPeriodBData(null)
    try {
      const [resA, resB] = await Promise.all([
        fetch(`/api/fudo/range-summary?from=${periodA.from}&to=${periodA.to}`),
        fetch(`/api/fudo/range-summary?from=${periodB.from}&to=${periodB.to}`),
      ])
      const [jsonA, jsonB] = await Promise.all([resA.json(), resB.json()])
      setPeriodAData(jsonA.data ?? null)
      setPeriodBData(jsonB.data ?? null)
    } catch {
      setPeriodAData(null)
      setPeriodBData(null)
    }
    setLoadingPeriod(false)
  }, [periodA, periodB])

  const loading = mode === 'dia' ? loadingCompare : loadingPeriod
  const dataA = mode === 'dia' ? data : periodAData
  const dataB = mode === 'dia' ? compareData : periodBData

  const labelA = mode === 'dia'
    ? format(selectedDate, 'EEE d MMM', { locale: es })
    : fmtRange(periodA.from, periodA.to)

  const labelB = mode === 'dia'
    ? format(compareDate, 'EEE d MMM', { locale: es })
    : fmtRange(periodB.from, periodB.to)

  return (
    <FadeIn>
      <div className="space-y-4">
        {/* Modo: Día vs Período */}
        <div className="flex rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-1">
          {(['dia', 'periodo'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg py-1.5 text-[12px] font-semibold transition-all ${
                mode === m ? 'bg-white text-[#3d2c24] shadow-sm' : 'text-[#a39e97]'
              }`}
            >
              {m === 'dia' ? 'Día' : 'Período'}
            </button>
          ))}
        </div>

        {mode === 'dia' ? (
          /* ── Modo día (existente) ── */
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Día A</label>
                <input
                  type="date"
                  value={format(selectedDate, 'yyyy-MM-dd')}
                  onChange={(e) => setSelectedDate(new Date(e.target.value + 'T12:00:00'))}
                  className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Día B</label>
                <input
                  type="date"
                  value={format(compareDate, 'yyyy-MM-dd')}
                  onChange={(e) => setCompareDate(new Date(e.target.value + 'T12:00:00'))}
                  className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                />
              </div>
            </div>
            <button
              onClick={onFetch}
              disabled={loading}
              className="w-full rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Cargando...' : 'Comparar'}
            </button>
          </>
        ) : (
          /* ── Modo período ── */
          <>
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#006d5a]">Período A</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#a39e97]">Desde</label>
                    <input
                      type="date"
                      value={periodA.from}
                      onChange={(e) => setPeriodA((p) => ({ ...p, from: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#a39e97]">Hasta</label>
                    <input
                      type="date"
                      value={periodA.to}
                      onChange={(e) => setPeriodA((p) => ({ ...p, to: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    />
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8b5e34]">Período B</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#a39e97]">Desde</label>
                    <input
                      type="date"
                      value={periodB.from}
                      onChange={(e) => setPeriodB((p) => ({ ...p, from: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#a39e97]">Hasta</label>
                    <input
                      type="date"
                      value={periodB.to}
                      onChange={(e) => setPeriodB((p) => ({ ...p, to: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    />
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={fetchPeriod}
              disabled={loading}
              className="w-full rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Cargando...' : 'Comparar períodos'}
            </button>
          </>
        )}

        {/* ── Resultados (compartidos entre modos) ── */}
        {dataA && dataB && !loading && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#e8f5f1] px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#006d5a]">{labelA}</p>
              </div>
              <div className="rounded-xl bg-[#faf0e4] px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8b5e34]">{labelB}</p>
              </div>
            </div>

            {([
              { label: 'Facturado',       valA: dataA.totalFacturado,  valB: dataB.totalFacturado,  fmt: true  },
              { label: 'Tickets',         valA: dataA.totalTickets,    valB: dataB.totalTickets,    fmt: false },
              { label: 'Ticket promedio', valA: dataA.avgTicket,       valB: dataB.avgTicket,       fmt: true  },
              { label: 'Items vendidos',  valA: dataA.totalItems,      valB: dataB.totalItems,      fmt: false },
              { label: 'Mesas cerradas',  valA: dataA.mesasCerradas,   valB: dataB.mesasCerradas,   fmt: false },
            ] as const).map((row) => {
              const diff = row.valA - row.valB
              const pct  = row.valB > 0 ? Math.round((diff / row.valB) * 100) : 0
              const isUp = diff > 0
              return (
                <div key={row.label} className="rounded-xl border bg-card p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">{row.label}</p>
                  <div className="grid grid-cols-3 items-end gap-2">
                    <p className="font-display text-lg font-bold tabular-nums text-[#006d5a]">
                      {row.fmt ? formatPrice(row.valA) : row.valA}
                    </p>
                    <div className="text-center">
                      {pct !== 0 ? (
                        <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${isUp ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#fef2f2] text-[#ea504c]'}`}>
                          {isUp ? '↑' : '↓'} {Math.abs(pct)}%
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#a39e97]">=</span>
                      )}
                    </div>
                    <p className="text-right font-display text-lg font-bold tabular-nums text-[#8b5e34]">
                      {row.fmt ? formatPrice(row.valB) : row.valB}
                    </p>
                  </div>
                </div>
              )
            })}

            <div className="rounded-xl border bg-card p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Top 5 productos</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  {dataA.topProducts.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-[#3d2c24]">{p.name}</span>
                      <span className="ml-1 shrink-0 font-bold tabular-nums text-[#006d5a]">{p.qty}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  {dataB.topProducts.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-[#3d2c24]">{p.name}</span>
                      <span className="ml-1 shrink-0 font-bold tabular-nums text-[#8b5e34]">{p.qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {(dataA.byHour.length > 0 || dataB.byHour.length > 0) && (
              <ChartCard
                title="Ventas por hora"
                subtitle={`${labelA} vs ${labelB}`}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={(() => {
                      const map = new Map<string, { hour: string; a: number; b: number }>()
                      for (const h of dataA.byHour) map.set(h.hour, { hour: h.hour, a: h.revenue, b: 0 })
                      for (const h of dataB.byHour) {
                        const row = map.get(h.hour) ?? { hour: h.hour, a: 0, b: 0 }
                        row.b = h.revenue
                        map.set(h.hour, row)
                      }
                      return Array.from(map.values()).sort((x, y) => Number(x.hour) - Number(y.hour))
                    })()}
                    margin={{ left: -15, right: 8 }}
                  >
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(v: any, name: any) => [formatPrice(v), name === 'a' ? labelA : labelB]}
                    />
                    <Bar dataKey="a" fill="#006d5a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="b" fill="#8b5e34" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-[#a39e97]" />
          </div>
        )}
      </div>
    </FadeIn>
  )
}
