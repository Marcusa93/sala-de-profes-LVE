'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// /stock/precios — precio histórico de COMPRA por insumo (stock_receipts).
// Mismo diseño que /stock/produccion/costos: grupos expandibles con
// último precio, mín/prom/máx, tendencia y detalle por recibo.
// ---------------------------------------------------------------------------

type PriceReceipt = {
  id: number
  date: string
  qty: number
  unit: string
  cost_per_unit: number
  cost_total: number | null
  supplier: string | null
}

type ItemPriceHistory = {
  stock_item_id: string | null
  name: string
  unit: string
  receipts: PriceReceipt[]
  latest_price: number | null
  avg_price: number | null
  min_price: number | null
  max_price: number | null
  receipt_count: number
}

function money(n: number | null): string {
  if (n == null) return '—'
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function PreciosCompraPage() {
  const [data, setData] = useState<ItemPriceHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(180)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/stock/precios?days=${days}`)
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'No se pudo cargar')
        const json = await res.json()
        setData(json.items ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cargar')
      } finally {
        setLoading(false)
      }
    })()
  }, [days])

  const totalReceipts = useMemo(() => data.reduce((s, g) => s + g.receipt_count, 0), [data])

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/stock" className="rounded-full p-1.5 hover:bg-black/5">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div className="flex flex-1 items-center gap-2">
          <Tag className="size-5 text-[#006d5a]" />
          <h1 className="text-[18px] font-bold text-[#3d2c24]">Precios de compra</h1>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-[12px] focus:outline-none"
        >
          <option value={30}>30 días</option>
          <option value={90}>90 días</option>
          <option value={180}>180 días</option>
          <option value={365}>1 año</option>
        </select>
      </div>

      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        Cuánto pagaste cada insumo en cada recepción. Así ves qué proveedor te remarcó
        y qué insumo se está <b>encareciendo</b>.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando…
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <p className="text-[14px] text-[#3d2c24]">Todavía no hay recepciones con precio cargado.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Cada vez que registres una compra con costo, su precio queda registrado acá.
          </p>
        </div>
      ) : (
        <FadeIn>
          <div className="space-y-3">
            {data.map((g) => {
              const key = g.stock_item_id ?? g.name
              const isOpen = expanded === key
              // Tendencia: comparar el más reciente vs el promedio.
              const latest = g.latest_price ?? 0
              const avg = g.avg_price ?? 0
              const trendUp = g.receipt_count > 1 && latest > avg * 1.05
              const trendDown = g.receipt_count > 1 && latest < avg * 0.95
              return (
                <div key={key} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                  <button
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-bold text-[#3d2c24]">{g.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {g.receipt_count} compra{g.receipt_count === 1 ? '' : 's'} en el período
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground">último precio</p>
                        <p className="flex items-center gap-1 text-[18px] font-bold text-[#006d5a]">
                          {trendUp && <TrendingUp className="size-4 text-[#ea504c]" />}
                          {trendDown && <TrendingDown className="size-4 text-[#006d5a]" />}
                          {!trendUp && !trendDown && g.receipt_count > 1 && <Minus className="size-3.5 text-muted-foreground" />}
                          {money(g.latest_price)}
                          <span className="text-[11px] font-medium text-muted-foreground">/{g.unit}</span>
                        </p>
                      </div>
                      {isOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {g.receipt_count > 1 && (
                    <div className="flex gap-3 border-t border-[#f3efe9] px-4 py-2 text-[11px] text-muted-foreground">
                      <span>mín <b className="text-[#006d5a]">{money(g.min_price)}</b></span>
                      <span>prom <b className="text-[#3d2c24]">{money(g.avg_price)}</b></span>
                      <span>máx <b className="text-[#ea504c]">{money(g.max_price)}</b></span>
                    </div>
                  )}

                  {isOpen && (
                    <div className="border-t border-[#f3efe9] bg-[#faf8f5] px-4 py-3">
                      <div className="space-y-2">
                        {g.receipts.map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-2 text-[13px]">
                            <div className="min-w-0">
                              <span className="text-[#3d2c24]">{fmtDate(r.date)}</span>
                              <span className="ml-2 text-[11px] text-muted-foreground">
                                {r.qty} {r.unit}
                                {r.supplier && <span> · {r.supplier}</span>}
                                {r.cost_total != null && <span> · total {money(r.cost_total)}</span>}
                              </span>
                            </div>
                            <span className="shrink-0 font-bold text-[#006d5a]">{money(r.cost_per_unit)}/{r.unit}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            {totalReceipts} recepciones con precio · la tendencia compara el último precio contra el promedio del período
          </p>
        </FadeIn>
      )}
    </div>
  )
}
