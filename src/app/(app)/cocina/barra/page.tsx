'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Coffee,
  AlertTriangle,
  Check,
  ShoppingCart,
  Loader2,
  Minus,
  Plus,
  Send,
  X,
  Truck,
  MessageCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  FadeIn,
  StaggerList,
  StaggerItem,
  AnimatedNumber,
} from '@/components/ui/motion'
import { BAR_CATEGORIES, BAR_ORDER_URGENCY } from '@/lib/constants'
import type { BarCategoryValue, BarOrderUrgencyValue } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'

// DB urgency values differ from frontend: normal=normal, high=alta, critical=urgente
const DB_TO_FRONTEND_URGENCY: Record<string, BarOrderUrgencyValue> = {
  normal: 'normal',
  low: 'normal',
  high: 'alta',
  critical: 'urgente',
  // Also handle frontend values directly
  alta: 'alta',
  urgente: 'urgente',
}

const FALLBACK_URGENCY_CFG = { label: 'Normal', color: '#006d5a', bg: '#e8f5f1' }

type BarSupplier = { id: string; name: string; phone: string | null }

type BarItem = {
  id: number; name: string; category: BarCategoryValue; unit: string
  current_qty: number; current_detail: string | null; min_level: number
  is_urgent: boolean; supplier_id: string | null
}

type BarOrderRow = {
  id: number; product_name: string; category: string; quantity: string
  urgency: BarOrderUrgencyValue; status: string; note: string | null
  requested_by: string | null; created_at: string
}

