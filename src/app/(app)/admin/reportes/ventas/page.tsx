'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Download, Loader2, BarChart2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'
import { MomentosView } from '@/app/(app)/ventas/_components/MomentosView'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type ReporteDish = {
  menu_item_id: string
  name: string
  category: string
  units: number
  avg_price: number
  cost_per_portion: number
  food_cost_pct: number
}

type ReportePayload = {
  days: number
  from: string
  to: string
  dishes: ReporteDish[]
  generated_at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number) {
  return `$${n.toLocaleString('es-AR')}`
}

function foodCostStyle(pct: number): React.CSSProperties {
  if (pct <= 30) return { color: '#006d5a', backgroundColor: '#e8f5f1' }
  if (pct <= 40) return { color: '#d4943a', backgroundColor: '#fdf6ec' }
  return { color: '#ea504c', backgroundColor: '#fef2f2' }
}

function downloadCSV(data: ReportePayload) {
  const headers = ['Producto', 'Categoría', 'Unidades vendidas', 'Precio promedio', 'Costo por porción', 'Food Cost %']
  const rows = data.dishes.map(d => [
    d.name,
    d.category,
    String(d.units),
    String(d.avg_price),
    String(d.cost_per_portion),
    `${d.food_cost_pct}%`,
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reporte-ventas-${data.days}d-${data.from}-${data.to}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type Tab = 'tabla' | 'momentos'
const DAY_OPTIONS = [30, 60, 90] as const

export default function ReporteVentasPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('tabla')
  const [days, setDays] = useState<30 | 60 | 90>(30)
  const [data, setData] = useState<ReportePayload | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setData(null)
    try {
      const res = await fetch(`/api/ventas/reporte?days=${days}`, { credentials: 'include' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string })?.error ?? 'Error al cargar el reporte')
      }
      setData(await res.json() as ReportePayload)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar el reporte')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <button
          onClick={() => router.push('/admin/reportes')}
          className="mb-1 flex items-center gap-1 text-[11px] text-[#a39e97] active:opacity-60"
        >
          <ChevronLeft className="size-3.5" />
          Reportes
        </button>
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Ventas</h2>
        <p className="section-label mt-1">Food cost por producto · recetas con costo completo</p>
      </FadeIn>

      {/* Tabs */}
      <div className="flex rounded-full bg-secondary p-0.5">
        {([
          { key: 'tabla' as Tab, label: 'Tabla', Icon: BarChart2 },
          { key: 'momentos' as Tab, label: 'Momentos', Icon: Clock },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[12px] font-semibold transition-colors ${
              tab === key ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {tab === 'tabla' ? (
        <div className="space-y-4">
          {/* Período + descarga */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex rounded-full bg-secondary p-0.5">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                    days === d ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            {data && data.dishes.length > 0 && (
              <button
                onClick={() => downloadCSV(data)}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#3d2c24] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm active:opacity-80"
              >
                <Download className="size-3.5" />
                Descargar CSV
              </button>
            )}
          </div>

          {/* Estado de carga */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" />
              Calculando costos…
            </div>
          ) : !data || data.dishes.length === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-[#ebe6df]">
              <p className="text-[14px] font-semibold text-[#3d2c24]">Sin productos con receta completa</p>
              <p className="mt-1 text-[12px] text-[#a39e97]">
                Solo aparecen productos con todos los ingredientes costeados y ventas en el período.
              </p>
            </div>
          ) : (
            <FadeIn>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[540px] text-[12px]">
                    <thead>
                      <tr className="border-b border-[#ebe6df] bg-[#faf8f5]">
                        <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                          Producto
                        </th>
                        <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                          Categoría
                        </th>
                        <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                          Unidades
                        </th>
                        <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                          Precio
                        </th>
                        <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                          Costo
                        </th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                          Food Cost
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f3efe9]">
                      {data.dishes.map((dish) => (
                        <tr key={dish.menu_item_id} className="transition-colors hover:bg-[#faf8f5]">
                          <td className="px-4 py-2.5 font-semibold text-[#3d2c24]">{dish.name}</td>
                          <td className="px-3 py-2.5 text-[#a39e97]">{dish.category || '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#3d2c24]">
                            {dish.units.toLocaleString('es-AR')}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[#3d2c24]">
                            {fmt(dish.avg_price)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[#3d2c24]">
                            {fmt(dish.cost_per_portion)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
                              style={foodCostStyle(dish.food_cost_pct)}
                            >
                              {dish.food_cost_pct}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-[#ebe6df] px-4 py-2.5">
                  <p className="text-[10px] text-[#a39e97]">
                    {data.dishes.length} productos · {data.from} → {data.to}
                  </p>
                  <p className="text-[10px] text-[#a39e97]">
                    Solo recetas con costo completo
                  </p>
                </div>
              </div>
            </FadeIn>
          )}
        </div>
      ) : (
        <MomentosView />
      )}
    </div>
  )
}
