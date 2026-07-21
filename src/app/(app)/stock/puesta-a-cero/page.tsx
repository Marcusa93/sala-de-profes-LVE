'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Check, Loader2, AlertTriangle, ChefHat, TrendingDown, Package, RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Puesta a cero — recorrido de conteo físico priorizado
// ---------------------------------------------------------------------------
// El encargado cuenta lo que hay físicamente y el número real se escribe a Fudo
// (via /api/stock/sync, reason=physical_count), borrando los negativos.
// Prioridad: intermedios producidos primero, luego los negativos más grandes.
// ---------------------------------------------------------------------------

type StockItem = {
  id: string
  name: string
  unit: string
  current_qty: number
  category: string
  is_produced?: boolean | null
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  fudo_skip: boolean | null
}

type Bucket = 'intermedio' | 'negativo' | 'otro'

function bucketOf(item: StockItem): Bucket {
  if (item.is_produced) return 'intermedio'
  if (item.current_qty < 0) return 'negativo'
  return 'otro'
}

const BUCKET_META: Record<Bucket, { label: string; hint: string; icon: typeof ChefHat; tone: string }> = {
  intermedio: { label: 'Intermedios producidos', hint: 'Lo que hacés en cocina (milanesa cruda, bondiola, etc.)', icon: ChefHat, tone: '#006d5a' },
  negativo: { label: 'En negativo', hint: 'Fudo descontó ventas sin cargar entradas', icon: TrendingDown, tone: '#ea504c' },
  otro: { label: 'Otros vinculados a Fudo', hint: 'Contá si querés dejarlos exactos', icon: Package, tone: '#8b7355' },
}

const DEFAULT_NOTE = 'Puesta a cero — conteo inicial'

