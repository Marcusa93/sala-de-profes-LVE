'use client'

import { useState, useEffect } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { StockItem } from '@/lib/hooks/use-stock'
import { STOCK_CATEGORY_OPTIONS } from '@/lib/constants'
import type { StockCategoryValue } from '@/types/database'

type Props = {
  item: StockItem
  initialShelfLife?: number | null
  initialCategory?: StockCategoryValue | null
  onSaved: () => void
  onCancel: () => void
}

export function MetadataEditor({ item, initialShelfLife, initialCategory, onSaved, onCancel }: Props) {
  const [metaShelfLife, setMetaShelfLife] = useState(String(initialShelfLife ?? item.shelf_life_days ?? ''))
  const [metaCategory, setMetaCategory] = useState<StockCategoryValue | ''>(initialCategory ?? item.category)
  const [metaNotes, setMetaNotes] = useState(item.notes ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMetaShelfLife(String(initialShelfLife ?? item.shelf_life_days ?? ''))
    setMetaCategory(initialCategory ?? item.category)
    setMetaNotes(item.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const handleSave = async () => {
    setSaving(true)
    try {
      const shelfLife = metaShelfLife.trim()
      const payload = {
        shelf_life_days: shelfLife ? Number(shelfLife) : null,
        category: metaCategory || undefined,
        notes: metaNotes.trim() || null,
      }

      const res = await fetch(`/api/stock/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la configuración')

      toast.success('Configuración de stock actualizada')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar configuración')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t bg-[#faf8f5] px-3 py-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
            Vida util (dias)
          </span>
          <input
            value={metaShelfLife}
            onChange={(e) => setMetaShelfLife(e.target.value)}
            inputMode="numeric"
            placeholder="Ej. 7"
            className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
          />
        </label>

        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
            Categoria
          </span>
          <select
            value={metaCategory}
            onChange={(e) => setMetaCategory(e.target.value as StockCategoryValue)}
            className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
          >
            <option value="" disabled>Elegir</option>
            {STOCK_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
          Nota operativa
        </span>
        <textarea
          value={metaNotes}
          onChange={(e) => setMetaNotes(e.target.value)}
          rows={2}
          placeholder="Ej. Sale mejor por porcion o promo en merienda"
          className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none"
        />
      </label>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-[#a39e97]">
          Esto alimenta alertas, sugerencias por sector y decisiones de stock.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onCancel}
            className="rounded-lg px-2.5 py-2 text-[11px] font-semibold text-[#7d6c64] hover:bg-[#f3efe9]"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1 rounded-lg bg-[#3d2c24] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
