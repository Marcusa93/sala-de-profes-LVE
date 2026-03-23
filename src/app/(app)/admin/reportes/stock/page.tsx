'use client'

import { useEffect, useState } from 'react'
import { Package, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/skeleton'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'

const SEMAPHORE_COLORS = { red: '#ea504c', yellow: '#d4943a', green: '#006d5a' }

type StockSnapshot = {
  total: number
  red: number
  yellow: number
  green: number
  by_category: { category: string; total: number; red: number; yellow: number; green: number }[]
  critical_items: { name: string; current_qty: number; min_qty: number; unit: string; supplier_name: string | null; category: string }[]
}

export default function StockReportPage() {
  const [data, setData] = useState<StockSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const supabase = createClient()
      const { data: items } = await supabase
        .from('stock_items')
        .select('name, unit, current_qty, min_qty, category, supplier_id')
        .eq('is_active', true)

      if (!items) { setLoading(false); return }

      const categorized = items.map((item) => ({
        ...item,
        supplier_name: null as string | null,
        semaphore: item.current_qty <= item.min_qty ? 'red' : item.current_qty <= item.min_qty * 1.5 ? 'yellow' : 'green',
      }))

      const byCategory = Object.entries(
        categorized.reduce((acc, item) => {
          const cat = item.category ?? 'otros'
          if (!acc[cat]) acc[cat] = { total: 0, red: 0, yellow: 0, green: 0 }
          acc[cat].total++
          acc[cat][item.semaphore as 'red' | 'yellow' | 'green']++
          return acc
        }, {} as Record<string, { total: number; red: number; yellow: number; green: number }>),
      ).map(([category, counts]) => ({ category, ...counts }))

      setData({
        total: categorized.length,
        red: categorized.filter((i) => i.semaphore === 'red').length,
        yellow: categorized.filter((i) => i.semaphore === 'yellow').length,
        green: categorized.filter((i) => i.semaphore === 'green').length,
        by_category: byCategory,
        critical_items: categorized
          .filter((i) => i.semaphore === 'red')
          .map(({ name, current_qty, min_qty, unit, supplier_name, category }) => ({
            name, current_qty, min_qty, unit, supplier_name, category: category ?? 'otros',
          })),
      })
      setLoading(false)
    }
    fetch()
  }, [])

  if (loading || !data) {
    return <div className="space-y-4 pt-2"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
  }

  const donutData = [
    { name: 'Crítico', value: data.red, color: SEMAPHORE_COLORS.red },
    { name: 'Atención', value: data.yellow, color: SEMAPHORE_COLORS.yellow },
    { name: 'Normal', value: data.green, color: SEMAPHORE_COLORS.green },
  ].filter((d) => d.value > 0)

  return (
    <div className="space-y-5">
      <FadeIn>
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Stock</h2>
        <p className="section-label mt-1">Estado actual del inventario</p>
      </FadeIn>

      {/* KPI row */}
      <StaggerList className="grid grid-cols-3 gap-3" staggerDelay={0.04}>
        {[
          { label: 'Crítico', value: data.red, color: '#ea504c', bg: '#fef2f2' },
          { label: 'Atención', value: data.yellow, color: '#d4943a', bg: '#fdf6ec' },
          { label: 'Normal', value: data.green, color: '#006d5a', bg: '#e8f5f1' },
        ].map((kpi) => (
          <StaggerItem key={kpi.label}>
            <div className="rounded-xl p-3 text-center" style={{ backgroundColor: kpi.bg }}>
              <p className="font-display text-2xl font-bold tabular-nums" style={{ color: kpi.color }}>
                <AnimatedNumber value={kpi.value} />
              </p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: kpi.color }}>
                {kpi.label}
              </p>
            </div>
          </StaggerItem>
        ))}
      </StaggerList>

      {/* Donut chart */}
      <FadeIn delay={0.1}>
        <ChartCard title="Distribución por estado" subtitle={`${data.total} items activos`} isEmpty={data.total === 0} emptyMessage="No hay items de stock cargados">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                dataKey="value"
                stroke="none"
              >
                {donutData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, name: any) => [`${value} items`, name]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 text-xs">
            {donutData.map((d) => (
              <span key={d.name} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                {d.name} ({d.value})
              </span>
            ))}
          </div>
        </ChartCard>
      </FadeIn>

      {/* By category bar chart */}
      {data.by_category.length > 0 && (
        <FadeIn delay={0.15}>
          <ChartCard title="Por categoría" subtitle="Items por nivel de stock">
            <ResponsiveContainer width="100%" height={Math.max(180, data.by_category.length * 36)}>
              <BarChart data={data.by_category} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={80}
                  tick={{ fontSize: 11, fill: '#a39e97' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                />
                <Bar dataKey="red" stackId="a" fill="#ea504c" radius={[0, 0, 0, 0]} name="Crítico" />
                <Bar dataKey="yellow" stackId="a" fill="#d4943a" name="Atención" />
                <Bar dataKey="green" stackId="a" fill="#006d5a" radius={[0, 4, 4, 0]} name="Normal" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </FadeIn>
      )}

      {/* Critical items list */}
      {data.critical_items.length > 0 && (
        <FadeIn delay={0.2}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <AlertTriangle className="size-4 text-[#ea504c]" />
              <span className="section-label text-[#ea504c]">Items críticos ({data.critical_items.length})</span>
            </div>
            <div className="space-y-1.5">
              {data.critical_items.map((item, i) => (
                <div key={i} className="card-elevated flex items-center justify-between rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-[#3d2c24]">{item.name}</p>
                    <p className="text-xs text-[#a39e97]">
                      {item.category}{item.supplier_name ? ` · ${item.supplier_name}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums text-[#ea504c]">
                      {item.current_qty} {item.unit}
                    </p>
                    <p className="text-[10px] text-[#a39e97]">mín: {item.min_qty}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
