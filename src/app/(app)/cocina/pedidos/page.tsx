'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import { createClient } from '@/lib/supabase/client'
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
  ChevronDown,
  ChevronUp,
  Truck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { cn } from '@/lib/utils'
import {
  FadeIn,
  StaggerList,
  StaggerItem,
  AnimatedNumber,
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

type CartItem = {
  id: string
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

const STATUS_CONFIG: Record<
  KitchenOrderStatusValue,
  { label: string; icon: typeof Clock; color: string; bg: string }
> = {
  pending: { label: 'Pendiente', icon: Clock, color: '#d4943a', bg: '#fdf6ec' },
  ordered: { label: 'Pedido', icon: Truck, color: '#006d5a', bg: '#e8f5f1' },
  received: { label: 'Recibido', icon: CheckCircle, color: '#006d5a', bg: '#e8f5f1' },
  cancelled: { label: 'Cancelado', icon: XCircle, color: '#ea504c', bg: '#fef2f2' },
}

let itemCounter = 0

export default function PedidosCocinaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const isEncargado = isManagerOrAbove(profile?.role)
  const canCreate = ['chef', 'cocina', 'encargado', 'socio'].includes(profile?.role ?? '')

  // --- Stock item suggestions (autocomplete) ---
  const [stockItemNames, setStockItemNames] = useState<string[]>([])
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)
  const suggestionsRef = useRef<HTMLDivElement | null>(null)

  // --- Existing orders ---
  const [orders, setOrders] = useState<ExistingOrder[]>([])
  const [loadingOrders, setLoadingOrders] = useState(true)

  // --- New order (expandable section) ---
  const [cartOpen, setCartOpen] = useState(false)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [cartUrgency, setCartUrgency] = useState<KitchenOrderUrgencyValue>('normal')
  const [cartNote, setCartNote] = useState('')
  const [sending, setSending] = useState(false)

  // --- Collapsible sections ---
  const [showHistory, setShowHistory] = useState(false)

  // ----- Fetch stock item names for autocomplete -----
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('stock_items')
      .select('name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setStockItemNames(data.map((i) => i.name))
      })
  }, [])

  // ----- Fetch existing orders -----
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

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // ----- Derived data -----
  const receivedOrders = useMemo(
    () => orders.filter((o) => o.status === 'received'),
    [orders],
  )
  const activeOrders = useMemo(
    () => orders.filter((o) => o.status === 'pending' || o.status === 'ordered'),
    [orders],
  )
  const historyOrders = useMemo(
    () => orders.filter((o) => o.status === 'cancelled' || o.status === 'received'),
    [orders],
  )
  const pendingCount = useMemo(
    () => orders.filter((o) => o.status === 'pending').length,
    [orders],
  )
  const orderedCount = useMemo(
    () => orders.filter((o) => o.status === 'ordered').length,
    [orders],
  )

  // ----- Cart operations -----
  const addCartItem = () => {
    itemCounter++
    setCartItems((prev) => [
      ...prev,
      {
        id: `new-${itemCounter}`,
        product_name: '',
        quantity: '',
        category: 'verduleria',
      },
    ])
  }

  const updateCartItem = (id: string, field: keyof CartItem, value: string) => {
    setCartItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    )
  }

  const removeCartItem = (id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id))
  }

  // ----- Send order -----
  const sendOrder = async () => {
    const validItems = cartItems.filter(
      (i) => i.product_name.trim() && i.quantity.trim(),
    )
    if (validItems.length === 0) {
      toast.error('Agrega al menos un producto con cantidad')
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
          urgency: cartUrgency,
          note: cartNote.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      toast.success(
        `Pedido enviado — ${validItems.length} producto${validItems.length > 1 ? 's' : ''}`,
      )
      setCartItems([])
      setCartNote('')
      setCartUrgency('normal')
      setCartOpen(false)
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar')
    } finally {
      setSending(false)
    }
  }

  // ----- Update order status (encargado/socio) -----
  const updateOrderStatus = async (
    orderId: number,
    status: KitchenOrderStatusValue,
  ) => {
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_status', orderId, status }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      const labels: Record<string, string> = {
        ordered: 'Marcado como pedido',
        received: 'Marcado como recibido',
        cancelled: 'Pedido cancelado',
      }
      toast.success(labels[status] ?? 'Estado actualizado')
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    }
  }

  // ----- Loading state -----
  if (profileLoading || loadingOrders) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[#006d5a]" />
      </div>
    )
  }

  // ----- Access check -----
  if (
    profile &&
    !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)
  ) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-4">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/cocina"
            className="rounded-lg p-1.5 text-[#a39e97] active:scale-90"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">
            Pedidos de Cocina
          </h1>
        </div>
        <div className="card-elevated rounded-2xl p-6 text-center">
          <Package className="mx-auto size-10 text-[#a39e97]" />
          <p className="mt-4 text-sm font-medium text-[#3d2c24]">
            Acceso restringido
          </p>
          <p className="mt-1 text-xs text-[#a39e97]">
            Esta seccion es solo para cocina, chef y encargados.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg pb-28">
      {/* ================================================================ */}
      {/* HEADER                                                          */}
      {/* ================================================================ */}
      <FadeIn className="flex items-center gap-3 pt-2 pb-4">
        <Link
          href="/cocina"
          className="rounded-lg p-2 text-[#a39e97] active:scale-90 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">
            Cocina — Pedidos
          </h1>
          <p className="section-label mt-0.5">
            Mercaderia, verduleria y mas
          </p>
        </div>
        {activeOrders.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-[#fdf6ec] px-3 py-1.5 text-[11px] font-bold text-[#d4943a]">
            <ShoppingCart className="size-3" />
            {activeOrders.length}
          </div>
        )}
      </FadeIn>

      {/* ================================================================ */}
      {/* KPI ROW                                                         */}
      {/* ================================================================ */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          <div className="rounded-xl bg-[#fdf6ec] p-3 text-center">
            <p className="font-display text-xl font-bold tabular-nums text-[#d4943a]">
              <AnimatedNumber value={pendingCount} />
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">
              Pendientes
            </p>
          </div>
          <div className="rounded-xl bg-[#e8f5f1] p-3 text-center">
            <p className="font-display text-xl font-bold tabular-nums text-[#006d5a]">
              <AnimatedNumber value={orderedCount} />
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">
              Pedidos
            </p>
          </div>
          <div className="rounded-xl bg-[#f0f7f5] p-3 text-center">
            <p className="font-display text-xl font-bold tabular-nums text-[#006d5a]">
              <AnimatedNumber value={receivedOrders.length} />
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">
              Recibidos
            </p>
          </div>
        </div>
      </FadeIn>

      {/* ================================================================ */}
      {/* SECTION 1: RECIBIDOS                                            */}
      {/* ================================================================ */}
      {receivedOrders.length > 0 && (
        <FadeIn delay={0.08} className="mb-5">
          <div className="flex items-center gap-2 px-1 mb-2 min-h-[44px]">
            <Package className="size-4 text-[#006d5a]" />
            <span className="section-label text-[#006d5a]">
              Recibidos ({receivedOrders.length})
            </span>
          </div>

          <div className="space-y-1.5">
            {receivedOrders.slice(0, 20).map((order) => {
              const catCfg =
                KITCHEN_ORDER_CATEGORIES[
                  order.category as KitchenOrderCategoryValue
                ]
              return (
                <div
                  key={order.id}
                  className="flex items-center gap-3 rounded-xl bg-[#f0f7f5] px-3.5 py-3 ring-1 ring-[#006d5a]/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {catCfg && (
                        <span className="text-base">{catCfg.icon}</span>
                      )}
                      <p className="text-sm font-medium text-[#3d2c24] truncate">
                        {order.product_name}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[10px] text-[#a39e97] ml-6">
                      Cantidad: {order.quantity}
                      {order.note && (
                        <span className="italic"> &middot; {order.note}</span>
                      )}
                    </p>
                    <p className="text-[10px] text-[#006d5a] font-medium ml-6 mt-0.5">
                      Revisa y actualiza stock
                    </p>
                  </div>
                  <Link
                    href="/stock"
                    className="flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-xs font-bold text-white transition-all active:scale-95 min-h-[44px]"
                  >
                    <Plus className="size-3.5" />
                    Stock
                  </Link>
                </div>
              )
            })}
          </div>
        </FadeIn>
      )}

      {/* ================================================================ */}
      {/* SECTION 2: PEDIDOS ACTIVOS                                      */}
      {/* ================================================================ */}
      {activeOrders.length > 0 && (
        <FadeIn delay={0.1} className="mb-5">
          <div className="flex items-center gap-2 px-1 mb-2 min-h-[44px]">
            <ShoppingCart className="size-4 text-[#d4943a]" />
            <span className="section-label text-[#d4943a]">
              Pedidos activos ({activeOrders.length})
            </span>
          </div>

          <StaggerList className="space-y-1.5" staggerDelay={0.03}>
            {activeOrders.map((order) => {
              const statusCfg =
                STATUS_CONFIG[order.status] || STATUS_CONFIG.pending
              const StatusIcon = statusCfg.icon
              const urgCfg =
                KITCHEN_ORDER_URGENCY[order.urgency] ||
                KITCHEN_ORDER_URGENCY.normal
              const catCfg =
                KITCHEN_ORDER_CATEGORIES[
                  order.category as KitchenOrderCategoryValue
                ]
              const isOrdered = order.status === 'ordered'

              return (
                <StaggerItem key={order.id}>
                  <div
                    className={cn(
                      'rounded-xl px-3.5 py-3 ring-1 ring-[#ebe6df]/50',
                      isOrdered ? 'bg-[#f0f7f5]' : 'bg-white',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {catCfg && (
                            <span className="text-base">{catCfg.icon}</span>
                          )}
                          <p className="text-sm font-medium text-[#3d2c24] truncate">
                            {order.product_name}
                          </p>
                        </div>
                        <p className="text-sm text-[#5a4a3a] ml-6">
                          {order.quantity}
                        </p>
                        {order.note && (
                          <p className="text-xs text-[#8a7a6a] ml-6 mt-0.5 italic">
                            {order.note}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1.5 ml-6 flex-wrap">
                          {/* Status badge */}
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{
                              backgroundColor: statusCfg.bg,
                              color: statusCfg.color,
                            }}
                          >
                            <StatusIcon
                              size={10}
                              className="inline mr-0.5 -mt-px"
                            />
                            {statusCfg.label}
                          </span>
                          {/* Urgency badge */}
                          {order.urgency !== 'normal' && (
                            <span
                              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                              style={{
                                backgroundColor: urgCfg.bg,
                                color: urgCfg.color,
                              }}
                            >
                              {urgCfg.label}
                            </span>
                          )}
                          {/* Timestamp */}
                          <span className="text-[10px] text-[#a39e97]">
                            {new Date(order.created_at).toLocaleDateString(
                              'es-AR',
                              {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                            )}
                          </span>
                        </div>
                        {order.profiles && (
                          <p className="text-[10px] text-[#a39e97] ml-6 mt-0.5">
                            por {order.profiles.first_name}{' '}
                            {order.profiles.last_name}
                          </p>
                        )}
                      </div>

                      {/* Encargado/Socio actions */}
                      {isEncargado && (
                        <div className="flex gap-1 shrink-0">
                          {!isOrdered && (
                            <button
                              onClick={() =>
                                updateOrderStatus(order.id, 'ordered')
                              }
                              className="flex size-[44px] shrink-0 items-center justify-center rounded-xl bg-[#d4943a] text-white active:scale-90"
                              title="Marcar como pedido"
                            >
                              <Truck className="size-4" />
                            </button>
                          )}
                          <button
                            onClick={() =>
                              updateOrderStatus(order.id, 'received')
                            }
                            className="flex size-[44px] shrink-0 items-center justify-center rounded-xl bg-[#006d5a] text-white active:scale-90"
                            title="Recibido"
                          >
                            <CheckCircle className="size-4" />
                          </button>
                          <button
                            onClick={() =>
                              updateOrderStatus(order.id, 'cancelled')
                            }
                            className="flex size-[44px] shrink-0 items-center justify-center rounded-xl bg-[#fef2f2] text-[#ea504c] active:scale-90"
                            title="Cancelar"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </StaggerItem>
              )
            })}
          </StaggerList>
        </FadeIn>
      )}

      {/* Empty state when no active/received */}
      {activeOrders.length === 0 && receivedOrders.length === 0 && (
        <FadeIn delay={0.1} className="mb-5">
          <div className="text-center py-12 text-[#8a7a6a]">
            <Package size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No hay pedidos activos</p>
            <p className="text-xs mt-1">
              Usa &quot;Nuevo Pedido&quot; para crear uno
            </p>
          </div>
        </FadeIn>
      )}

      {/* ================================================================ */}
      {/* SECTION 3: NUEVO PEDIDO (expandable)                            */}
      {/* ================================================================ */}
      {canCreate && (
        <FadeIn delay={0.12} className="mb-5">
          <button
            onClick={() => {
              setCartOpen(!cartOpen)
              if (!cartOpen && cartItems.length === 0) addCartItem()
            }}
            className="flex w-full items-center justify-between rounded-xl bg-[#006d5a] px-4 py-3 text-white transition-all active:scale-[0.99] min-h-[44px]"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart className="size-4" />
              <span className="text-sm font-bold">Nuevo Pedido</span>
              {cartItems.length > 0 && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">
                  {cartItems.filter((i) => i.product_name.trim()).length} item
                  {cartItems.filter((i) => i.product_name.trim()).length !== 1
                    ? 's'
                    : ''}
                </span>
              )}
            </div>
            {cartOpen ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>

          {cartOpen && (
            <div className="mt-2 rounded-2xl bg-white ring-1 ring-[#ebe6df] p-4 space-y-4">
              {/* Urgency selector */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97] mb-2 block">
                  Urgencia
                </label>
                <div className="flex gap-2">
                  {(
                    Object.entries(KITCHEN_ORDER_URGENCY) as [
                      KitchenOrderUrgencyValue,
                      { label: string; color: string; bg: string },
                    ][]
                  ).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => setCartUrgency(key)}
                      className={cn(
                        'flex-1 py-2.5 rounded-xl text-sm font-medium transition-all border min-h-[44px]',
                        cartUrgency === key
                          ? 'shadow-sm'
                          : 'border-[#e8e0d8] bg-white text-[#5a4a3a]',
                      )}
                      style={
                        cartUrgency === key
                          ? {
                              backgroundColor: cfg.bg,
                              color: cfg.color,
                              borderColor: cfg.color,
                            }
                          : undefined
                      }
                    >
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cart items */}
              <div className="space-y-2.5">
                {cartItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="bg-[#faf8f5] rounded-xl p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#a39e97] w-5">
                        {idx + 1}.
                      </span>
                      <div className="relative flex-1">
                        <Input
                          placeholder="Producto (ej: Menta, Limon...)"
                          value={item.product_name}
                          onChange={(e) =>
                            updateCartItem(
                              item.id,
                              'product_name',
                              e.target.value,
                            )
                          }
                          onFocus={() => setFocusedItemId(item.id)}
                          onBlur={() => {
                            // Delay to allow click on suggestion
                            setTimeout(() => setFocusedItemId((prev) => prev === item.id ? null : prev), 150)
                          }}
                          autoComplete="off"
                          className="w-full h-11 border border-[#e8e0d8] rounded-lg text-sm"
                        />
                        {/* Autocomplete suggestions */}
                        {focusedItemId === item.id && item.product_name.trim().length >= 1 && (() => {
                          const q = item.product_name.trim().toLowerCase()
                          const matches = stockItemNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 6)
                          if (matches.length === 0 || (matches.length === 1 && matches[0].toLowerCase() === q)) return null
                          return (
                            <div
                              ref={suggestionsRef}
                              className="absolute z-20 top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg ring-1 ring-[#ebe6df] max-h-44 overflow-y-auto"
                            >
                              {matches.map((name) => (
                                <button
                                  key={name}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    updateCartItem(item.id, 'product_name', name)
                                    setFocusedItemId(null)
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-sm text-[#3d2c24] hover:bg-[#f0f7f5] transition-colors min-h-[44px] flex items-center"
                                >
                                  {name}
                                </button>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                      <button
                        onClick={() => removeCartItem(item.id)}
                        className="size-[44px] flex items-center justify-center rounded-lg hover:bg-red-50 text-[#ea504c] transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 ml-7">
                      <Input
                        placeholder="Cantidad (ej: 2 atados, 1 bolsa...)"
                        value={item.quantity}
                        onChange={(e) =>
                          updateCartItem(item.id, 'quantity', e.target.value)
                        }
                        className="flex-1 h-11 border border-[#e8e0d8] rounded-lg text-sm"
                      />
                      <select
                        value={item.category}
                        onChange={(e) =>
                          updateCartItem(item.id, 'category', e.target.value)
                        }
                        className="text-xs border border-[#e8e0d8] rounded-lg px-2 py-2.5 bg-white text-[#5a4a3a] min-h-[44px]"
                      >
                        {Object.entries(KITCHEN_ORDER_CATEGORIES).map(
                          ([key, cfg]) => (
                            <option key={key} value={key}>
                              {cfg.icon} {cfg.label}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add item button */}
              <button
                onClick={addCartItem}
                className="w-full py-3 min-h-[48px] rounded-xl border-2 border-dashed border-[#d4cdc4] text-[#8a7a6a] text-sm font-medium hover:border-[#006d5a] hover:text-[#006d5a] transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={18} />
                Agregar producto
              </button>

              {/* Note */}
              <Textarea
                placeholder="Nota adicional (opcional, ej: FRESCOS, para el sabado...)"
                value={cartNote}
                onChange={(e) => setCartNote(e.target.value)}
                className="border-[#e8e0d8] text-sm resize-none"
                rows={2}
              />

              {/* Send button */}
              <Button
                onClick={sendOrder}
                disabled={
                  sending ||
                  cartItems.filter(
                    (i) => i.product_name.trim() && i.quantity.trim(),
                  ).length === 0
                }
                className="w-full bg-[#006d5a] hover:bg-[#005a4a] text-white rounded-xl py-6 text-base font-semibold shadow-lg min-h-[48px]"
              >
                {sending ? (
                  <Loader2 size={20} className="animate-spin mr-2" />
                ) : (
                  <Send size={18} className="mr-2" />
                )}
                Enviar pedido (
                {
                  cartItems.filter(
                    (i) => i.product_name.trim() && i.quantity.trim(),
                  ).length
                }{' '}
                producto
                {cartItems.filter(
                  (i) => i.product_name.trim() && i.quantity.trim(),
                ).length !== 1
                  ? 's'
                  : ''}
                )
              </Button>
            </div>
          )}
        </FadeIn>
      )}

      {/* ================================================================ */}
      {/* SECTION 4: HISTORIAL (collapsible)                              */}
      {/* ================================================================ */}
      {historyOrders.length > 0 && (
        <FadeIn delay={0.14} className="mb-5">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex w-full items-center justify-between rounded-xl bg-white px-4 py-3 ring-1 ring-[#ebe6df] transition-all active:scale-[0.99] min-h-[44px]"
          >
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-[#a39e97]" />
              <span className="text-sm font-medium text-[#3d2c24]">
                Historial
              </span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                {historyOrders.length}
              </span>
            </div>
            {showHistory ? (
              <ChevronUp className="size-4 text-[#a39e97]" />
            ) : (
              <ChevronDown className="size-4 text-[#a39e97]" />
            )}
          </button>

          {showHistory && (
            <div className="mt-2 space-y-1.5">
              {historyOrders.map((order) => {
                const isReceived = order.status === 'received'
                const urgCfg =
                  KITCHEN_ORDER_URGENCY[order.urgency] ||
                  KITCHEN_ORDER_URGENCY.normal
                const catCfg =
                  KITCHEN_ORDER_CATEGORIES[
                    order.category as KitchenOrderCategoryValue
                  ]
                const date = new Date(order.created_at)
                const dateStr = date.toLocaleDateString('es-AR', {
                  day: 'numeric',
                  month: 'short',
                })
                const timeStr = date.toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })

                return (
                  <div
                    key={order.id}
                    className={cn(
                      'rounded-xl px-3.5 py-2.5 ring-1 ring-[#ebe6df]/50',
                      isReceived ? 'bg-[#f8faf8]' : 'bg-[#fef8f8]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#3d2c24]">
                          {catCfg && (
                            <span className="mr-1">{catCfg.icon}</span>
                          )}
                          {order.product_name}
                          <span className="ml-1.5 text-[#a39e97]">
                            &times; {order.quantity}
                          </span>
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-[#a39e97]">
                          <span>
                            {dateStr} {timeStr}
                          </span>
                          {order.urgency !== 'normal' && (
                            <span
                              className="rounded-full px-1.5 py-0.5 font-semibold"
                              style={{
                                color: urgCfg.color,
                                backgroundColor: urgCfg.bg,
                              }}
                            >
                              {urgCfg.label}
                            </span>
                          )}
                          {order.note && (
                            <span className="italic truncate max-w-[120px]">
                              {order.note}
                            </span>
                          )}
                        </div>
                        {order.profiles && (
                          <p className="text-[10px] text-[#a39e97] mt-0.5">
                            por {order.profiles.first_name}{' '}
                            {order.profiles.last_name}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold',
                          isReceived
                            ? 'bg-[#e8f5f1] text-[#006d5a]'
                            : 'bg-[#fef2f2] text-[#ea504c]',
                        )}
                      >
                        {isReceived ? 'Recibido' : 'Cancelado'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </FadeIn>
      )}
    </div>
  )
}
