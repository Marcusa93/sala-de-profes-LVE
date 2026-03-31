'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import { Package, Loader2, Search, X, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { STOCK_CATEGORIES, STOCK_CATEGORY_OPTIONS } from '@/lib/constants'
import type { StockCategoryValue } from '@/types/database'
import { EmptyState } from '@/components/ui/EmptyState'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockItem = {
  id: string
  name: string
  category: StockCategoryValue
  unit: string
  current_qty: number
  min_qty: number
  is_active: boolean
  supplier_id: string | null
  suppliers: { name: string } | null
}

type SemaphoreColor = 'red' | 'yellow' | 'green'

function getSemaphore(item: StockItem): SemaphoreColor {
  if (item.current_qty === 0) return 'red'
  if (item.current_qty <= item.min_qty) return 'red'
  if (item.current_qty <= item.min_qty * 1.5) return 'yellow'
  return 'green'
}

const COLORS: Record<SemaphoreColor, { text: string; bg: string; border: string; dot: string }> = {
  red: { text: 'text-[#ea504c]', bg: 'bg-[#fef2f2]', border: 'border-[#ea504c]', dot: 'bg-[#ea504c]' },
  yellow: { text: 'text-[#d4943a]', bg: 'bg-[#fdf6ec]', border: 'border-[#d4943a]', dot: 'bg-[#d4943a]' },
  green: { text: 'text-[#006d5a]', bg: 'bg-[#e8f5f1]', border: 'border-[#006d5a]', dot: 'bg-[#006d5a]' },
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StockPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [semaphoreFilter, setSemaphoreFilter] = useState<SemaphoreColor | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())

  const isEncargado = isManagerOrAbove(profile?.role)

  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('stock_items')
      .select('id, name, category, unit, current_qty, min_qty, is_active, supplier_id, suppliers(name)')
      .eq('is_active', true)
      .order('category')
      .order('name')
    setItems((data as unknown as StockItem[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Filter
  const filtered = useMemo(() => {
    let result = items
    if (search.trim()) {
      const q = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      result = result.filter(i =>
        i.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)
      )
    }
    if (categoryFilter !== 'all') {
      result = result.filter(i => i.category === categoryFilter)
    }
    if (semaphoreFilter) {
      result = result.filter(i => getSemaphore(i) === semaphoreFilter)
    }
    return result
  }, [items, search, categoryFilter, semaphoreFilter])

  // Counts
  const counts = useMemo(() => {
    let red = 0, yellow = 0, green = 0
    for (const i of filtered) {
      const s = getSemaphore(i)
      if (s === 'red') red++
      else if (s === 'yellow') yellow++
      else green++
    }
    return { red, yellow, green, total: filtered.length }
  }, [filtered])

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, StockItem[]>()
    for (const item of filtered) {
      const cat = item.category || 'otros'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(item)
    }
    // Sort items: red first, then yellow, then green, then by name
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        const sa = getSemaphore(a) === 'red' ? 0 : getSemaphore(a) === 'yellow' ? 1 : 2
        const sb = getSemaphore(b) === 'red' ? 0 : getSemaphore(b) === 'yellow' ? 1 : 2
        if (sa !== sb) return sa - sb
        return a.name.localeCompare(b.name)
      })
    }
    return map
  }, [filtered])

  // Update qty
  const handleSave = async (itemId: string) => {
    const newQty = parseFloat(editQty)
    if (isNaN(newQty) || newQty < 0) { toast.error('Cantidad inválida'); return }
    try {
      const supabase = createClient()
      const { error } = await supabase.from('stock_items').update({ current_qty: newQty }).eq('id', itemId)
      if (error) throw error
      toast.success('Stock actualizado')
      setEditingId(null)
      fetchData()
    } catch {
      toast.error('Error al guardar')
    }
  }

  const toggleCat = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // Loading
  if (profileLoading || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[#a39e97]" />
      </div>
    )
  }

  if (profile && !isEncargado) {
    return <EmptyState icon={Package} title="Acceso restringido" description="Solo encargados y socios." />
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      {/* Header */}
      <FadeIn>
        <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Stock</h1>
        <p className="section-label mt-0.5">{counts.total} items</p>
      </FadeIn>

      {/* Search */}
      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] py-2.5 pl-10 pr-3 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
        />
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#a39e97] hover:bg-[#f3efe9]">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Semaphore pills — always visible */}
      <div className="flex gap-2">
        {(['red', 'yellow', 'green'] as const).map((color) => {
          const isActive = semaphoreFilter === color
          const c = COLORS[color]
          const labels: Record<SemaphoreColor, string> = { red: 'Crítico', yellow: 'Atención', green: 'OK' }
          return (
            <button
              key={color}
              onClick={() => setSemaphoreFilter(isActive ? null : color)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition-all ${
                isActive ? `${c.bg} ${c.border}` : 'border-[#ebe6df] bg-white text-[#a39e97] hover:bg-[#faf8f5]'
              }`}
            >
              <span className={`size-2 rounded-full ${c.dot}`} />
              <span className={isActive ? c.text.replace('text-', 'text-') : ''}>{counts[color]}</span>
              <span>{labels[color]}</span>
            </button>
          )
        })}
      </div>

      {/* Category pills — horizontal scroll */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none">
        <button
          onClick={() => setCategoryFilter('all')}
          className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all ${
            categoryFilter === 'all' ? 'bg-[#3d2c24] text-white' : 'bg-[#f3efe9] text-[#a39e97]'
          }`}
        >
          Todas
        </button>
        {STOCK_CATEGORY_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setCategoryFilter(opt.value)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all ${
              categoryFilter === opt.value ? 'bg-[#3d2c24] text-white' : 'bg-[#f3efe9] text-[#a39e97]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Items grouped by category */}
      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="Sin resultados" description="Probá con otra búsqueda o filtro." />
      ) : (
        Array.from(grouped.entries()).map(([cat, catItems]) => {
          const catConfig = STOCK_CATEGORIES[cat as keyof typeof STOCK_CATEGORIES]
          const isCollapsed = collapsedCats.has(cat)
          const catCritical = catItems.filter(i => getSemaphore(i) === 'red').length

          return (
            <div key={cat}>
              {/* Category header */}
              <button
                onClick={() => toggleCat(cat)}
                className="flex w-full items-center justify-between py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{catConfig?.icon ?? '📦'}</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#3d2c24]">
                    {catConfig?.label ?? cat}
                  </span>
                  <span className="text-[10px] text-[#a39e97]">({catItems.length})</span>
                  {catCritical > 0 && (
                    <span className="rounded-full bg-[#fef2f2] px-1.5 py-0.5 text-[9px] font-bold text-[#ea504c]">
                      {catCritical} ⚠
                    </span>
                  )}
                </div>
                {isCollapsed ? <ChevronDown className="size-4 text-[#a39e97]" /> : <ChevronUp className="size-4 text-[#a39e97]" />}
              </button>

              {/* Items */}
              {!isCollapsed && (
                <div className="space-y-1 mb-4">
                  {catItems.map(item => {
                    const s = getSemaphore(item)
                    const c = COLORS[s]
                    const isEditing = editingId === item.id

                    return (
                      <div
                        key={item.id}
                        className="flex items-center rounded-xl border bg-card px-3 py-2.5"
                        style={{ borderLeftWidth: 3, borderLeftColor: c.border.replace('border-[', '').replace(']', '') }}
                      >
                        {/* Name */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#3d2c24]">{item.name}</p>
                          {item.suppliers?.name && (
                            <p className="truncate text-[10px] text-[#a39e97]">{item.suppliers.name}</p>
                          )}
                        </div>

                        {/* Qty — tap to edit */}
                        {isEditing ? (
                          <div className="flex items-center gap-1 ml-2">
                            <input
                              value={editQty}
                              onChange={(e) => setEditQty(e.target.value)}
                              className="w-16 rounded-lg border bg-white px-2 py-1.5 text-center text-sm font-bold tabular-nums focus:border-[#006d5a] focus:outline-none"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSave(item.id)
                                if (e.key === 'Escape') setEditingId(null)
                              }}
                            />
                            <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
                            <button
                              onClick={() => handleSave(item.id)}
                              className="rounded-lg bg-[#006d5a] px-2 py-1.5 text-[10px] font-bold text-white"
                            >
                              OK
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded-lg px-1.5 py-1.5 text-[#a39e97]"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              if (!isEncargado) return
                              setEditingId(item.id)
                              setEditQty(String(item.current_qty))
                            }}
                            className={`ml-2 flex items-baseline gap-0.5 rounded-lg px-2.5 py-1 ${isEncargado ? 'hover:bg-[#f3efe9] cursor-pointer active:scale-95' : ''}`}
                          >
                            <span className={`text-base font-bold tabular-nums ${c.text}`}>
                              {item.current_qty}
                            </span>
                            <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
