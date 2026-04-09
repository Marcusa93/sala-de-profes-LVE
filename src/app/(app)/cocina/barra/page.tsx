'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ArrowLeft, Coffee, AlertTriangle, Check, ShoppingCart,
  Loader2, Minus, Plus, Send, Package, Clock, ChevronDown,
  ChevronUp, History, Pencil, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { logAuditClient } from '@/lib/audit'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { FadeIn } from '@/components/ui/motion'
import { BAR_CATEGORIES } from '@/lib/constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BarItem = {
  id: number
  name: string
  category: string
  unit: string | null
  current_qty: number
  min_level: number
  current_detail: string | null
  is_urgent: boolean
  is_active: boolean
}

const UNIT_SHORT: Record<string, string> = {
  unidad: 'u', litro: 'lt', kg: 'kg', gr: 'gr', caja: 'caja', ml: 'ml',
}

type BarOrder = {
  id: number
  product_name: string
  quantity: string
  status: string
  note: string | null
  created_at: string
  bar_stock_item_id: number | null
}

type LogEntry = {
  id: number
  action: string
  old_qty: number | null
  new_qty: number | null
  note: string | null
  created_at: string
  user_id: string | null
  profiles?: { first_name: string; last_name: string } | null
}

type SemaphoreColor = 'red' | 'yellow' | 'green'

function getSemaphore(item: BarItem): SemaphoreColor {
  if (item.is_urgent || item.current_qty === 0) return 'red'
  if (item.current_qty <= item.min_level) return 'yellow'
  return 'green'
}

