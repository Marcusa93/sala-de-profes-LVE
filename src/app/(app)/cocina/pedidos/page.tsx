'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import Link from 'next/link'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Send,
  Loader2,
  ShoppingCart,
  Clock,
  CheckCircle,
  XCircle,
  Package,
  MessageCircle,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  FadeIn,
  StaggerList,
  StaggerItem,
} from '@/components/ui/motion'
import {
  KITCHEN_ORDER_CATEGORIES,
  KITCHEN_ORDER_URGENCY,
} from '@/lib/constants'
import type {
  KitchenOrderCategoryValue,
  KitchenOrderUrgencyValue,
  KitchenOrderStatusValue,
} from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrderItem = {
  id: string // local temp id
  product_name: string
  quantity: string
  category: KitchenOrderCategoryValue
}

type ExistingOrder = {
  id: number
  product_name: string
  quantity: string
  category: string
  urgency: KitchenOrderUrgencyValue
  status: KitchenOrderStatusValue
  note: string | null
  created_by: string | null
  created_at: string
  profiles: { first_name: string | null; last_name: string | null } | null
}

type SupplierInfo = {
  id: string
  name: string
  phone: string | null
  category: string
}

const STATUS_CONFIG: Record<KitchenOrderStatusValue, { label: string; icon: typeof Clock; color: string; bg: string }> = {
  pending:   { label: 'Pendiente',  icon: Clock,       color: '#d4943a', bg: '#fdf6ec' },
  ordered:   { label: 'Pedido',     icon: Package,     color: '#006d5a', bg: '#e8f5f1' },
  received:  { label: 'Recibido',   icon: CheckCircle, color: '#006d5a', bg: '#e8f5f1' },
  cancelled: { label: 'Cancelado',  icon: XCircle,     color: '#ea504c', bg: '#fef2f2' },
}

// Map kitchen order categories → supplier categories
const CATEGORY_TO_SUPPLIER: Record<string, string[]> = {
  verduleria: ['verduras', 'frutas'],
  fruteria:   ['frutas', 'verduras'],
  carniceria: ['carnes'],
  fiambreria: ['lacteos', 'carnes'],
  panaderia:  ['panaderia'],
  lacteos:    ['lacteos'],
  secos:      ['condimentos', 'otros'],
  limpieza:   ['limpieza', 'otros'],
  otros:      ['otros'],
}

let itemCounter = 0