export default function PuestaACeroPage() {
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, number>>({})

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/stock/items?preset=full')
        if (!res.ok) throw new Error('No se pudo cargar el stock')
        const data = await res.json()
        const list: StockItem[] = (data.items ?? []).map((i: Record<string, unknown>) => ({
          id: String(i.id),
          name: String(i.name),
          unit: String(i.unit),
          current_qty: Number(i.current_qty ?? 0),
          category: String(i.category ?? 'otros'),
          is_produced: Boolean(i.is_produced),
          fudo_ingredient_id: i.fudo_ingredient_id == null ? null : String(i.fudo_ingredient_id),
          fudo_product_id: i.fudo_product_id == null ? null : String(i.fudo_product_id),
          fudo_skip: i.fudo_skip == null ? null : Boolean(i.fudo_skip),
        }))
        setItems(list)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cargar')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Solo items que escriben a Fudo (con vínculo y sin fudo_skip)
  const linked = useMemo(
    () => items.filter((i) => (i.fudo_ingredient_id || i.fudo_product_id) && !i.fudo_skip),
    [items],
  )

  const priority = useMemo(() => {
    const order: Record<Bucket, number> = { intermedio: 0, negativo: 1, otro: 2 }
    const scoped = showAll ? linked : linked.filter((i) => i.is_produced || i.current_qty < 0)
    return [...scoped].sort((a, b) => {
      const ba = bucketOf(a), bb = bucketOf(b)
      if (order[ba] !== order[bb]) return order[ba] - order[bb]
      // dentro del bucket: más negativo primero
      return a.current_qty - b.current_qty
    })
  }, [linked, showAll])

  const grouped = useMemo(() => {
    const g: Record<Bucket, StockItem[]> = { intermedio: [], negativo: [], otro: [] }
    for (const it of priority) g[bucketOf(it)].push(it)
    return g
  }, [priority])

  const totalToCount = priority.length
  const countedCount = priority.filter((i) => done[i.id] !== undefined).length
  const pct = totalToCount > 0 ? Math.round((countedCount / totalToCount) * 100) : 0

  async function saveCount(item: StockItem) {
    const raw = inputs[item.id]
    if (raw == null || raw.trim() === '') { toast.error('Ingresá la cantidad contada'); return }
    const newQty = parseFloat(raw)
    if (isNaN(newQty) || newQty < 0) { toast.error('Cantidad inválida'); return }

    setSavingId(item.id)
    try {
      const note = notes[item.id]?.trim() || DEFAULT_NOTE
      const res = await fetch('/api/stock/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId: item.id, newQty, reason: 'physical_count', note }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error ?? 'No se pudo guardar')
      setDone((prev) => ({ ...prev, [item.id]: newQty }))
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, current_qty: newQty } : i)))
      toast.success(`${item.name}: contado en ${newQty} ${item.unit} → Fudo ✓`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <Link href="/stock" className="rounded-full p-1.5 hover:bg-black/5">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div className="flex items-center gap-2">
          <RotateCcw className="size-5 text-[#006d5a]" />
          <h1 className="text-[18px] font-bold text-[#3d2c24]">Puesta a cero</h1>
        </div>
      </div>

      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        Contá lo que hay físicamente y el número real se escribe en Fudo, borrando los negativos.
        Empezá por los <b>intermedios</b> y los <b>negativos más grandes</b>. No hace falta terminar todo de una:
        cada ítem que confirmás ya queda corregido.
      </p>

      {/* Progreso */}
      {!loading && totalToCount > 0 && (
        <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <span className="font-semibold text-[#3d2c24]">{countedCount} de {totalToCount} contados</span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#f5f2ee]">
            <div className="h-2 rounded-full bg-[#006d5a] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando…
        </div>
      ) : totalToCount === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <Check className="mx-auto mb-2 size-8 text-[#006d5a]" />
          <p className="text-[14px] text-[#3d2c24]">No hay intermedios ni negativos pendientes. Todo en orden.</p>
        </div>
      ) : (
        <FadeIn>
          <div className="space-y-6">
            {(['intermedio', 'negativo', 'otro'] as Bucket[]).map((bucket) => {
              const list = grouped[bucket]
              if (list.length === 0) return null
              const meta = BUCKET_META[bucket]
              const Icon = meta.icon
              return (
                <div key={bucket}>
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className="size-4" style={{ color: meta.tone }} />
                    <h2 className="text-[13px] font-bold uppercase tracking-wider" style={{ color: meta.tone }}>
                      {meta.label} <span className="text-muted-foreground">({list.length})</span>
                    </h2>
                  </div>
                  <p className="mb-2 text-[11px] text-muted-foreground">{meta.hint}</p>
                  <div className="space-y-2">
                    {list.map((item) => {
                      const isDone = done[item.id] !== undefined
                      const saving = savingId === item.id
                      const neg = item.current_qty < 0
                      return (
                        <div
                          key={item.id}
                          className={`rounded-2xl bg-white p-3.5 shadow-sm ring-1 transition-colors ${isDone ? 'ring-[#006d5a]/40' : 'ring-[#ebe6df]'}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-semibold text-[#3d2c24]">{item.name}</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                En sistema:{' '}
                                <span className={neg ? 'font-bold text-[#ea504c]' : ''}>
                                  {item.current_qty} {item.unit}
                                </span>
                                {item.is_produced && <span className="ml-1.5 rounded-full bg-[#e8f5f1] px-1.5 py-0.5 text-[9px] font-bold text-[#006d5a]">PRODUCIDO</span>}
                              </p>
                            </div>
                            {isDone ? (
                              <div className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-[#006d5a]">
                                <Check className="size-4" /> {done[item.id]} {item.unit}
                              </div>
                            ) : (
                              <div className="flex shrink-0 items-center gap-2">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  placeholder="real"
                                  value={inputs[item.id] ?? ''}
                                  onChange={(e) => setInputs((p) => ({ ...p, [item.id]: e.target.value }))}
                                  className="w-20 rounded-xl border border-[#ebe6df] px-2.5 py-2 text-right text-[14px] font-semibold text-[#3d2c24] outline-none focus:border-[#006d5a]"
                                />
                                <button
                                  onClick={() => saveCount(item)}
                                  disabled={saving}
                                  className="flex size-9 items-center justify-center rounded-xl bg-[#006d5a] text-white disabled:opacity-50"
                                >
                                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                                </button>
                              </div>
                            )}
                          </div>
                          {!isDone && neg && (
                            <p className="mt-2 flex items-center gap-1 text-[11px] text-[#d4943a]">
                              <AlertTriangle className="size-3" />
                              Al confirmar, el negativo se reemplaza por lo que contaste.
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Toggle ver todos */}
          <button
            onClick={() => setShowAll((v) => !v)}
            className="mt-6 w-full rounded-xl border border-dashed border-[#ebe6df] py-2.5 text-[13px] font-medium text-muted-foreground"
          >
            {showAll ? 'Ver solo prioritarios' : 'Ver todos los vinculados a Fudo'}
          </button>
        </FadeIn>
      )}
    </div>
  )
}