export default function BarraPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<BarItem[]>([])
  const [orders, setOrders] = useState<BarOrderRow[]>([])
  const [suppliers, setSuppliers] = useState<Map<string, BarSupplier>>(new Map())

  // Edit dialog
  const [editItem, setEditItem] = useState<BarItem | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editDetail, setEditDetail] = useState('')
  const [saving, setSaving] = useState(false)

  // Order dialog
  const [orderItem, setOrderItem] = useState<BarItem | null>(null)
  const [orderQty, setOrderQty] = useState('')
  const [orderUrgency, setOrderUrgency] = useState<BarOrderUrgencyValue>('normal')
  const [orderNote, setOrderNote] = useState('')
  const [ordering, setOrdering] = useState(false)

  const isEncargado = profile?.role === 'encargado'
  const canEdit = ['encargado', 'barista'].includes(profile?.role ?? '')

  const fetchData = useCallback(async () => {
    const supabase = createClient()
    try {
      const [itemsRes, ordersRes, suppRes] = await Promise.all([
        supabase.from('bar_stock_items').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('bar_orders').select('*').in('status', ['pending', 'ordered']).order('created_at', { ascending: false }),
        supabase.from('suppliers').select('id, name, phone').eq('is_active', true),
      ])
      if (itemsRes.data) setItems(itemsRes.data as BarItem[])
      if (ordersRes.data) setOrders(ordersRes.data as BarOrderRow[])
      if (suppRes.data) {
        const map = new Map<string, BarSupplier>()
        for (const s of suppRes.data) map.set(s.id, s as BarSupplier)
        setSuppliers(map)
      }
    } catch {
      // Tables might not exist yet
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // -------------------------------------------------------------------------
  // Update stock qty
  // -------------------------------------------------------------------------

  function openEditDialog(item: BarItem) {
    setEditItem(item)
    setEditQty(String(item.current_qty))
    setEditDetail(item.current_detail ?? '')
  }

  async function handleSaveQty() {
    if (!editItem) return
    setSaving(true)
    try {
      const newQty = parseFloat(editQty) || 0
      const newDetail = editDetail.trim() || null
      const isNowUrgent = newQty <= 0 || newQty < editItem.min_level

      const res = await fetch('/api/kitchen/bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_stock',
          itemId: editItem.id,
          qty: newQty,
          detail: newDetail,
          isUrgent: isNowUrgent,
        }),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)

      setItems((prev) =>
        prev.map((i) =>
          i.id === editItem.id
            ? { ...i, current_qty: newQty, current_detail: newDetail, is_urgent: isNowUrgent }
            : i,
        ),
      )
      toast.success(`${editItem.name} actualizado`)
      setEditItem(null)
    } catch (err) {
      console.error(err)
      toast.error('Error al actualizar')
    } finally {
      setSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // Create order + notify encargado
  // -------------------------------------------------------------------------

  function openOrderDialog(item: BarItem) {
    setOrderItem(item)
    const needed = Math.max(0, item.min_level - item.current_qty)
    setOrderQty(needed > 0 ? `${needed} ${item.unit}` : '')
    setOrderUrgency(item.current_qty <= 0 ? 'urgente' : item.current_qty <= item.min_level ? 'alta' : 'normal')
    setOrderNote('')
  }

  async function handleCreateOrder() {
    if (!orderItem || !profile) return
    if (!orderQty.trim()) {
      toast.error('Indica la cantidad a pedir')
      return
    }
    setOrdering(true)
    try {
      const res = await fetch('/api/kitchen/bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_order',
          barStockItemId: orderItem.id,
          productName: orderItem.name,
          category: orderItem.category,
          quantity: orderQty.trim(),
          urgency: orderUrgency,
          note: orderNote.trim() || null,
        }),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)

      toast.success('Pedido enviado al encargado')
      setOrderItem(null)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Error al crear pedido')
    } finally {
      setOrdering(false)
    }
  }

  // -------------------------------------------------------------------------
  // Manage orders (encargado)
  // -------------------------------------------------------------------------

  async function updateOrderStatus(orderId: number, newStatus: string) {
    try {
      const res = await fetch('/api/kitchen/bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_order_status', orderId, status: newStatus }),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)

      if (newStatus === 'received' || newStatus === 'cancelled') {
        setOrders((prev) => prev.filter((o) => o.id !== orderId))
      } else {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)),
        )
      }
      toast.success(newStatus === 'ordered' ? 'Marcado como pedido' : newStatus === 'received' ? 'Pedido recibido' : 'Pedido cancelado')
    } catch {
      toast.error('Error al actualizar pedido')
    }
  }

  // Derived
  const urgent = items.filter((i) => i.is_urgent || i.current_qty <= 0)
  const lowStock = items.filter((i) => !i.is_urgent && i.current_qty > 0 && i.current_qty <= i.min_level)
  const ok = items.filter((i) => !i.is_urgent && i.current_qty > i.min_level)

  const grouped = useMemo(() => {
    const map = new Map<BarCategoryValue, BarItem[]>()
    for (const item of items) {
      const list = map.get(item.category) ?? []
      list.push(item)
      map.set(item.category, list)
    }
    return Array.from(map.entries()).map(([cat, catItems]) => ({
      category: cat,
      config: BAR_CATEGORIES[cat],
      items: catItems,
    }))
  }, [items])

  if (profileLoading || loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-[#006d5a]" /></div>
  }

  // Solo encargado y barista pueden acceder a barra
  if (profile && !['encargado', 'barista'].includes(profile.role)) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-4">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="rounded-lg p-1.5 text-[#a39e97] active:scale-90"><ArrowLeft className="size-5" /></Link>
          <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">☕ Barra</h1>
        </div>
        <div className="card-elevated-lg rounded-2xl p-6 text-center">
          <Coffee className="mx-auto size-10 text-[#a39e97]" />
          <p className="mt-4 text-sm font-medium text-[#3d2c24]">Acceso restringido</p>
          <p className="mt-1 text-xs text-[#a39e97]">Esta sección es solo para baristas y encargados.</p>
        </div>
      </div>
    )
  }

  if (items.length === 0 && orders.length === 0) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-4">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/cocina" className="rounded-lg p-1.5 text-[#a39e97] active:scale-90"><ArrowLeft className="size-5" /></Link>
          <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">☕ Barra</h1>
        </div>
        <div className="card-elevated-lg rounded-2xl p-6 text-center">
          <Coffee className="mx-auto size-10 text-[#a39e97]" />
          <p className="mt-4 text-sm font-medium text-[#3d2c24]">Sin datos de barra</p>
          <p className="mt-1 text-xs text-[#a39e97]">Ejecutá la migración SQL para activar el módulo</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg pb-28">
      {/* Header */}
      <FadeIn className="flex items-center gap-3 pt-2 pb-4">
        <Link href="/cocina" className="rounded-lg p-1.5 text-[#a39e97] active:scale-90"><ArrowLeft className="size-5" /></Link>
        <div className="flex-1">
          <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">☕ Barra</h1>
          <p className="section-label mt-0.5">Control de insumos y pedidos</p>
        </div>
        {urgent.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-[#fef2f2] px-3 py-1.5 text-[11px] font-bold text-[#ea504c]">
            <AlertTriangle className="size-3" />
            {urgent.length}
          </div>
        )}
      </FadeIn>

      {/* KPI row */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <div className="rounded-xl bg-[#fef2f2] p-3 text-center">
            <p className="font-display text-xl font-bold tabular-nums text-[#ea504c]"><AnimatedNumber value={urgent.length} /></p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#ea504c]">Urgente</p>
          </div>
          <div className="rounded-xl bg-[#fdf6ec] p-3 text-center">
            <p className="font-display text-xl font-bold tabular-nums text-[#d4943a]"><AnimatedNumber value={lowStock.length} /></p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">Bajo</p>
          </div>
          <div className="rounded-xl bg-[#e8f5f1] p-3 text-center">
            <p className="font-display text-xl font-bold tabular-nums text-[#006d5a]"><AnimatedNumber value={ok.length} /></p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">OK</p>
          </div>
        </div>
      </FadeIn>

      {/* Pedidos pendientes */}
      {orders.length > 0 && (
        <FadeIn delay={0.1}>
          <div className="mb-5">
            <div className="flex items-center gap-2 px-1 mb-2">
              <ShoppingCart className="size-4 text-[#d4943a]" />
              <span className="section-label text-[#d4943a]">Pedidos pendientes ({orders.length})</span>
            </div>
            <div className="space-y-1.5">
              {orders.map((order) => {
                const mappedUrgency = DB_TO_FRONTEND_URGENCY[order.urgency] ?? 'normal'
                const urgCfg = BAR_ORDER_URGENCY[mappedUrgency] ?? FALLBACK_URGENCY_CFG
                const isOrdered = order.status === 'ordered'
                return (
                  <div key={order.id} className={cn(
                    'rounded-xl px-3.5 py-3 ring-1 ring-[#ebe6df]/50',
                    isOrdered ? 'bg-[#f0f7f5]' : 'bg-white',
                  )}>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#3d2c24]">{order.product_name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[#a39e97]">
                          <span className="font-medium">{order.quantity}</span>
                          <span className="rounded-full px-1.5 py-0.5 font-bold" style={{ color: urgCfg.color, backgroundColor: urgCfg.bg }}>
                            {urgCfg.label}
                          </span>
                          {isOrdered && (
                            <span className="rounded-full bg-[#e8f5f1] px-1.5 py-0.5 font-bold text-[#006d5a]">
                              Pedido
                            </span>
                          )}
                          {order.note && <span className="italic truncate">{order.note}</span>}
                        </div>
                      </div>
                      {isEncargado ? (
                        <div className="flex gap-1">
                          {!isOrdered && (
                            <button
                              onClick={() => updateOrderStatus(order.id, 'ordered')}
                              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#d4943a] text-white active:scale-90"
                              title="Marcar como pedido"
                            >
                              <Truck className="size-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => updateOrderStatus(order.id, 'received')}
                            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#006d5a] text-white active:scale-90"
                            title="Recibido"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            onClick={() => updateOrderStatus(order.id, 'cancelled')}
                            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#fef2f2] text-[#ea504c] active:scale-90"
                            title="Cancelar"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => updateOrderStatus(order.id, 'received')}
                          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#006d5a] text-white active:scale-90"
                        >
                          <Check className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </FadeIn>
      )}

      {/* Stock by category */}
      <StaggerList className="space-y-4" staggerDelay={0.04}>
        {grouped.map((group) => (
          <StaggerItem key={group.category}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="text-base">{group.config.icon}</span>
              <span className="section-label" style={{ color: group.config.color }}>{group.config.label}</span>
            </div>
            <div className="space-y-1.5">
              {group.items.map((item) => {
                const isZero = item.current_qty <= 0
                const isLow = !isZero && item.current_qty <= item.min_level
                const semColor = isZero || item.is_urgent ? '#ea504c' : isLow ? '#d4943a' : '#006d5a'
                const needsOrder = isZero || isLow || item.is_urgent

                return (
                  <div key={item.id} className={cn(
                    'rounded-xl px-3.5 py-3 ring-1 ring-[#ebe6df]/50 transition-all',
                    isZero ? 'bg-[#fef2f2]/40' : isLow ? 'bg-[#fdf6ec]/30' : 'bg-white',
                  )}>
                    <div className="flex items-center gap-3">
                      <div className="size-2 shrink-0 rounded-full" style={{ backgroundColor: semColor }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#3d2c24]">{item.name}</p>
                        <p className="mt-0.5 text-[10px] text-[#a39e97]">
                          {item.current_detail ?? `${item.current_qty} ${item.unit}`}
                          {item.min_level > 0 && <span> · mín: {item.min_level} {item.unit}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <p className={cn('text-sm font-bold tabular-nums', isZero ? 'text-[#ea504c]' : isLow ? 'text-[#d4943a]' : 'text-[#3d2c24]')}>
                          {item.current_qty}
                        </p>
                        {canEdit && (
                          <>
                            <button
                              onClick={() => openEditDialog(item)}
                              className="flex size-7 items-center justify-center rounded-lg text-[#a39e97] transition-colors hover:bg-[#faf8f5] hover:text-[#3d2c24] active:scale-90"
                              title="Editar cantidad"
                            >
                              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                              </svg>
                            </button>
                            {needsOrder && (
                              <button
                                onClick={() => openOrderDialog(item)}
                                className={cn(
                                  'flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-all active:scale-95',
                                  isZero
                                    ? 'bg-[#ea504c] text-white'
                                    : 'bg-[#fef7ed] text-[#d4943a] hover:bg-[#d4943a] hover:text-white',
                                )}
                              >
                                <Send className="size-3" />
                                Pedir
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </StaggerItem>
        ))}
      </StaggerList>

      {/* Edit Qty Dialog */}
      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-[#3d2c24]">
              {editItem?.name}
            </DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              Actualizar stock actual
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setEditQty(String(Math.max(0, (parseFloat(editQty) || 0) - 1)))}
                className="flex size-10 items-center justify-center rounded-xl bg-[#faf8f5] text-[#3d2c24] ring-1 ring-[#ebe6df] active:scale-90"
              >
                <Minus className="size-4" />
              </button>
              <div className="text-center">
                <Input
                  type="number"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  className="w-24 text-center text-2xl font-bold rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] focus-visible:ring-[#006d5a] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <p className="mt-1 text-[10px] text-[#a39e97]">{editItem?.unit} · mín: {editItem?.min_level}</p>
              </div>
              <button
                onClick={() => setEditQty(String((parseFloat(editQty) || 0) + 1))}
                className="flex size-10 items-center justify-center rounded-xl bg-[#faf8f5] text-[#3d2c24] ring-1 ring-[#ebe6df] active:scale-90"
              >
                <Plus className="size-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#3d2c24]">Detalle (opcional)</label>
              <Input
                value={editDetail}
                onChange={(e) => setEditDetail(e.target.value)}
                placeholder="Ej: 2 fardos + 5 sueltos"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24] hover:bg-[#faf8f5] text-xs h-9" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleSaveQty} disabled={saving} className="rounded-xl bg-[#006d5a] text-white hover:bg-[#004d3f] text-xs h-9">
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order Dialog */}
      <Dialog open={!!orderItem} onOpenChange={(open) => !open && setOrderItem(null)}>
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-[#3d2c24]">
              Solicitar pedido
            </DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              {orderItem?.name} — stock actual: {orderItem?.current_qty} {orderItem?.unit}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#3d2c24]">Cantidad a pedir *</label>
              <Input
                value={orderQty}
                onChange={(e) => setOrderQty(e.target.value)}
                placeholder={`Ej: 5 ${orderItem?.unit ?? 'unidades'}`}
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#3d2c24]">Urgencia</label>
              <div className="flex gap-2">
                {(Object.entries(BAR_ORDER_URGENCY) as [BarOrderUrgencyValue, { label: string; color: string; bg: string }][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => setOrderUrgency(key)}
                    className={cn(
                      'flex-1 rounded-xl py-2.5 text-xs font-bold transition-all active:scale-95',
                      orderUrgency === key
                        ? 'ring-2 shadow-sm'
                        : 'ring-1 ring-[#ebe6df]',
                    )}
                    style={
                      orderUrgency === key
                        ? { backgroundColor: cfg.bg, color: cfg.color, ringColor: cfg.color }
                        : {}
                    }
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#3d2c24]">Nota (opcional)</label>
              <Textarea
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                placeholder="Ej: para cubrir fin de semana"
                rows={2}
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
              />
            </div>

            {/* Supplier info */}
            {orderItem?.supplier_id && suppliers.get(orderItem.supplier_id) && (() => {
              const sup = suppliers.get(orderItem.supplier_id!)!
              return (
                <div className="flex items-center gap-2 rounded-xl bg-[#e8f5f1]/50 px-3 py-2.5 ring-1 ring-[#006d5a]/10">
                  <Truck className="size-4 text-[#006d5a] shrink-0" />
                  <span className="flex-1 text-xs font-medium text-[#3d2c24] truncate">{sup.name}</span>
                  {sup.phone && (
                    <a
                      href={`https://wa.me/${sup.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                        `Hola, soy de La Vieja Escuela. Necesitamos: ${orderItem.name} — ${orderQty || 'a definir'}${orderNote ? ` (${orderNote})` : ''}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-lg bg-[#25d366] px-2 py-1 text-[10px] font-bold text-white active:scale-95"
                    >
                      <MessageCircle className="size-3" />
                      WhatsApp
                    </a>
                  )}
                </div>
              )
            })()}
            {orderItem && !orderItem.supplier_id && (
              <p className="text-[10px] text-[#a39e97] italic">Sin proveedor vinculado — asigná uno desde Proveedores</p>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24] hover:bg-[#faf8f5] text-xs h-9" />}>
              Cancelar
            </DialogClose>
            <Button onClick={handleCreateOrder} disabled={ordering} className="rounded-xl bg-[#006d5a] text-white hover:bg-[#004d3f] text-xs h-9">
              {ordering ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Enviar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