const SEMAPHORE = {
  red: { label: 'Urgente', color: '#ea504c', bg: '#fef2f2', border: '#ea504c' },
  yellow: { label: 'Atención', color: '#d4943a', bg: '#fdf6ec', border: '#d4943a' },
  green: { label: 'OK', color: '#006d5a', bg: '#e8f5f1', border: '#006d5a' },
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MiBarraPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [items, setItems] = useState<BarItem[]>([])
  const [orders, setOrders] = useState<BarOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [showOk, setShowOk] = useState(true)
  const [search, setSearch] = useState('')

  // Consumption data from Fudo
  const [consumption, setConsumption] = useState<{ id: number; consumed: number; consumedUnit: string; pctUsed: number }[]>([])
  const [consumptionLoaded, setConsumptionLoaded] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editQty, setEditQty] = useState('')

  // Order dialog
  const [orderItemId, setOrderItemId] = useState<number | null>(null)
  const [orderQty, setOrderQty] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [ordering, setOrdering] = useState(false)

  // History
  const [historyItemId, setHistoryItemId] = useState<number | null>(null)
  const [historyLogs, setHistoryLogs] = useState<LogEntry[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Handover state
  const [lastHandover, setLastHandover] = useState<{
    shift_type: string; date: string; notes: string | null
    items: { id: number; name: string; qty: number }[]
    closedByName?: string
    created_at?: string
  } | null>(null)
  const [closingShift, setClosingShift] = useState(false)
  const [handoverDismissed, setHandoverDismissed] = useState(false)

  // Quick stock mode
  const [stockMode, setStockMode] = useState(false)
  const [stockDraft, setStockDraft] = useState<Map<number, string>>(new Map())
  const [savingStock, setSavingStock] = useState(false)

  // Multi-order mode
  const [orderMode, setOrderMode] = useState(false)
  const [orderCart, setOrderCart] = useState<Map<number, { qty: string; note: string }>>(new Map())
  const [sendingOrders, setSendingOrders] = useState(false)

  const isManager = isManagerOrAbove(profile?.role)
  const canEdit = profile?.role === 'barista' || isManager

  // Fetch everything
  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const [itemsRes, ordersRes, handoverRes] = await Promise.all([
      supabase.from('bar_stock_items').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('bar_orders').select('*').in('status', ['pending', 'ordered', 'received']).order('created_at', { ascending: false }),
      supabase.from('bar_shift_handover').select('*, profiles:closed_by(first_name, last_name)').order('created_at', { ascending: false }).limit(1).maybeSingle(),
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
        items: (hd.items as { id: number; name: string; qty: number }[]) ?? [],
        closedByName: prof ? `${prof.first_name} ${prof.last_name}` : undefined,
        created_at: hd.created_at as string,
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Fetch Fudo consumption (lazy, after main data)
  useEffect(() => {
    if (loading || consumptionLoaded) return
    fetch('/api/bar/consumption')
      .then(r => r.json())
      .then(d => {
        if (d.consumption) setConsumption(d.consumption)
        setConsumptionLoaded(true)
      })
      .catch(() => setConsumptionLoaded(true))
  }, [loading, consumptionLoaded])

  // Filter by search
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return items.filter(i =>
      i.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q) ||
      (BAR_CATEGORIES[i.category as keyof typeof BAR_CATEGORIES]?.label ?? i.category).toLowerCase().includes(q)
    )
  }, [items, search])

  // Semaphore counts (for stats)
  const semaphoreCounts = useMemo(() => {
    let red = 0, yellow = 0, green = 0
    for (const item of filteredItems) {
      const s = getSemaphore(item)
      if (s === 'red') red++
      else if (s === 'yellow') yellow++
      else green++
    }
    return { red, yellow, green }
  }, [filteredItems])

  // Group by category — urgents first within each category
  const grouped = useMemo(() => {
    // Urgents across all categories go in a special section
    const urgents = filteredItems.filter(i => getSemaphore(i) === 'red')

    // Group rest by category (including urgents in their category too)
    const byCat = new Map<string, BarItem[]>()
    const catOrder = ['cafe', 'lacteos', 'insumos_oyambre', 'suministros', 'packaging', 'general']
    for (const cat of catOrder) byCat.set(cat, [])

    for (const item of filteredItems) {
      const cat = item.category || 'general'
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat)!.push(item)
    }

    // Sort items within each category: urgents first, then by name
    for (const [, items] of byCat) {
      items.sort((a, b) => {
        const sa = getSemaphore(a) === 'red' ? 0 : getSemaphore(a) === 'yellow' ? 1 : 2
        const sb = getSemaphore(b) === 'red' ? 0 : getSemaphore(b) === 'yellow' ? 1 : 2
        if (sa !== sb) return sa - sb
        return a.name.localeCompare(b.name)
      })
    }

    return { urgents, byCat }
  }, [filteredItems])

  // Build consumption map for passing to sections
  const consumptionMap = useMemo(() => {
    const map = new Map<number, { consumed: number; unit: string; pctUsed: number }>()
    for (const c of consumption) {
      if (c.consumed > 0) {
        map.set(c.id, { consumed: c.consumed, unit: c.consumedUnit, pctUsed: c.pctUsed })
      }
    }
    return map
  }, [consumption])

  // Items with received orders (need stock update)
  const receivedOrders = useMemo(() => orders.filter(o => o.status === 'received'), [orders])

  // Map: item_id -> active order
  const orderByItem = useMemo(() => {
    const map = new Map<number, BarOrder>()
    for (const o of orders) {
      if (o.bar_stock_item_id && (o.status === 'pending' || o.status === 'ordered')) {
        map.set(o.bar_stock_item_id, o)
      }
    }
    return map
  }, [orders])

  // Update stock qty
  const handleUpdateQty = async (itemId: number, newQty: number) => {
    const item = items.find(i => i.id === itemId)
    if (!item) return

    try {
      const res = await fetch('/api/kitchen/bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_stock', itemId, qty: newQty }),
      })
      if (!res.ok) throw new Error('Error')

      // Log the change
      const supabase = createClient()
      await supabase.from('bar_stock_logs').insert({
        bar_stock_item_id: itemId,
        user_id: profile?.id,
        action: 'update',
        old_qty: item.current_qty,
        new_qty: newQty,
      })

      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'bar_stock_log', module: 'barra', entityType: 'bar_stock_log', description: 'User registró actividad barra' })
      setEditingId(null)
      toast.success(`${item.name} → ${newQty}`)
      fetchData()
    } catch {
      toast.error('Error al actualizar')
    }
  }

  // Create order
  const handleCreateOrder = async () => {
    if (!orderItemId || !orderQty.trim() || ordering) return
    const item = items.find(i => i.id === orderItemId)
    if (!item) return

    setOrdering(true)
    try {
      const res = await fetch('/api/kitchen/bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_order',
          barStockItemId: orderItemId,
          productName: item.name,
          category: item.category,
          quantity: orderQty.trim(),
          urgency: getSemaphore(item) === 'red' ? 'urgente' : 'normal',
          note: orderNote.trim() || null,
        }),
      })
      if (!res.ok) throw new Error('Error')
      toast.success(`Pedido de ${item.name} enviado`)
      setOrderItemId(null)
      setOrderQty('')
      setOrderNote('')
      fetchData()
    } catch {
      toast.error('Error al crear pedido')
    } finally {
      setOrdering(false)
    }
  }

  // Load history for an item
  const loadHistory = async (itemId: number) => {
    if (historyItemId === itemId) { setHistoryItemId(null); return }
    setHistoryItemId(itemId)
    setLoadingHistory(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('bar_stock_logs')
      .select('id, action, old_qty, new_qty, note, created_at, user_id, profiles:user_id(first_name, last_name)')
      .eq('bar_stock_item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(10)
    setHistoryLogs((data as unknown as LogEntry[]) ?? [])
    setLoadingHistory(false)
  }

  // Enter stock mode — pre-fill with current values
  const enterStockMode = () => {
    const draft = new Map<number, string>()
    items.forEach(i => draft.set(i.id, String(i.current_qty)))
    setStockDraft(draft)
    setStockMode(true)
  }

  // Save all stock changes at once (batch)
  const handleSaveStock = async () => {
    setSavingStock(true)
    try {
      const changes: { itemId: number; qty: number }[] = []
      for (const [itemId, qtyStr] of stockDraft) {
        const newQty = parseFloat(qtyStr) || 0
        const item = items.find(i => i.id === itemId)
        if (!item || item.current_qty === newQty) continue
        changes.push({ itemId, qty: newQty })
      }

      if (changes.length === 0) {
        toast('No hay cambios para guardar')
        setSavingStock(false)
        return
      }

      // Send all updates in parallel
      const results = await Promise.allSettled(
        changes.map(({ itemId, qty }) =>
          fetch('/api/kitchen/bar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_stock', itemId, qty }),
          })
        )
      )

      const updated = results.filter(r => r.status === 'fulfilled' && (r.value as Response).ok).length
      const failed = changes.length - updated

      if (failed > 0) {
        toast.error(`${updated} actualizados, ${failed} fallaron`)
      } else {
        toast.success(`Stock actualizado — ${updated} item${updated !== 1 ? 's' : ''}`)
      }
      setStockMode(false)
      fetchData()
    } catch {
      toast.error('Error al guardar stock')
    } finally {
      setSavingStock(false)
    }
  }

  // Toggle item in order cart
  const toggleOrderCart = (itemId: number) => {
    const cart = new Map(orderCart)
    if (cart.has(itemId)) {
      cart.delete(itemId)
    } else {
      cart.set(itemId, { qty: '', note: '' })
    }
    setOrderCart(cart)
  }

  // Send all orders at once (batch)
  const handleSendOrders = async () => {
    if (orderCart.size === 0 || sendingOrders) return
    setSendingOrders(true)
    try {
      const orders: { itemId: number; item: typeof items[0]; qty: string; note: string }[] = []
      for (const [itemId, { qty, note }] of orderCart) {
        const item = items.find(i => i.id === itemId)
        if (!item || !qty.trim()) continue
        orders.push({ itemId, item, qty: qty.trim(), note: note.trim() })
      }

      const results = await Promise.allSettled(
        orders.map(({ itemId, item, qty, note }) =>
          fetch('/api/kitchen/bar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create_order',
              barStockItemId: itemId,
              productName: item.name,
              category: item.category,
              quantity: qty,
              urgency: getSemaphore(item) === 'red' ? 'urgente' : 'normal',
              note: note || null,
            }),
          })
        )
      )

      const sent = results.filter(r => r.status === 'fulfilled' && (r.value as Response).ok).length
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

  // Close shift — save current stock as handover
  const handleCloseShift = async () => {
    if (closingShift) return
    setClosingShift(true)
    try {
      const supabase = createClient()
      const shiftType = new Date().getHours() < 15 ? 'morning' : 'night'
      const today = format(new Date(), 'yyyy-MM-dd')

      const handoverItems = items.map(i => ({
        id: i.id,
        name: i.name,
        qty: i.current_qty,
        unit: i.unit,
        category: i.category,
        detail: i.current_detail,
      }))

      const { error } = await supabase.from('bar_shift_handover').insert({
        shift_type: shiftType,
        date: today,
        closed_by: profile?.id,
        items: handoverItems,
        notes: null,
      })

      if (error) throw error
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'bar_handover', module: 'barra', entityType: 'bar_shift_handover', description: 'User registró traspaso de barra' })
      toast.success('Turno cerrado — stock guardado para el siguiente')
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cerrar turno')
    } finally {
      setClosingShift(false)
    }
  }

  if (profileLoading || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[#a39e97]" />
      </div>
    )
  }

  const currentShift = new Date().getHours() < 15 ? 'Mañana' : 'Noche'

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link href="/" className="icon-btn flex items-center justify-center rounded-xl bg-secondary">
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex-1">
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Stock Cafetería</h1>
            <p className="text-[11px] text-[#a39e97]">
              Turno {currentShift} · {profile?.first_name} · {format(new Date(), "d MMM HH:mm", { locale: es })}
            </p>
          </div>
          <Coffee className="size-5 text-[#8b5e34]" />
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto..."
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
          <div className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#fef2f2] py-2">
            <span className="size-2 rounded-full bg-[#ea504c]" />
            <span className="text-xs font-bold text-[#ea504c]">{semaphoreCounts.red}</span>
            <span className="text-[10px] text-[#ea504c]">urgente</span>
          </div>
          <div className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#fdf6ec] py-2">
            <span className="size-2 rounded-full bg-[#d4943a]" />
            <span className="text-xs font-bold text-[#d4943a]">{semaphoreCounts.yellow}</span>
            <span className="text-[10px] text-[#d4943a]">atención</span>
          </div>
          <div className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#e8f5f1] py-2">
            <span className="size-2 rounded-full bg-[#006d5a]" />
            <span className="text-xs font-bold text-[#006d5a]">{semaphoreCounts.green}</span>
            <span className="text-[10px] text-[#006d5a]">ok</span>
          </div>
        </div>
      </FadeIn>

      {/* ============================================================= */}
      {/* HANDOVER — what the previous shift left */}
      {/* ============================================================= */}
      {lastHandover && !handoverDismissed && (
        <div className="rounded-2xl border border-[#006d5a]/30 bg-[#f0f7f5] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-[#006d5a]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#006d5a]">
                Turno anterior — {lastHandover.closedByName ?? 'Anónimo'}
              </span>
            </div>
            <button onClick={() => setHandoverDismissed(true)} className="text-[#006d5a]/50 hover:text-[#006d5a]">
              <X className="size-4" />
            </button>
          </div>
          <p className="text-[10px] text-[#006d5a]/60 mb-2">
            {lastHandover.created_at ? format(new Date(lastHandover.created_at), "d MMM HH:mm", { locale: es }) : lastHandover.date} · Turno {lastHandover.shift_type === 'morning' ? 'Mañana' : 'Noche'}
          </p>
          {lastHandover.notes && (
            <p className="text-xs text-[#006d5a] mb-2 italic">&quot;{lastHandover.notes}&quot;</p>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            {(lastHandover.items ?? []).slice(0, 9).map((item, i) => (
              <div key={i} className="rounded-lg bg-white/70 px-2 py-1.5 text-center">
                <p className="text-[10px] text-[#3d2c24] truncate">{item.name}</p>
                <p className="text-sm font-bold tabular-nums text-[#006d5a]">{item.qty}</p>
              </div>
            ))}
          </div>
          {(lastHandover.items ?? []).length > 9 && (
            <p className="text-[10px] text-[#006d5a]/50 mt-1 text-center">
              +{(lastHandover.items ?? []).length - 9} items más
            </p>
          )}
        </div>
      )}

      {/* ============================================================= */}
      {/* ACTION BUTTONS — Stock / Pedir / Cerrar turno */}
      {/* ============================================================= */}
      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={() => { if (stockMode) { setStockMode(false) } else { enterStockMode() } }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold transition-all ${
              stockMode
                ? 'bg-[#006d5a] text-white'
                : 'border border-[#ebe6df] bg-white text-[#3d2c24] hover:border-[#006d5a]'
            }`}
          >
            <Pencil className="size-3.5" />
            {stockMode ? 'Editando stock...' : 'Hacer stock'}
          </button>
          <button
            onClick={() => { if (orderMode) { setOrderMode(false); setOrderCart(new Map()) } else { setOrderMode(true) } }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold transition-all ${
              orderMode
                ? 'bg-[#8b5e34] text-white'
                : 'border border-[#ebe6df] bg-white text-[#3d2c24] hover:border-[#8b5e34]'
            }`}
          >
            <ShoppingCart className="size-3.5" />
            {orderMode ? `Pedido (${orderCart.size})` : 'Armar pedido'}
          </button>
        </div>
      )}

      {/* SAVE STOCK bar — sticky when in stock mode */}
      {stockMode && (
        <div className="sticky top-0 z-10 flex gap-2 rounded-xl bg-[#006d5a] p-3 shadow-lg">
          <button
            onClick={() => setStockMode(false)}
            className="flex-1 rounded-lg bg-white/20 py-2.5 text-xs font-semibold text-white"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveStock}
            disabled={savingStock}
            className="flex flex-[2] items-center justify-center gap-1.5 rounded-lg bg-white py-2.5 text-xs font-bold text-[#006d5a] disabled:opacity-50"
          >
            {savingStock ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Guardar stock
          </button>
        </div>
      )}

      {/* SEND ORDERS bar — sticky when in order mode */}
      {orderMode && orderCart.size > 0 && (
        <div className="sticky top-0 z-10 flex gap-2 rounded-xl bg-[#8b5e34] p-3 shadow-lg">
          <button
            onClick={() => { setOrderMode(false); setOrderCart(new Map()) }}
            className="flex-1 rounded-lg bg-white/20 py-2.5 text-xs font-semibold text-white"
          >
            Cancelar
          </button>
          <button
            onClick={handleSendOrders}
            disabled={sendingOrders}
            className="flex flex-[2] items-center justify-center gap-1.5 rounded-lg bg-white py-2.5 text-xs font-bold text-[#8b5e34] disabled:opacity-50"
          >
            {sendingOrders ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Enviar {orderCart.size} pedido{orderCart.size !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Close shift button moved to bottom of page — single location */}

      {/* ============================================================= */}
      {/* SECTION: Mercadería recibida — needs stock update */}
      {/* ============================================================= */}
      {receivedOrders.length > 0 && (
        <div className="rounded-2xl border-2 border-[#006d5a] bg-[#e8f5f1] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package className="size-4 text-[#006d5a]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#006d5a]">
              Llegó mercadería ({receivedOrders.length})
            </span>
          </div>
          <p className="text-xs text-[#006d5a]/70 mb-3">Revisá y actualizá el stock de cada item</p>
          <div className="space-y-2">
            {receivedOrders.map(order => (
              <div key={order.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-[#3d2c24]">{order.product_name}</p>
                  <p className="text-[11px] text-[#a39e97]">{order.quantity}</p>
                </div>
                <Check className="size-5 text-[#006d5a]" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* SECTION: Urgentes — always visible if any */}
      {/* ============================================================= */}
      {grouped.urgents.length > 0 && (
        <div className="rounded-2xl border-2 border-[#ea504c]/30 bg-[#fef2f2] p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="size-4 text-[#ea504c]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#ea504c]">
              Urgente — Reponer ({grouped.urgents.length})
            </span>
          </div>
          <Section
            color="red"
            label=""
            items={grouped.urgents}
            orderByItem={orderByItem}
            editingId={editingId}
            editQty={editQty}
            canEdit={canEdit}
            historyItemId={historyItemId}
            historyLogs={historyLogs}
            loadingHistory={loadingHistory}
            onEditStart={(id, qty) => { setEditingId(id); setEditQty(String(qty)) }}
            onEditCancel={() => setEditingId(null)}
            onEditSave={(id) => handleUpdateQty(id, parseFloat(editQty) || 0)}
            onEditQtyChange={setEditQty}
            onOrder={(id) => setOrderItemId(id)}
            onHistory={loadHistory}
            consumptionMap={consumptionMap}
            stockMode={stockMode}
            stockDraft={stockDraft}
            onStockDraftChange={(id, val) => setStockDraft(new Map(stockDraft).set(id, val))}
            orderMode={orderMode}
            orderCart={orderCart}
            onToggleCart={toggleOrderCart}
            onCartQtyChange={(id, qty) => { const c = new Map(orderCart); const e = c.get(id); if (e) { e.qty = qty; c.set(id, e) }; setOrderCart(c) }}
            hideHeader
          />
        </div>
      )}

      {/* ============================================================= */}
      {/* STOCK BY CATEGORY — all visible */}
      {/* ============================================================= */}
      {Array.from(grouped.byCat.entries()).map(([cat, catItems]) => {
        if (catItems.length === 0) return null
        const catConfig = BAR_CATEGORIES[cat as keyof typeof BAR_CATEGORIES]
        const catLabel = catConfig?.label ?? cat
        const catIcon = catConfig?.icon ?? '📦'

        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">{catIcon}</span>
              <span className="text-xs font-bold uppercase tracking-wider text-[#3d2c24]">
                {catLabel} ({catItems.length})
              </span>
            </div>
            <Section
              color="green"
              label=""
              items={catItems}
              orderByItem={orderByItem}
              editingId={editingId}
              editQty={editQty}
              canEdit={canEdit}
              historyItemId={historyItemId}
              historyLogs={historyLogs}
              loadingHistory={loadingHistory}
              consumptionMap={consumptionMap}
              stockMode={stockMode}
              stockDraft={stockDraft}
              onStockDraftChange={(id, val) => setStockDraft(new Map(stockDraft).set(id, val))}
              orderMode={orderMode}
              orderCart={orderCart}
              onToggleCart={toggleOrderCart}
              onCartQtyChange={(id, qty) => { const c = new Map(orderCart); const e = c.get(id); if (e) { e.qty = qty; c.set(id, e) }; setOrderCart(c) }}
              onEditStart={(id, qty) => { setEditingId(id); setEditQty(String(qty)) }}
              onEditCancel={() => setEditingId(null)}
              onEditSave={(id) => handleUpdateQty(id, parseFloat(editQty) || 0)}
              onEditQtyChange={setEditQty}
              onOrder={(id) => setOrderItemId(id)}
              onHistory={loadHistory}
              hideHeader
            />
          </div>
        )
      })}

      {/* ============================================================= */}
      {/* SECTION: Mis pedidos */}
      {/* ============================================================= */}
      {orders.filter(o => o.status !== 'received').length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart className="size-3.5 text-[#8b5e34]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#a39e97]">Mis pedidos</span>
          </div>
          <div className="space-y-1.5">
            {orders.filter(o => o.status !== 'received').map(order => {
              const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
                pending: { label: 'Pendiente', color: '#d4943a', bg: '#fdf6ec' },
                ordered: { label: 'Pedido ✓', color: '#006d5a', bg: '#e8f5f1' },
                cancelled: { label: 'Cancelado', color: '#ea504c', bg: '#fef2f2' },
              }
              const s = statusConfig[order.status] ?? statusConfig.pending
              return (
                <div key={order.id} className="flex items-center justify-between rounded-xl border bg-card px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#3d2c24]">{order.product_name}</p>
                    <p className="text-[11px] text-[#a39e97]">{order.quantity} · {format(new Date(order.created_at), 'd MMM HH:mm', { locale: es })}</p>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ color: s.color, backgroundColor: s.bg }}>
                    {s.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* CLOSE SHIFT — single button at bottom */}
      {/* ============================================================= */}
      {canEdit && !stockMode && !orderMode && (
        <button
          onClick={handleCloseShift}
          disabled={closingShift}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#8b5e34] py-3 text-sm font-bold text-white transition-all hover:bg-[#7a5230] active:scale-[0.98] disabled:opacity-50"
        >
          {closingShift ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Cerrar turno — Guardar estado para el siguiente
        </button>
      )}

      {/* ============================================================= */}
      {/* ORDER DIALOG — bottom sheet */}
      {/* ============================================================= */}
      {orderItemId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setOrderItemId(null)} />
          <div className="relative z-10 mx-3 mb-[calc(0.5rem+env(safe-area-inset-bottom))] w-full max-w-md rounded-2xl bg-white p-5 shadow-xl sm:mx-auto sm:mb-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[#3d2c24]">
                Pedir {items.find(i => i.id === orderItemId)?.name}
              </h3>
              <button onClick={() => setOrderItemId(null)} className="rounded-full p-1 text-[#a39e97] hover:bg-[#f3efe9]">
                <X className="size-5" />
              </button>
            </div>
            <input
              value={orderQty}
              onChange={(e) => setOrderQty(e.target.value)}
              placeholder="Cantidad (ej: 10 lt, 2 cajas)"
              className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-3 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
              autoFocus
            />
            <input
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
              placeholder="Nota opcional"
              className="mt-2 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-3 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
            />
            <button
              onClick={handleCreateOrder}
              disabled={!orderQty.trim() || ordering}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] text-sm font-bold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-50"
            >
              {ordering ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Enviar pedido
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section component — renders a list of items in a semaphore group
// ---------------------------------------------------------------------------

type SectionProps = {
  color: SemaphoreColor
  label: string
  items: BarItem[]
  orderByItem: Map<number, BarOrder>
  editingId: number | null
  editQty: string
  canEdit: boolean
  historyItemId: number | null
  historyLogs: LogEntry[]
  loadingHistory: boolean
  consumptionMap: Map<number, { consumed: number; unit: string; pctUsed: number }>
  stockMode: boolean
  stockDraft: Map<number, string>
  onStockDraftChange: (id: number, val: string) => void
  orderMode: boolean
  orderCart: Map<number, { qty: string; note: string }>
  onToggleCart: (id: number) => void
  onCartQtyChange: (id: number, qty: string) => void
  onEditStart: (id: number, qty: number) => void
  onEditCancel: () => void
  onEditSave: (id: number) => void
  onEditQtyChange: (v: string) => void
  onOrder: (id: number) => void
  onHistory: (id: number) => void
  hideHeader?: boolean
}

function Section({
  color, label, items, orderByItem, editingId, editQty, canEdit,
  historyItemId, historyLogs, loadingHistory, consumptionMap,
  stockMode, stockDraft, onStockDraftChange,
  orderMode, orderCart, onToggleCart, onCartQtyChange,
  onEditStart, onEditCancel, onEditSave, onEditQtyChange, onOrder, onHistory,
  hideHeader,
}: SectionProps) {
  const s = SEMAPHORE[color]

  return (
    <div>
      {!hideHeader && (
        <div className="flex items-center gap-2 mb-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: s.color }}>
            {label}
          </span>
        </div>
      )}
      <div className="space-y-1.5">
        {items.map(item => {
          const isEditing = editingId === item.id
          const activeOrder = orderByItem.get(item.id)
          const showingHistory = historyItemId === item.id
          const cat = BAR_CATEGORIES[item.category as keyof typeof BAR_CATEGORIES]

          // Per-item semaphore color when rendering by category
          const itemSemaphore = hideHeader ? SEMAPHORE[getSemaphore(item)] : s

          return (
            <div key={item.id} className="rounded-xl border bg-card overflow-hidden" style={{ borderLeftWidth: 3, borderLeftColor: itemSemaphore.border }}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                {/* Order mode checkbox */}
                {orderMode && (
                  <button
                    onClick={() => onToggleCart(item.id)}
                    className={`size-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
                      orderCart.has(item.id)
                        ? 'border-[#8b5e34] bg-[#8b5e34] text-white'
                        : 'border-[#ebe6df] bg-white'
                    }`}
                  >
                    {orderCart.has(item.id) && <Check className="size-3.5" />}
                  </button>
                )}

                {/* Name + category + consumption */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#3d2c24] truncate">{item.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-[#a39e97]">{cat?.label ?? item.category}</span>
                    {item.current_detail && (
                      <span className="text-[10px] font-medium text-[#d4943a]">{item.current_detail}</span>
                    )}
                    {(() => {
                      const cons = consumptionMap.get(item.id)
                      if (!cons || cons.consumed === 0) return null
                      return (
                        <span className="text-[10px] font-medium text-[#4a90d9]">
                          ↓{cons.consumed} {cons.unit} hoy
                        </span>
                      )
                    })()}
                  </div>
                </div>

                {/* Stock mode — inline input */}
                {stockMode ? (
                  <input
                    value={stockDraft.get(item.id) ?? String(item.current_qty)}
                    onChange={(e) => onStockDraftChange(item.id, e.target.value)}
                    className="w-16 rounded-lg border border-[#006d5a] bg-[#f0f7f5] px-2 py-1.5 text-center text-sm font-bold tabular-nums text-[#006d5a] focus:outline-none focus:ring-2 focus:ring-[#006d5a]"
                    inputMode="decimal"
                  />
                ) : isEditing ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => onEditQtyChange(String(Math.max(0, (parseFloat(editQty) || 0) - 1)))} className="size-8 flex items-center justify-center rounded-lg bg-secondary">
                      <Minus className="size-3" />
                    </button>
                    <input
                      value={editQty}
                      onChange={(e) => onEditQtyChange(e.target.value)}
                      className="w-14 rounded-lg border bg-white px-2 py-1.5 text-center text-sm font-bold tabular-nums focus:border-[#006d5a] focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') onEditSave(item.id); if (e.key === 'Escape') onEditCancel() }}
                    />
                    <button onClick={() => onEditQtyChange(String((parseFloat(editQty) || 0) + 1))} className="size-8 flex items-center justify-center rounded-lg bg-secondary">
                      <Plus className="size-3" />
                    </button>
                    <button onClick={() => onEditSave(item.id)} className="size-8 flex items-center justify-center rounded-lg bg-[#006d5a] text-white">
                      <Check className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {/* Quantity + unit */}
                    <button
                      onClick={() => canEdit ? onEditStart(item.id, item.current_qty) : undefined}
                      className={`flex items-baseline gap-0.5 rounded-lg px-2.5 py-1 ${canEdit ? 'hover:bg-[#f3efe9] active:scale-95 cursor-pointer' : ''}`}
                      style={{ color: itemSemaphore.color }}
                    >
                      <span className="text-base font-bold tabular-nums">{item.current_qty}</span>
                      {item.unit && (
                        <span className="text-[10px] font-medium opacity-60">
                          {UNIT_SHORT[item.unit] ?? item.unit}
                        </span>
                      )}
                    </button>

                    {/* Action: Pedir or order status */}
                    {activeOrder ? (
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold bg-[#e8f5f1] text-[#006d5a]">
                        {activeOrder.status === 'ordered' ? 'Pedido ✓' : 'Esperando'}
                      </span>
                    ) : color !== 'green' ? (
                      <button
                        onClick={() => onOrder(item.id)}
                        className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[10px] font-bold text-white active:scale-95"
                      >
                        Pedir
                      </button>
                    ) : null}

                    {/* History */}
                    <button onClick={() => onHistory(item.id)} className="rounded-lg p-1.5 text-[#a39e97] hover:bg-[#f3efe9]">
                      <History className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Order cart — qty input when selected */}
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

              {/* History panel */}
              {showingHistory && (
                <div className="border-t bg-[#faf8f5] px-3 py-2.5">
                  {loadingHistory ? (
                    <Loader2 className="size-4 animate-spin text-[#a39e97] mx-auto" />
                  ) : historyLogs.length === 0 ? (
                    <p className="text-[11px] text-[#a39e97] text-center">Sin movimientos</p>
                  ) : (
                    <div className="space-y-1.5">
                      {historyLogs.map(log => (
                        <div key={log.id} className="flex items-center justify-between text-[11px]">
                          <div>
                            <span className="font-medium text-[#3d2c24]">
                              {log.profiles?.first_name ?? '?'}
                            </span>
                            <span className="text-[#a39e97]">
                              {' '}cambió {log.old_qty} → {log.new_qty}
                            </span>
                          </div>
                          <span className="text-[#a39e97]">
                            {format(new Date(log.created_at), 'd MMM HH:mm', { locale: es })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