export default function PedidosCocinaPage() {
  const { profile } = useProfileContext()
  const isEncargado = isManagerOrAbove(profile?.role)
  const canCreate = ['chef', 'cocina', 'encargado'].includes(profile?.role ?? '')

  // --- New order state ---
  const [items, setItems] = useState<OrderItem[]>([])
  const [urgency, setUrgency] = useState<KitchenOrderUrgencyValue>('normal')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  // --- Existing orders ---
  const [orders, setOrders] = useState<ExistingOrder[]>([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [tab, setTab] = useState<'nuevo' | 'historial'>('nuevo')

  // --- Suppliers (encargado only) ---
  const [suppliers, setSuppliers] = useState<SupplierInfo[]>([])

  // ----- Fetch existing orders + suppliers -----
  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_orders' }),
      })
      const data = await res.json()
      if (data.success) setOrders(data.orders ?? [])
    } catch {
      // silent
    } finally {
      setLoadingOrders(false)
    }
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // Fetch suppliers for encargado
  useEffect(() => {
    if (!isEncargado) return
    const supabase = createClient()
    supabase
      .from('suppliers')
      .select('id, name, phone, category')
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) setSuppliers(data as SupplierInfo[])
      })
  }, [isEncargado])

  // ----- Find matching suppliers for a category -----
  const findSuppliers = useCallback(
    (orderCategory: string): SupplierInfo[] => {
      const supplierCats = CATEGORY_TO_SUPPLIER[orderCategory] || ['otros']
      return suppliers.filter((s) => supplierCats.includes(s.category))
    },
    [suppliers],
  )

  // ----- Group pending orders for WhatsApp bulk message -----
  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === 'pending'),
    [orders],
  )

  const buildWhatsAppUrl = useCallback(
    (supplier: SupplierInfo, orderList: ExistingOrder[]) => {
      const lines = orderList.map((o) => `• ${o.product_name} — ${o.quantity}`)
      const noteLines = orderList
        .filter((o) => o.note)
        .map((o) => o.note)
        .filter((v, i, a) => a.indexOf(v) === i) // unique notes
      const text = [
        `Hola ${supplier.contact_name || supplier.name}, soy de La Vieja Escuela.`,
        `Necesitamos:`,
        ...lines,
        ...(noteLines.length > 0 ? [`\nNota: ${noteLines.join(', ')}`] : []),
      ].join('\n')

      const phone = supplier.phone?.replace(/\D/g, '') || ''
      return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    },
    [],
  )

  // ----- Add item to list -----
  const addItem = () => {
    itemCounter++
    setItems((prev) => [
      ...prev,
      { id: `new-${itemCounter}`, product_name: '', quantity: '', category: 'verduleria' },
    ])
  }

  const updateItem = (id: string, field: keyof OrderItem, value: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    )
  }

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  // ----- Send order -----
  const sendOrder = async () => {
    const validItems = items.filter((i) => i.product_name.trim() && i.quantity.trim())
    if (validItems.length === 0) {
      toast.error('Agregá al menos un producto con cantidad')
      return
    }

    setSending(true)
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_order',
          items: validItems.map((i) => ({
            product_name: i.product_name.trim(),
            quantity: i.quantity.trim(),
            category: i.category,
          })),
          urgency,
          note: note.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      toast.success(`Pedido enviado — ${validItems.length} producto${validItems.length > 1 ? 's' : ''}`)
      setItems([])
      setNote('')
      setUrgency('normal')
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar')
    } finally {
      setSending(false)
    }
  }

  // ----- Update order status (encargado) -----
  const updateOrderStatus = async (orderId: number, status: KitchenOrderStatusValue) => {
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_status', orderId, status }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success('Estado actualizado')
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    }
  }

  // Mark multiple as ordered
  const markAllOrdered = async (orderIds: number[]) => {
    for (const id of orderIds) {
      await updateOrderStatus(id, 'ordered')
    }
  }

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-[#e8e0d8]">
        <div className="max-w-lg mx-auto flex items-center gap-3 px-4 py-3">
          <Link href="/cocina" className="size-10 -ml-2 rounded-xl hover:bg-[#f3efe9] transition-colors flex items-center justify-center">
            <ArrowLeft size={20} className="text-[#5a4a3a]" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-[#2a2420]">Pedidos de Cocina</h1>
            <p className="text-xs text-[#8a7a6a]">Mercadería, verdulería y más</p>
          </div>
          <ShoppingCart size={20} className="ml-auto text-[#006d5a]" />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 pb-32">
        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('nuevo')}
            className={cn(
              'flex-1 h-12 rounded-xl text-sm font-medium transition-all',
              tab === 'nuevo'
                ? 'bg-[#006d5a] text-white shadow-sm'
                : 'bg-white text-[#5a4a3a] border border-[#e8e0d8]',
            )}
          >
            Nuevo Pedido
          </button>
          <button
            onClick={() => setTab('historial')}
            className={cn(
              'flex-1 h-12 rounded-xl text-sm font-medium transition-all relative',
              tab === 'historial'
                ? 'bg-[#006d5a] text-white shadow-sm'
                : 'bg-white text-[#5a4a3a] border border-[#e8e0d8]',
            )}
          >
            Historial
            {pendingOrders.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-[#ea504c] text-white text-[10px] font-bold rounded-full size-5 flex items-center justify-center">
                {pendingOrders.length}
              </span>
            )}
          </button>
        </div>

        {/* ==================== NEW ORDER TAB ==================== */}
        {tab === 'nuevo' && canCreate && (
          <FadeIn>
            {/* Urgency selector */}
            <div className="mb-4">
              <label className="text-xs font-medium text-[#5a4a3a] mb-2 block">Urgencia</label>
              <div className="flex gap-2">
                {(Object.entries(KITCHEN_ORDER_URGENCY) as [KitchenOrderUrgencyValue, { label: string; color: string; bg: string }][]).map(
                  ([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => setUrgency(key)}
                      className={cn(
                        'flex-1 py-2 rounded-xl text-sm font-medium transition-all border',
                        urgency === key
                          ? 'shadow-sm'
                          : 'border-[#e8e0d8] bg-white text-[#5a4a3a]',
                      )}
                      style={
                        urgency === key
                          ? { backgroundColor: cfg.bg, color: cfg.color, borderColor: cfg.color }
                          : undefined
                      }
                    >
                      {cfg.label}
                    </button>
                  ),
                )}
              </div>
            </div>

            {/* Items list */}
            <div className="space-y-3 mb-4">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl border border-[#e8e0d8] p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[#8a7a6a] w-5">{idx + 1}.</span>
                    <Input
                      placeholder="Producto (ej: Menta, Limón...)"
                      value={item.product_name}
                      onChange={(e) => updateItem(item.id, 'product_name', e.target.value)}
                      className="flex-1 h-10 border border-[#e8e0d8] rounded-lg text-sm"
                    />
                    <button
                      onClick={() => removeItem(item.id)}
                      className="size-10 flex items-center justify-center rounded-lg hover:bg-red-50 text-[#ea504c] transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 ml-7">
                    <Input
                      placeholder="Cantidad (ej: 2 atados, 1 bolsa...)"
                      value={item.quantity}
                      onChange={(e) => updateItem(item.id, 'quantity', e.target.value)}
                      className="flex-1 h-10 border border-[#e8e0d8] rounded-lg text-sm"
                    />
                    <select
                      value={item.category}
                      onChange={(e) =>
                        updateItem(item.id, 'category', e.target.value)
                      }
                      className="text-xs border border-[#e8e0d8] rounded-lg px-2 py-2 bg-white text-[#5a4a3a]"
                    >
                      {Object.entries(KITCHEN_ORDER_CATEGORIES).map(([key, cfg]) => (
                        <option key={key} value={key}>
                          {cfg.icon} {cfg.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            {/* Add item button */}
            <button
              onClick={addItem}
              className="w-full py-3 min-h-[48px] rounded-2xl border-2 border-dashed border-[#d4cdc4] text-[#8a7a6a] text-sm font-medium hover:border-[#006d5a] hover:text-[#006d5a] transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              Agregar producto
            </button>

            {/* Note */}
            {items.length > 0 && (
              <div className="mt-4">
                <Textarea
                  placeholder="Nota adicional (opcional, ej: FRESCOS, para el sábado...)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="border-[#e8e0d8] text-sm resize-none"
                  rows={2}
                />
              </div>
            )}

            {/* Send button */}
            {items.length > 0 && (
              <Button
                onClick={sendOrder}
                disabled={sending}
                className="w-full mt-4 bg-[#006d5a] hover:bg-[#005a4a] text-white rounded-2xl py-6 text-base font-semibold shadow-lg"
              >
                {sending ? (
                  <Loader2 size={20} className="animate-spin mr-2" />
                ) : (
                  <Send size={18} className="mr-2" />
                )}
                Enviar pedido ({items.filter((i) => i.product_name.trim()).length} producto
                {items.filter((i) => i.product_name.trim()).length !== 1 ? 's' : ''})
              </Button>
            )}

            {/* Empty state */}
            {items.length === 0 && (
              <div className="text-center py-12 text-[#8a7a6a]">
                <ShoppingCart size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No hay productos en el pedido</p>
                <p className="text-xs mt-1">Tocá &quot;Agregar producto&quot; para empezar</p>
              </div>
            )}
          </FadeIn>
        )}

        {/* ==================== HISTORY TAB ==================== */}
        {tab === 'historial' && (
          <FadeIn>
            {loadingOrders ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-[#006d5a]" />
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-12 text-[#8a7a6a]">
                <Package size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No hay pedidos aún</p>
              </div>
            ) : (
              <>
                {/* ===== Supplier quick-order cards (encargado only, pending orders) ===== */}
                {isEncargado && pendingOrders.length > 0 && (
                  <div className="mb-4 space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97] px-1">
                      Pedir a proveedores
                    </p>
                    {(() => {
                      // Group pending orders by matching supplier
                      const supplierGroups = new Map<string, { supplier: SupplierInfo; orders: ExistingOrder[] }>()
                      const unmatched: ExistingOrder[] = []

                      for (const order of pendingOrders) {
                        const matches = findSuppliers(order.category)
                        if (matches.length > 0) {
                          for (const sup of matches) {
                            const existing = supplierGroups.get(sup.id)
                            if (existing) {
                              if (!existing.orders.find((o) => o.id === order.id)) {
                                existing.orders.push(order)
                              }
                            } else {
                              supplierGroups.set(sup.id, { supplier: sup, orders: [order] })
                            }
                          }
                        } else {
                          unmatched.push(order)
                        }
                      }

                      return (
                        <>
                          {Array.from(supplierGroups.values()).map(({ supplier, orders: supOrders }) => (
                            <div
                              key={supplier.id}
                              className="bg-white rounded-2xl border border-[#e8e0d8] p-3"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Truck size={14} className="text-[#006d5a] shrink-0" />
                                <span className="text-sm font-medium text-[#2a2420] flex-1 truncate">
                                  {supplier.name}
                                </span>
                                <span className="text-[10px] text-[#a39e97]">
                                  {supOrders.length} item{supOrders.length > 1 ? 's' : ''}
                                </span>
                              </div>
                              <div className="ml-5 mb-2 space-y-0.5">
                                {supOrders.map((o) => (
                                  <p key={o.id} className="text-xs text-[#5a4a3a]">
                                    • {o.product_name} — {o.quantity}
                                  </p>
                                ))}
                              </div>
                              <div className="flex items-center gap-2 ml-5">
                                {supplier.phone ? (
                                  <a
                                    href={buildWhatsAppUrl(supplier, supOrders)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => markAllOrdered(supOrders.map((o) => o.id))}
                                    className="flex items-center gap-1.5 rounded-xl bg-[#25d366] px-3 py-1.5 text-xs font-bold text-white active:scale-95 transition-transform"
                                  >
                                    <MessageCircle size={14} />
                                    Pedir por WhatsApp
                                  </a>
                                ) : (
                                  <span className="text-[10px] text-[#a39e97] italic">
                                    Sin teléfono — agregalo en Proveedores
                                  </span>
                                )}
                                <button
                                  onClick={() => markAllOrdered(supOrders.map((o) => o.id))}
                                  className="text-[10px] font-medium px-2 py-1.5 rounded-lg bg-[#e8f5f1] text-[#006d5a] hover:bg-[#d0ebe5] transition-colors"
                                >
                                  Marcar pedido ✓
                                </button>
                              </div>
                            </div>
                          ))}
                          {unmatched.length > 0 && (
                            <div className="bg-white rounded-2xl border border-[#e8e0d8] p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Package size={14} className="text-[#d4943a] shrink-0" />
                                <span className="text-sm font-medium text-[#2a2420]">
                                  Sin proveedor asignado
                                </span>
                              </div>
                              <div className="ml-5 space-y-0.5">
                                {unmatched.map((o) => (
                                  <p key={o.id} className="text-xs text-[#5a4a3a]">
                                    • {o.product_name} — {o.quantity}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}

                {/* ===== All orders list ===== */}
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97] px-1 mb-2">
                  Todos los pedidos
                </p>
                <StaggerList className="space-y-3">
                  {orders.map((order) => {
                    const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending
                    const StatusIcon = statusCfg.icon
                    const urgCfg = KITCHEN_ORDER_URGENCY[order.urgency] || KITCHEN_ORDER_URGENCY.normal
                    const catCfg = KITCHEN_ORDER_CATEGORIES[order.category as KitchenOrderCategoryValue]
                    const matchedSuppliers = isEncargado ? findSuppliers(order.category) : []

                    return (
                      <StaggerItem key={order.id}>
                        <div className="bg-white rounded-2xl border border-[#e8e0d8] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                {catCfg && <span className="text-base">{catCfg.icon}</span>}
                                <span className="font-medium text-sm text-[#2a2420] truncate">
                                  {order.product_name}
                                </span>
                              </div>
                              <p className="text-sm text-[#5a4a3a] ml-7">{order.quantity}</p>
                              {order.note && (
                                <p className="text-xs text-[#8a7a6a] ml-7 mt-1 italic">{order.note}</p>
                              )}
                              <div className="flex items-center gap-2 mt-2 ml-7 flex-wrap">
                                <span
                                  className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}
                                >
                                  <StatusIcon size={10} className="inline mr-0.5 -mt-px" />
                                  {statusCfg.label}
                                </span>
                                {order.urgency !== 'normal' && (
                                  <span
                                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                                    style={{ backgroundColor: urgCfg.bg, color: urgCfg.color }}
                                  >
                                    {urgCfg.label}
                                  </span>
                                )}
                                <span className="text-[10px] text-[#a39e97]">
                                  {new Date(order.created_at).toLocaleDateString('es-AR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              {order.profiles && (
                                <p className="text-[10px] text-[#a39e97] ml-7 mt-1">
                                  por {order.profiles.first_name} {order.profiles.last_name}
                                </p>
                              )}
                              {/* Supplier match for individual item */}
                              {isEncargado && order.status === 'pending' && matchedSuppliers.length > 0 && (
                                <div className="ml-7 mt-2 flex items-center gap-1.5 flex-wrap">
                                  {matchedSuppliers.filter((s) => s.phone).map((sup) => (
                                    <a
                                      key={sup.id}
                                      href={buildWhatsAppUrl(sup, [order])}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 rounded-lg bg-[#25d366] px-2 py-1 text-[10px] font-bold text-white active:scale-95 transition-transform"
                                    >
                                      <MessageCircle size={10} />
                                      {sup.name}
                                    </a>
                                  ))}
                                  {matchedSuppliers.every((s) => !s.phone) && (
                                    <span className="text-[10px] text-[#a39e97] italic flex items-center gap-1">
                                      <Truck size={10} />
                                      {matchedSuppliers[0].name} (sin tel.)
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Encargado actions */}
                            {isEncargado && order.status === 'pending' && (
                              <div className="flex flex-col gap-1 shrink-0">
                                <button
                                  onClick={() => updateOrderStatus(order.id, 'ordered')}
                                  className="text-[10px] font-medium px-2 py-1 rounded-lg bg-[#e8f5f1] text-[#006d5a] hover:bg-[#d0ebe5] transition-colors"
                                >
                                  Pedido ✓
                                </button>
                                <button
                                  onClick={() => updateOrderStatus(order.id, 'cancelled')}
                                  className="text-[10px] font-medium px-2 py-1 rounded-lg bg-[#fef2f2] text-[#ea504c] hover:bg-[#fde5e5] transition-colors"
                                >
                                  Cancelar
                                </button>
                              </div>
                            )}
                            {isEncargado && order.status === 'ordered' && (
                              <button
                                onClick={() => updateOrderStatus(order.id, 'received')}
                                className="text-[10px] font-medium px-2 py-1 rounded-lg bg-[#e8f5f1] text-[#006d5a] hover:bg-[#d0ebe5] transition-colors shrink-0"
                              >
                                Recibido ✓
                              </button>
                            )}
                          </div>
                        </div>
                      </StaggerItem>
                    )
                  })}
                </StaggerList>
              </>
            )}
          </FadeIn>
        )}
      </div>
    </div>
  )
}
