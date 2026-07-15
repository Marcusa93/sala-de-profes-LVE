'use client'

import { format } from 'date-fns'
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

export function CompareView({ data, compareData, selectedDate, compareDate, setSelectedDate, setCompareDate, loadingCompare, onFetch }: Props) {
  return (
    <FadeIn>
      <div className="space-y-4">
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
          disabled={loadingCompare}
          className="w-full rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-50"
        >
          {loadingCompare ? 'Cargando...' : 'Comparar'}
        </button>

        {data && compareData && !loadingCompare && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#e8f5f1] px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#006d5a]">
                  {format(selectedDate, 'EEE d MMM', { locale: es })}
                </p>
              </div>
              <div className="rounded-xl bg-[#faf0e4] px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8b5e34]">
                  {format(compareDate, 'EEE d MMM', { locale: es })}
                </p>
              </div>
            </div>

            {([
              { label: 'Facturado',       keyA: data.totalFacturado,  keyB: compareData.totalFacturado,  fmt: true  },
              { label: 'Tickets',         keyA: data.totalTickets,    keyB: compareData.totalTickets,    fmt: false },
              { label: 'Ticket promedio', keyA: data.avgTicket,       keyB: compareData.avgTicket,       fmt: true  },
              { label: 'Items vendidos',  keyA: data.totalItems,      keyB: compareData.totalItems,      fmt: false },
              { label: 'Mesas cerradas',  keyA: data.mesasCerradas,   keyB: compareData.mesasCerradas,   fmt: false },
            ] as const).map((row) => {
              const diff = row.keyA - row.keyB
              const pct  = row.keyB > 0 ? Math.round((diff / row.keyB) * 100) : 0
              const isUp = diff > 0
              return (
                <div key={row.label} className="rounded-xl border bg-card p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">{row.label}</p>
                  <div className="grid grid-cols-3 items-end gap-2">
                    <p className="font-display text-lg font-bold tabular-nums text-[#006d5a]">
                      {row.fmt ? formatPrice(row.keyA) : row.keyA}
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
                      {row.fmt ? formatPrice(row.keyB) : row.keyB}
                    </p>
                  </div>
                </div>
              )
            })}

            <div className="rounded-xl border bg-card p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Top 5 productos</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  {data.topProducts.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-[#3d2c24]">{p.name}</span>
                      <span className="ml-1 shrink-0 font-bold tabular-nums text-[#006d5a]">{p.qty}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  {compareData.topProducts.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-[#3d2c24]">{p.name}</span>
                      <span className="ml-1 shrink-0 font-bold tabular-nums text-[#8b5e34]">{p.qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {(data.byHour.length > 0 || compareData.byHour.length > 0) && (
              <ChartCard
                title="Ventas por hora"
                subtitle={`${format(selectedDate, 'EEE d', { locale: es })} vs ${format(compareDate, 'EEE d', { locale: es })}`}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={(() => {
                      const map = new Map<string, { hour: string; a: number; b: number }>()
                      for (const h of data.byHour) map.set(h.hour, { hour: h.hour, a: h.revenue, b: 0 })
                      for (const h of compareData.byHour) {
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
                      formatter={(v: any, name: any) => [formatPrice(v), name === 'a' ? format(selectedDate, 'EEE d', { locale: es }) : format(compareDate, 'EEE d', { locale: es })]}
                    />
                    <Bar dataKey="a" fill="#006d5a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="b" fill="#8b5e34" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        )}

        {loadingCompare && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-[#a39e97]" />
          </div>
        )}
      </div>
    </FadeIn>
  )
}
