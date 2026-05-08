'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ArrowLeft, UtensilsCrossed, AlertTriangle, Check, ShoppingCart,
  Loader2, Send, Package, Clock, Pencil, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { FadeIn } from '@/components/ui/motion'

// Categories relevant to kitchen (NOT bar, NOT limpieza, NOT desechables)
const KITCHEN_CATEGORIES = ['carnes', 'verduras', 'frutas', 'lacteos', 'panaderia', 'condimentos', 'otros']
const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  carnes: { label: 'Proteínas', icon: '🥩' },
  verduras: { label: 'Verdulería', icon: '🥬' },
  frutas: { label: 'Frutas', icon: '🍎' },
  lacteos: { label: 'Lácteos', icon: '🥛' },
  panaderia: { label: 'Panadería', icon: '🍞' },
  condimentos: { label: 'Condimentos', icon: '🧂' },
  otros: { label: 'Otros', icon: '📦' },
}

type StockItem = {
  id: string
  name: string
  category: string
  unit: string
  current_qty: number
  min_qty: number
  is_active: boolean
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  fudo_skip: boolean | null
}

type KitchenOrder = {
  id: number
  product_name: string
  quantity: string
  status: string
  created_at: string
}

function getSemaphore(item: StockItem): 'red' | 'yellow' | 'green' {
  if (item.current_qty <= 0) return 'red'
  if (item.current_qty <= item.min_qty) return 'red'
  if (item.current_qty <= item.min_qty * 1.5) return 'yellow'
  return 'green'
}

const SEMAPHORE = {
  red: { label: 'Urgente', color: '#ea504c', bg: '#fef2f2', border: '#ea504c' },
  yellow: { label: 'Atención', color: '#d4943a', bg: '#fdf6ec', border: '#d4943a' },
  green: { label: 'OK', color: '#006d5a', bg: '#e8f5f1', border: '#006d5a' },
}

function getStockSource(item: StockItem) {
  if (item.fudo_product_id) return { label: 'Fudo producto', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true }
  if (item.fudo_ingredient_id) return { label: 'Fudo insumo', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true }
  if (item.fudo_skip === true) return { label: 'Local LVE', tone: 'bg-[#f3efe9] text-[#7d6c64]', actionable: true }
  return { label: 'Sin mapeo', tone: 'bg-[#fef2f2] text-[#ea504c]', actionable: false }
}

