'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2, Search, Sparkles, X, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Vincular proveedores — recorrido guiado con sugerencia
// ---------------------------------------------------------------------------
// Fudo no expone un vínculo insumo→proveedor en su API (ni lectura ni
// escritura), así que este vínculo vive en LVE (stock_items.supplier_id),
// siempre apuntando a un proveedor real de Fudo (mismo fudo_provider_id).
// ---------------------------------------------------------------------------

type Suggestion = { supplierId: number; supplierName: string; reason: string } | null

type Item = {
  id: string
  name: string
  category: string
  unit: string
  suggestion: Suggestion
}

type SupplierOption = { id: number; name: string }

export default function VincularProveedoresPage() {
  const [items, setItems] = useState<Item[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({}) // itemId -> supplierName
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [pickerId, setPickerId] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/proveedores/sin-vincular')
        if (!res.ok) throw new Error('No se pudo cargar')
        const data = await res.json()
        setItems(data.items ?? [])
        setSuppliers(data.suppliers ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cargar')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const pending = useMemo(
    () => items.filter((i) => !done[i.id] && !skipped.has(i.id)),
    [items, done, skipped],
  )

  const totalToResolve = items.length
  const resolvedCount = Object.keys(done).length
  const pct = totalToResolve > 0 ? Math.round((resolvedCount / totalToResolve) * 100) : 0

  const filteredSuppliers = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) => s.name.toLowerCase().includes(q))
  }, [suppliers, pickerSearch])

  async function assign(itemId: string, supplierId: number, supplierName: string) {
    setSavingId(itemId)
    try {
      const res = await fetch(`/api/stock/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: supplierId }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error ?? 'No se pudo guardar')
      setDone((prev) => ({ ...prev, [itemId]: supplierName }))
      setPickerId(null)
      setPickerSearch('')
      toast.success(`Vinculado a ${supplierName}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/proveedores" className="rounded-full p-1.5 hover:bg-black/5">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div className="flex items-center gap-2">
          <Truck className="size-5 text-[#006d5a]" />
          <h1 className="text-[18px] font-bold text-[#3d2c24]">Vincular proveedores</h1>
        </div>
      </div>

      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        Elegí el proveedor real de cada insumo. Cuando hay una coincidencia clara aparece sugerida —
        confirmá o cambiala. El resto, buscá y elegí. No hace falta terminar todo de una.
      </p>

      {!loading && totalToResolve > 0 && (
        <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <span className="font-semibold text-[#3d2c24]">{resolvedCount} de {totalToResolve} vinculados</span>
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
      ) : pending.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <Check className="mx-auto mb-2 size-8 text-[#006d5a]" />
          <p className="text-[14px] text-[#3d2c24]">
            {totalToResolve === 0 ? 'Todos los insumos vinculados a Fudo ya tienen proveedor.' : 'Terminaste el recorrido de esta sesión.'}
          </p>
        </div>
      ) : (
        <FadeIn>
          <div className="space-y-2">
            {pending.map((item) => {
              const saving = savingId === item.id
              const showPicker = pickerId === item.id
              return (
                <div key={item.id} className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-[#3d2c24]">{item.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{item.category}</p>
                    </div>
                    <button
                      onClick={() => setSkipped((prev) => new Set(prev).add(item.id))}
                      className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-[#faf8f5]"
                    >
                      Saltar
                    </button>
                  </div>

                  {!showPicker && item.suggestion && (
                    <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-[#e8f5f1] px-3 py-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Sparkles className="size-3.5 shrink-0 text-[#006d5a]" />
                        <span className="truncate text-[12px] font-semibold text-[#006d5a]">{item.suggestion.supplierName}</span>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => assign(item.id, item.suggestion!.supplierId, item.suggestion!.supplierName)}
                          disabled={saving}
                          className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                          Confirmar
                        </button>
                        <button
                          onClick={() => setPickerId(item.id)}
                          className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#3d2c24] ring-1 ring-[#dcefe8]"
                        >
                          Cambiar
                        </button>
                      </div>
                    </div>
                  )}

                  {!showPicker && !item.suggestion && (
                    <button
                      onClick={() => setPickerId(item.id)}
                      className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#ebe6df] py-2 text-[12px] font-medium text-muted-foreground hover:bg-[#faf8f5]"
                    >
                      <Search className="size-3.5" /> Elegir proveedor
                    </button>
                  )}

                  {showPicker && (
                    <div className="mt-2.5 rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-2">
                      <div className="mb-2 flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
                          <input
                            autoFocus
                            placeholder="Buscar proveedor…"
                            value={pickerSearch}
                            onChange={(e) => setPickerSearch(e.target.value)}
                            className="w-full rounded-lg border border-[#ebe6df] bg-white py-1.5 pl-8 pr-2 text-[13px] outline-none focus:border-[#006d5a]"
                          />
                        </div>
                        <button
                          onClick={() => { setPickerId(null); setPickerSearch('') }}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-white"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="max-h-48 space-y-0.5 overflow-y-auto">
                        {filteredSuppliers.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => assign(item.id, s.id, s.name)}
                            disabled={saving}
                            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[#3d2c24] hover:bg-white disabled:opacity-50"
                          >
                            {s.name}
                            {saving && <Loader2 className="size-3.5 animate-spin" />}
                          </button>
                        ))}
                        {filteredSuppliers.length === 0 && (
                          <p className="py-3 text-center text-[12px] text-muted-foreground">Sin resultados</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </FadeIn>
      )}
    </div>
  )
}