export default function CocinaStockPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [items, setItems] = useState<StockItem[]>([])
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Stock mode
  const [stockMode, setStockMode] = useState(false)
  const [stockDraft, setStockDraft] = useState<Map<string, string>>(new Map())
  const [savingStock, setSavingStock] = useState(false)

  // Order mode
  const [orderMode, setOrderMode] = useState(false)
  const [orderCart, setOrderCart] = useState<Map<string, { qty: string; note: string }>>(new Map())
  const [sendingOrders, setSendingOrders] = useState(false)

  // Handover
  const [lastHandover, setLastHandover] = useState<{
    shift_type: string; date: string; notes: string | null
    items: { id: string; name: string; qty: number }[]
    closedByName?: string; created_at?: string
  } | null>(null)
  const [handoverDismissed, setHandoverDismissed] = useState(false)
  const [closingShift, setClosingShift] = useState(false)

  // Editing single item
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')

  const canEdit = ['chef', 'cocina', 'socio', 'encargado'].includes(profile?.role ?? '')
  const currentShift = new Date().getHours() < 15 ? 'Mañana' : 'Noche'

  // Fetch data
  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const [itemsRes, ordersRes, handoverRes] = await Promise.all([
      supabase.from('stock_items')
        .select('id, name, category, unit, current_qty, min_qty, is_active, fudo_ingredient_id, fudo_product_id, fudo_skip')
        .eq('is_active', true)
        .in('category', KITCHEN_CATEGORIES)
        .order('category')
        .order('name'),
      supabase.from('kitchen_orders')
        .select('id, product_name, quantity, status, created_at')
        .in('status', ['pending', 'ordered', 'received'])
        .order('created_at', { ascending: false }),
      supabase.from('kitchen_shift_handover')
        .select('*, profiles:closed_by(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    setItems(itemsRes.data ?? [])
    setOrders(ordersRes.data ?? [])

    if (handoverRes.data) {
      const hd = handoverRes.data as Record<string, unknown>
      const prof = hd.profiles as { first_name: string; last_name: string } | null
      setLastHandover({
        shift_type: hd.shift_type as string,
        date: hd.date as string,
        notes: hd.notes as string | null,
        items: (hd.items as { id: string; name: string; qty: number }[]) ?? [],
        closedByName: prof ? `${prof.first_name} ${prof.last_name}` : undefined,
        created_at: hd.created_at as string,
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Filtered items
  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return items.filter(i =>
      i.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q) ||
      (CATEGORY_LABELS[i.category]?.label ?? i.category).toLowerCase().includes(q)
    )
  }, [items, search])

  // Semaphore counts
  const counts = useMemo(() => {
    let red = 0, yellow = 0, green = 0
    for (const item of filtered) {
      const s = getSemaphore(item)
      if (s === 'red') red++
      else if (s === 'yellow') yellow++
      else green++
    }
    return { red, yellow, green }
  }, [filtered])

  // Group by category
  const grouped = useMemo(() => {
    const byCat = new Map<string, StockItem[]>()
    for (const cat of KITCHEN_CATEGORIES) byCat.set(cat, [])
    for (const item of filtered) {
      const cat = KITCHEN_CATEGORIES.includes(item.category) ? item.category : 'otros'
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat)!.push(item)
    }
    // Sort urgents first within each category
    for (const [, catItems] of byCat) {
      catItems.sort((a, b) => {
        const sa = getSemaphore(a) === 'red' ? 0 : getSemaphore(a) === 'yellow' ? 1 : 2
        const sb = getSemaphore(b) === 'red' ? 0 : getSemaphore(b) === 'yellow' ? 1 : 2
        return sa !== sb ? sa - sb : a.name.localeCompare(b.name)
      })
    }
    return byCat
  }, [filtered])

  // Urgents
  const urgents = useMemo(() => filtered.filter(i => getSemaphore(i) === 'red'), [filtered])

  // Enter stock mode
  const enterStockMode = () => {
    const draft = new Map<string, string>()
    items.forEach(i => draft.set(i.id, String(i.current_qty)))
    setStockDraft(draft)
    setStockMode(true)
  }

  const syncStockItem = async (stockItemId: string, newQty: number) => {
    const res = await fetch('/api/stock/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stockItemId, newQty }),
    })
    const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string; message?: string }

    if (!res.ok || data.success === false) {
      throw new Error(data.error ?? data.message ?? 'Fudo no confirmó la actualización')
    }

    return data
  }

  // Save all stock
  const handleSaveStock = async () => {
    setSavingStock(true)
    let updated = 0
    try {
      const changed: { item: StockItem; newQty: number }[] = []
      for (const [itemId, qtyStr] of stockDraft) {
        const newQty = parseFloat(qtyStr) || 0
        if (newQty < 0) { toast.error('No se permiten cantidades negativas'); continue }
        const item = items.find(i => i.id === itemId)
        if (!item || item.current_qty === newQty) continue
        changed.push({ item, newQty })
      }

      const blocked = changed.filter(({ item }) => !getStockSource(item).actionable)
      if (blocked.length > 0) {
        throw new Error(`Hay items sin mapeo Fudo/Local LVE: ${blocked.map(({ item }) => item.name).join(', ')}`)
      }

      for (const { item, newQty } of changed) {
        await syncStockItem(item.id, newQty)
        updated++
      }
      toast.success(`Stock actualizado — ${updated} item${updated !== 1 ? 's' : ''}`)
      setStockMode(false)
      fetchData()
    } catch (err) {
      toast.error(
        updated > 0
          ? `Stock parcial (${updated}). Bloqueado por Fudo: ${err instanceof Error ? err.message : 'error'}`
          : `Stock no actualizado: ${err instanceof Error ? err.message : 'Fudo no confirmó la actualización'}`,
      )
      fetchData()
    } finally {
      setSavingStock(false)
    }
  }

  // Update single item
  const handleUpdateSingle = async (itemId: string) => {
    const newQty = parseFloat(editQty) || 0
    if (newQty < 0) { toast.error('No se permiten cantidades negativas'); return }
    try {
      const item = items.find(i => i.id === itemId)
      if (item && !getStockSource(item).actionable) {
        toast.error('Stock bloqueado: item sin mapeo Fudo ni Local LVE')
        return
      }
      await syncStockItem(itemId, newQty)
      toast.success('Actualizado')
      setEditingId(null)
      fetchData()
    } catch (err) {
      toast.error(`Stock no actualizado: ${err instanceof Error ? err.message : 'Fudo no confirmó la actualización'}`)
    }
  }

  // Toggle cart
  const toggleOrderCart = (id: string) => {
    const cart = new Map(orderCart)
    if (cart.has(id)) cart.delete(id)
    else cart.set(id, { qty: '', note: '' })
    setOrderCart(cart)
  }

  // Send all orders
  const handleSendOrders = async () => {
    if (orderCart.size === 0 || sendingOrders) return
    setSendingOrders(true)
    let sent = 0
    try {
      for (const [itemId, { qty }] of orderCart) {
        const item = items.find(i => i.id === itemId)
        if (!item || !qty.trim()) continue
        const res = await fetch('/api/kitchen/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            productName: item.name,
            category: item.category,
            quantity: qty.trim(),
            urgency: getSemaphore(item) === 'red' ? 'urgente' : 'normal',
          }),
        })
        if (res.ok) sent++
      }
      toast.success(`${sent} pedido${sent !== 1 ? 's' : ''} enviado${sent !== 1 ? 's' : ''} al encargado`)
      setOrderMode(false)
      setOrderCart(new Map())
      fetchData()
    } catch {
      toast.error('Error al enviar pedidos')
    } finally {
      setSendingOrders(false)
    }
  }

  // Close shift
  const handleCloseShift = async () => {
    if (closingShift) return
    setClosingShift(true)
    try {
      const supabase = createClient()
      const shiftType = new Date().getHours() < 15 ? 'morning' : 'night'
      const today = format(new Date(), 'yyyy-MM-dd')
      const handoverItems = items.map(i => ({ id: i.id, name: i.name, qty: i.current_qty }))
      const { error } = await supabase.from('kitchen_shift_handover').insert({
        shift_type: shiftType,
        date: today,
        closed_by: profile?.id,
        items: handoverItems,
        notes: null,
      })
      if (error) throw error
      toast.success('Turno cerrado — stock guardado para el siguiente')
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cerrar turno')
    } finally {
      setClosingShift(false)
    }
  }

  if (profileLoading || loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-[#a39e97]" /></div>
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link href="/cocina" className="icon-btn flex items-center justify-center rounded-xl bg-secondary">
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex-1">
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Stock Cocina</h1>
            <p className="text-[11px] text-[#a39e97]">
              Turno {currentShift} · {profile?.first_name} · {format(new Date(), "d MMM HH:mm", { locale: es })}
            </p>
          </div>
          <UtensilsCrossed className="size-5 text-[#8b5e34]" />
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar insumo o producto..."
            className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] py-2.5 pl-10 pr-3 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          />
          <Package className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#a39e97] hover:bg-[#f3efe9]">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Quick stats */}
        <div className="mt-3 flex gap-2">
          {(['red', 'yellow', 'green'] as const).map(color => (
            <div key={color} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2`} style={{ backgroundColor: SEMAPHORE[color].bg }}>
              <span className="size-2 rounded-full" style={{ backgroundColor: SEMAPHORE[color].color }} />
              <span className="text-xs font-bold" style={{ color: SEMAPHORE[color].color }}>{counts[color]}</span>
              <span className="text-[10px]" style={{ color: SEMAPHORE[color].color }}>{SEMAPHORE[color].label.toLowerCase()}</span>
            </div>
          ))}
        </div>
      </FadeIn>

      {/* Handover from previous shift */}
      {lastHandover && !handoverDismissed && (
        <div className="rounded-2xl border border-[#8b5e34]/30 bg-[#faf0e4] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-[#8b5e34]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#8b5e34]">
                Turno anterior — {lastHandover.closedByName ?? 'Anónimo'}
              </span>
            </div>
            <button onClick={() => setHandoverDismissed(true)} className="text-[#8b5e34]/50 hover:text-[#8b5e34]">
              <X className="size-4" />
            </button>
          </div>
          <p className="text-[10px] text-[#8b5e34]/60 mb-2">
            {lastHandover.created_at ? format(new Date(lastHandover.created_at), "d MMM HH:mm", { locale: es }) : lastHandover.date}
          </p>
          {lastHandover.notes && <p className="text-xs text-[#8b5e34] mb-2 italic">&quot;{lastHandover.notes}&quot;</p>}
          <div className="grid grid-cols-3 gap-1.5">
            {(lastHandover.items ?? []).slice(0, 9).map((item, i) => (
              <div key={i} className="rounded-lg bg-white/70 px-2 py-1.5 text-center">
                <p className="text-[10px] text-[#3d2c24] truncate">{item.name}</p>
                <p className="text-sm font-bold tabular-nums text-[#8b5e34]">{item.qty}</p>
              </div>
            ))}
          </div>
          {(lastHandover.items ?? []).length > 9 && (
            <p className="text-[10px] text-[#8b5e34]/50 mt-1 text-center">+{(lastHandover.items ?? []).length - 9} más</p>
          )}
        </div>
      )}

      {/* Action buttons */}
      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (stockMode) {
                setStockMode(false)
                return
              }
              setOrderMode(false)
              setOrderCart(new Map())
              enterStockMode()
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold transition-all ${
              stockMode ? 'bg-[#006d5a] text-white' : 'border border-[#ebe6df] bg-white text-[#3d2c24] hover:border-[#006d5a]'
            }`}
          >
            <Pencil className="size-3.5" />
            {stockMode ? 'Contando...' : 'Contar cantidades'}
          </button>
          <button
            onClick={() => {
              if (orderMode) {
                setOrderMode(false)
                setOrderCart(new Map())
                return
              }
              setStockMode(false)
              setOrderMode(true)
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold transition-all ${
              orderMode ? 'bg-[#8b5e34] text-white' : 'border border-[#ebe6df] bg-white text-[#3d2c24] hover:border-[#8b5e34]'
            }`}
          >
            <ShoppingCart className="size-3.5" />
            {orderMode ? `Reposición (${orderCart.size})` : 'Pedir reposición'}
          </button>
        </div>
      )}

      {stockMode && (
        <div className="rounded-xl border border-[#dcefe8] bg-[#f6fcfa] px-3 py-2 text-[12px] leading-relaxed text-[#006d5a]">
          Contá lo que hay físicamente. Los items Fudo impactan en Fudo; los Local LVE impactan solo en LVE. Los sin mapeo quedan bloqueados.
        </div>
      )}

      {orderMode && (
        <div className="rounded-xl border border-[#ead8c6] bg-[#fffaf2] px-3 py-2 text-[12px] leading-relaxed text-[#8b5e34]">
          Marcá faltantes para reposición. Esto no cambia stock: solo arma pedidos para resolver quiebres.
        </div>
      )}

      {/* Sticky save/send bars */}
      {stockMode && (
        <div className="sticky top-0 z-10 flex gap-2 rounded-xl bg-[#006d5a] p-3 shadow-lg">
          <button onClick={() => setStockMode(false)} className="flex-1 rounded-lg bg-white/20 py-2.5 text-xs font-semibold text-white">Cancelar</button>
          <button onClick={handleSaveStock} disabled={savingStock} className="flex flex-[2] items-center justify-center gap-1.5 rounded-lg bg-white py-2.5 text-xs font-bold text-[#006d5a] disabled:opacity-50">
            {savingStock ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Guardar conteo
          </button>
        </div>
      )}
      {orderMode && orderCart.size > 0 && (
        <div className="sticky top-0 z-10 flex gap-2 rounded-xl bg-[#8b5e34] p-3 shadow-lg">
          <button onClick={() => { setOrderMode(false); setOrderCart(new Map()) }} className="flex-1 rounded-lg bg-white/20 py-2.5 text-xs font-semibold text-white">Cancelar</button>
          <button onClick={handleSendOrders} disabled={sendingOrders} className="flex flex-[2] items-center justify-center gap-1.5 rounded-lg bg-white py-2.5 text-xs font-bold text-[#8b5e34] disabled:opacity-50">
            {sendingOrders ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Enviar {orderCart.size} pedido{orderCart.size !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Close shift */}
      {canEdit && !stockMode && !orderMode && (
        <button
          onClick={handleCloseShift}
          disabled={closingShift}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#ebe6df] py-3 text-xs font-semibold text-[#a39e97] transition-colors hover:border-[#006d5a] hover:text-[#006d5a]"
        >
          {closingShift ? <Loader2 className="size-3.5 animate-spin" /> : <Clock className="size-3.5" />}
          Cerrar turno y guardar stock
        </button>
      )}

      {/* Urgents section */}
      {urgents.length > 0 && (
        <div className="rounded-2xl border-2 border-[#ea504c]/30 bg-[#fef2f2] p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="size-4 text-[#ea504c]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#ea504c]">
              Urgente — Reponer ({urgents.length})
            </span>
          </div>
          <div className="space-y-1.5">
            {urgents.map(item => (
              <ItemRow
                key={item.id} item={item} canEdit={canEdit}
                stockMode={stockMode} stockDraft={stockDraft}
                onStockDraftChange={(id, val) => setStockDraft(new Map(stockDraft).set(id, val))}
                orderMode={orderMode} orderCart={orderCart}
                onToggleCart={toggleOrderCart}
                onCartQtyChange={(id, qty) => { const c = new Map(orderCart); const e = c.get(id); if (e) { e.qty = qty; c.set(id, e) }; setOrderCart(c) }}
                editingId={editingId} editQty={editQty}
                onEditStart={(id, qty) => { setEditingId(id); setEditQty(String(qty)) }}
                onEditCancel={() => setEditingId(null)}
                onEditSave={handleUpdateSingle}
                onEditQtyChange={setEditQty}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pending orders */}
      {orders.length > 0 && !stockMode && !orderMode && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart className="size-4 text-[#d4943a]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#d4943a]">Pedidos pendientes ({orders.length})</span>
          </div>
          <div className="space-y-1.5">
            {orders.map(o => (
              <div key={o.id} className="flex items-center justify-between rounded-xl border bg-card px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-[#3d2c24]">{o.product_name}</p>
                  <p className="text-[10px] text-[#a39e97]">{o.quantity} · {o.status === 'pending' ? 'Pendiente' : o.status === 'ordered' ? 'Pedido' : 'Recibido'}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  o.status === 'received' ? 'bg-[#e8f5f1] text-[#006d5a]' : o.status === 'ordered' ? 'bg-[#fdf6ec] text-[#d4943a]' : 'bg-[#f3efe9] text-[#a39e97]'
                }`}>
                  {o.status === 'received' ? '✓ Llegó' : o.status === 'ordered' ? 'Pedido' : 'Esperando'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stock by category */}
      {Array.from(grouped.entries()).map(([cat, catItems]) => {
        if (catItems.length === 0) return null
        const catConfig = CATEGORY_LABELS[cat] ?? { label: cat, icon: '📦' }
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">{catConfig.icon}</span>
              <span className="text-xs font-bold uppercase tracking-wider text-[#3d2c24]">{catConfig.label} ({catItems.length})</span>
            </div>
            <div className="space-y-1.5">
              {catItems.map(item => (
                <ItemRow
                  key={item.id} item={item} canEdit={canEdit}
                  stockMode={stockMode} stockDraft={stockDraft}
                  onStockDraftChange={(id, val) => setStockDraft(new Map(stockDraft).set(id, val))}
                  orderMode={orderMode} orderCart={orderCart}
                  onToggleCart={toggleOrderCart}
                  onCartQtyChange={(id, qty) => { const c = new Map(orderCart); const e = c.get(id); if (e) { e.qty = qty; c.set(id, e) }; setOrderCart(c) }}
                  editingId={editingId} editQty={editQty}
                  onEditStart={(id, qty) => { setEditingId(id); setEditQty(String(qty)) }}
                  onEditCancel={() => setEditingId(null)}
                  onEditSave={handleUpdateSingle}
                  onEditQtyChange={setEditQty}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Item Row Component
// ---------------------------------------------------------------------------

function ItemRow({ item, canEdit, stockMode, stockDraft, onStockDraftChange, orderMode, orderCart, onToggleCart, onCartQtyChange, editingId, editQty, onEditStart, onEditCancel, onEditSave, onEditQtyChange }: {
  item: StockItem; canEdit: boolean
  stockMode: boolean; stockDraft: Map<string, string>; onStockDraftChange: (id: string, v: string) => void
  orderMode: boolean; orderCart: Map<string, { qty: string; note: string }>; onToggleCart: (id: string) => void; onCartQtyChange: (id: string, qty: string) => void
  editingId: string | null; editQty: string
  onEditStart: (id: string, qty: number) => void; onEditCancel: () => void; onEditSave: (id: string) => void; onEditQtyChange: (v: string) => void
}) {
  const s = SEMAPHORE[getSemaphore(item)]
  const isEditing = editingId === item.id
  const source = getStockSource(item)

  return (
    <div className="rounded-xl border bg-card overflow-hidden" style={{ borderLeftWidth: 3, borderLeftColor: s.border }}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Order checkbox */}
        {orderMode && (
          <button
            onClick={() => onToggleCart(item.id)}
            className={`size-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
              orderCart.has(item.id) ? 'border-[#8b5e34] bg-[#8b5e34] text-white' : 'border-[#ebe6df] bg-white'
            }`}
          >
            {orderCart.has(item.id) && <Check className="size-3.5" />}
          </button>
        )}

        {/* Name */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#3d2c24] truncate">{item.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${source.tone}`}>
              {source.label}
            </span>
          </div>
        </div>

        {/* Stock mode input */}
        {stockMode && !source.actionable ? (
          <span className="rounded-lg bg-[#fff7f7] px-2 py-1 text-[10px] font-bold text-[#ea504c]">
            Mapear
          </span>
        ) : stockMode ? (
          <input
            value={stockDraft.get(item.id) ?? String(item.current_qty)}
            onChange={(e) => onStockDraftChange(item.id, e.target.value)}
            className="w-16 rounded-lg border border-[#006d5a] bg-[#f0f7f5] px-2 py-1.5 text-center text-sm font-bold tabular-nums text-[#006d5a] focus:outline-none focus:ring-2 focus:ring-[#006d5a]"
            inputMode="decimal"
          />
        ) : isEditing ? (
          <div className="flex items-center gap-1">
            <input
              value={editQty}
              onChange={(e) => onEditQtyChange(e.target.value)}
              className="w-14 rounded-lg border bg-white px-2 py-1.5 text-center text-sm font-bold tabular-nums focus:border-[#006d5a] focus:outline-none"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') onEditSave(item.id); if (e.key === 'Escape') onEditCancel() }}
            />
            <button onClick={() => onEditSave(item.id)} className="size-8 flex items-center justify-center rounded-lg bg-[#006d5a] text-white">
              <Check className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => canEdit && source.actionable ? onEditStart(item.id, item.current_qty) : undefined}
            title={source.actionable ? `Editar ${source.label}` : 'Bloqueado: falta mapear a Fudo o marcar Local LVE'}
            className={`flex items-baseline gap-0.5 rounded-lg px-2.5 py-1 ${canEdit && source.actionable ? 'hover:bg-[#f3efe9] active:scale-95 cursor-pointer' : 'opacity-60'}`}
            style={{ color: s.color }}
          >
            <span className="text-base font-bold tabular-nums">{item.current_qty}</span>
            <span className="text-[10px] font-medium opacity-60">{item.unit}</span>
          </button>
        )}
      </div>

      {/* Order cart qty */}
      {orderMode && orderCart.has(item.id) && (
        <div className="border-t bg-[#faf0e4] px-3 py-2.5 flex items-center gap-2">
          <span className="text-xs text-[#8b5e34] font-medium">Cantidad:</span>
          <input
            value={orderCart.get(item.id)?.qty ?? ''}
            onChange={(e) => onCartQtyChange(item.id, e.target.value)}
            placeholder="ej: 5 kg"
            className="flex-1 rounded-lg border border-[#8b5e34]/30 bg-white px-2.5 py-1.5 text-sm focus:border-[#8b5e34] focus:outline-none"
            autoFocus
          />
        </div>
      )}
    </div>
  )
}
