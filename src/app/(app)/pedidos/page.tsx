'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ShoppingCart, Truck, Check, X, Phone, MessageCircle,
  ChevronDown, ChevronUp,
  Loader2, Package, Clock, AlertTriangle, Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { isManagerOrAbove } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { PurchaseOrderCopilot } from '@/components/ai/PurchaseOrderCopilot'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Order = {
  id: number
  product_name: string
  category: string
  quantity: string
  urgency: string
  status: string
  note: string | null
  supplier_id: number | null
  created_by: string | null
  created_at: string
  source: 'barra' | 'cocina'
  // campos de recepción
  received_qty: string | null
  unit_cost: number | null
  expires_at: string | null
  received_at: string | null
  stock_item_id: string | null
}

type StockItem = {
  id: string
  name: string
  unit: string
  current_qty: number
}

type Supplier = {
  id: number
  name: string
  phone: string | null
  contact_name: string | null
}

type Profile = {
  id: string
  first_name: string
  last_name: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripNonDigits(s: string): string {
  return s.replace(/\D/g, '')
}

const URGENCY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  normal: { label: 'Normal', color: '#006d5a', bg: '#e8f5f1' },
  alta: { label: 'Alta', color: '#d4943a', bg: '#fdf6ec' },
  urgente: { label: 'Urgente', color: '#ea504c', bg: '#fef2f2' },
  high: { label: 'Alta', color: '#d4943a', bg: '#fdf6ec' },
  critical: { label: 'Urgente', color: '#ea504c', bg: '#fef2f2' },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PedidosPage() {
  const { profile } = useProfileContext()
  const [loading, setLoading] = useState(true)
  const [barOrders, setBarOrders] = useState<Order[]>([])
  const [kitchenOrders, setKitchenOrders] = useState<Order[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  // Un paso por pantalla: pedir → en camino → recibido (el ciclo real)
  const [step, setStep] = useState<'pedir' | 'camino' | 'recibido'>('pedir')
  const [assignDialog, setAssignDialog] = useState<{ order: Order } | null>(null)
  const [receiveDialog, setReceiveDialog] = useState<{ order: Order } | null>(null)
  const [expandedSupplier, setExpandedSupplier] = useState<number | null>(null)

  const canManage = isManagerOrAbove(profile?.role)

  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const [barRes, kitchenRes, suppRes, profRes, stockRes] = await Promise.all([
      supabase.from('bar_orders').select('*').in('status', ['pending', 'ordered', 'received']).order('created_at', { ascending: false }),
      supabase.from('kitchen_orders').select('*').in('status', ['pending', 'ordered', 'received']).order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name, phone, contact_name').eq('is_active', true).order('name'),
      supabase.from('profiles').select('id, first_name, last_name').eq('is_active', true),
      supabase.from('stock_items').select('id, name, unit, current_qty').eq('is_active', true).order('name'),
    ])

    const bar = (barRes.data ?? []).map((o) => ({ ...o, source: 'barra' as const, supplier_id: (o as Record<string, unknown>).supplier_id as number | null ?? null })) as unknown as Order[]
    const kitchen = (kitchenRes.data ?? []).map((o) => ({ ...o, source: 'cocina' as const, supplier_id: (o as Record<string, unknown>).supplier_id as number | null ?? null })) as unknown as Order[]
    setBarOrders(bar)
    setKitchenOrders(kitchen)
    setSuppliers((suppRes.data ?? []) as unknown as Supplier[])
    setProfiles((profRes.data ?? []) as unknown as Profile[])
    setStockItems((stockRes.data ?? []) as unknown as StockItem[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const allOrders = useMemo(() => [...barOrders, ...kitchenOrders], [barOrders, kitchenOrders])

  // Agrupar por proveedor SOLO lo pendiente de pedir (el paso "Pedir")
  const grouped = useMemo(() => {
    const supplierMap = new Map<number, { supplier: Supplier; orders: Order[] }>()
    const noSupplier: Order[] = []

    for (const order of allOrders.filter((o) => o.status === 'pending')) {
      if (order.supplier_id) {
        const supp = suppliers.find((s) => s.id === order.supplier_id)
        if (supp) {
          const existing = supplierMap.get(supp.id)
          if (existing) existing.orders.push(order)
          else supplierMap.set(supp.id, { supplier: supp, orders: [order] })
          continue
        }
      }
      noSupplier.push(order)
    }

    const groups = Array.from(supplierMap.values()).sort((a, b) => a.supplier.name.localeCompare(b.supplier.name))
    return { groups, noSupplier }
  }, [allOrders, suppliers])

  // Get profile name
  function getProfileName(userId: string | null): string {
    if (!userId) return 'Sistema'
    const p = profiles.find((pr) => pr.id === userId)
    return p ? `${p.first_name} ${p.last_name?.[0] || ''}.` : 'Empleado'
  }

  // ---- Actions ----

  async function updateStatus(order: Order, newStatus: string) {
    // El flujo de recepción pasa por el dialog — no llegar acá con 'received'
    if (newStatus === 'received') {
      setReceiveDialog({ order })
      return
    }
    try {
      const endpoint = order.source === 'barra' ? '/api/kitchen/bar' : '/api/kitchen/orders'
      const action = order.source === 'barra' ? 'update_order_status' : 'update_status'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, orderId: order.id, status: newStatus }),
      })
      if (!res.ok) throw new Error('Error')
      toast.success(newStatus === 'ordered' ? 'Marcado como pedido' : 'Cancelado')
      fetchData()
    } catch {
      toast.error('Error al actualizar')
    }
  }

  async function assignSupplier(order: Order, supplierId: number) {
    const table = order.source === 'barra' ? 'bar_orders' : 'kitchen_orders'
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from(table) as any).update({ supplier_id: supplierId }).eq('id', order.id)
      if (error) throw error
      setAssignDialog(null)
      toast.success('Proveedor asignado')
      fetchData()
    } catch {
      toast.error('Error al asignar proveedor')
    }
  }

  // Build WhatsApp message for a supplier group
  function buildWhatsAppUrl(supplier: Supplier, orders: Order[]): string {
    const phone = supplier.phone ? stripNonDigits(supplier.phone) : ''
    if (!phone) return ''

    const itemsList = orders
      .map((o) => {
        const urgLabel = URGENCY_CONFIG[o.urgency]?.label
        const urgTag = urgLabel && o.urgency !== 'normal' ? ` ⚠️ ${urgLabel}` : ''
        return `- ${o.product_name}: ${o.quantity}${urgTag}`
      })
      .join('\n')

    const message = `Hola${supplier.contact_name ? ` ${supplier.contact_name}` : ''}, soy de *La Vieja Escuela*.\nTe escribo para hacer un pedido:\n\n${itemsList}\n\n¡Gracias!`

    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-[#006d5a]" /></div>
  }

  const pending = allOrders.filter((o) => o.status === 'pending')
  const ordered = allOrders.filter((o) => o.status === 'ordered')
  const received = allOrders.filter((o) => o.status === 'received')

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-28">
      {/* Header */}
      <FadeIn>
        <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Gestión de Pedidos</h1>
        <p className="section-label mt-0.5">Pedidos de barra y cocina</p>
      </FadeIn>

      {/* Los 3 pasos del ciclo — un paso por pantalla */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-3 gap-2">
          {([
            { key: 'pedir' as const, label: 'Pedir', count: pending.length, Icon: ShoppingCart, tone: '#d4943a' },
            { key: 'camino' as const, label: 'En camino', count: ordered.length, Icon: Truck, tone: '#4a90d9' },
            { key: 'recibido' as const, label: 'Recibidos', count: received.length, Icon: Check, tone: '#006d5a' },
          ]).map(({ key, label, count, Icon, tone }) => (
            <button
              key={key}
              onClick={() => setStep(key)}
              className={cn(
                'rounded-2xl p-3 text-center transition-all ring-1',
                step === key ? 'bg-white shadow-sm' : 'bg-[#faf8f5] ring-transparent opacity-60',
              )}
              style={step === key ? { boxShadow: `inset 0 -3px 0 ${tone}`, borderColor: tone } : undefined}
            >
              <Icon className="mx-auto size-4" style={{ color: tone }} />
              <p className="mt-1 font-display text-lg font-bold tabular-nums" style={{ color: tone }}>
                <AnimatedNumber value={count} />
              </p>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">{label}</p>
            </button>
          ))}
        </div>
      </FadeIn>

      {/* PASO 1 — PEDIR: sugerencias IA + pendientes agrupados por proveedor */}
      {step === 'pedir' && canManage && (
        <FadeIn delay={0.08}>
          <PurchaseOrderCopilot />
        </FadeIn>
      )}

      {step === 'pedir' && grouped.groups.map(({ supplier, orders }) => {
        const isExpanded = expandedSupplier === supplier.id
        const whatsappUrl = buildWhatsAppUrl(supplier, orders)

        return (
          <FadeIn key={supplier.id}>
            <div className="rounded-2xl bg-white ring-1 ring-[#ebe6df] overflow-hidden">
              {/* Supplier header */}
              <button
                onClick={() => setExpandedSupplier(isExpanded ? null : supplier.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#e8f5f1]">
                  <Package className="size-4 text-[#006d5a]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#3d2c24] truncate">{supplier.name}</p>
                  <p className="text-[11px] text-[#a39e97]">
                    {orders.length} item{orders.length > 1 ? 's' : ''} · {supplier.contact_name ?? ''}
                  </p>
                </div>
                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#25D366] text-white active:scale-90"
                    title="Enviar pedido por WhatsApp"
                  >
                    <MessageCircle className="size-4" />
                  </a>
                )}
                {isExpanded ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
              </button>

              {/* Order list */}
              {isExpanded && (
                <div className="border-t divide-y">
                  {orders.map((order) => (
                    <OrderRow
                      key={`${order.source}-${order.id}`}
                      order={order}
                      canManage={canManage}
                      getProfileName={getProfileName}
                      onUpdateStatus={updateStatus}
                    />
                  ))}
                  {/* WhatsApp CTA */}
                  {whatsappUrl && (
                    <div className="p-3 bg-[#f0faf0]">
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-2.5 text-sm font-semibold text-white active:scale-[0.98]"
                      >
                        <MessageCircle className="size-4" />
                        Enviar pedido por WhatsApp
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </FadeIn>
        )
      })}

      {/* Unassigned orders */}
      {step === 'pedir' && grouped.noSupplier.length > 0 && (
        <FadeIn>
          <div className="rounded-2xl bg-white ring-1 ring-[#ea504c]/30 overflow-hidden">
            <div className="flex items-center gap-3 bg-[#fef2f2]/50 px-4 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#fef2f2]">
                <AlertTriangle className="size-4 text-[#ea504c]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[#ea504c]">Sin proveedor asignado</p>
                <p className="text-[11px] text-[#a39e97]">Asigná un proveedor a cada item para poder enviar el pedido por WhatsApp</p>
              </div>
            </div>
            <div className="border-t divide-y">
              {grouped.noSupplier.map((order) => (
                <OrderRow
                  key={`${order.source}-${order.id}`}
                  order={order}
                  canManage={canManage}
                  getProfileName={getProfileName}
                  onUpdateStatus={updateStatus}
                  onAssignSupplier={() => setAssignDialog({ order })}
                />
              ))}
            </div>
          </div>
        </FadeIn>
      )}

      {step === 'pedir' && pending.length === 0 && (
        <FadeIn>
          <div className="flex flex-col items-center py-10 text-center">
            <ShoppingCart className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">Nada pendiente de pedir</p>
            <p className="mt-1 text-xs text-[#a39e97]/70">Lo que pida barra o cocina aparece acá, agrupado por proveedor</p>
          </div>
        </FadeIn>
      )}

      {/* PASO 2 — EN CAMINO: lo pedido, esperando que llegue */}
      {step === 'camino' && (
        ordered.length > 0 ? (
          <FadeIn>
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <div className="divide-y">
                {ordered.map((order) => (
                  <OrderRow
                    key={`${order.source}-${order.id}`}
                    order={order}
                    canManage={canManage}
                    getProfileName={getProfileName}
                    onUpdateStatus={updateStatus}
                  />
                ))}
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-[#a39e97]">
              Cuando llegue la mercadería, tocá &quot;Recibido&quot; para cargarla al stock.
            </p>
          </FadeIn>
        ) : (
          <FadeIn>
            <div className="flex flex-col items-center py-10 text-center">
              <Truck className="size-10 text-[#ebe6df]" />
              <p className="mt-4 text-sm font-medium text-[#a39e97]">Nada en camino</p>
              <p className="mt-1 text-xs text-[#a39e97]/70">Los pedidos ya enviados al proveedor aparecen acá</p>
            </div>
          </FadeIn>
        )
      )}

      {/* PASO 3 — RECIBIDOS: historial reciente */}
      {step === 'recibido' && (
        received.length > 0 ? (
          <FadeIn>
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <div className="divide-y">
                {received.slice(0, 20).map((order) => (
                  <OrderRow
                    key={`${order.source}-${order.id}`}
                    order={order}
                    canManage={canManage}
                    getProfileName={getProfileName}
                    onUpdateStatus={updateStatus}
                  />
                ))}
              </div>
            </div>
          </FadeIn>
        ) : (
          <FadeIn>
            <div className="flex flex-col items-center py-10 text-center">
              <Check className="size-10 text-[#ebe6df]" />
              <p className="mt-4 text-sm font-medium text-[#a39e97]">Sin recepciones todavía</p>
            </div>
          </FadeIn>
        )
      )}

      {/* Receive dialog */}
      {receiveDialog && (
        <ReceiveDialog
          order={receiveDialog.order}
          stockItems={stockItems}
          onClose={() => setReceiveDialog(null)}
          onDone={() => { setReceiveDialog(null); fetchData() }}
        />
      )}

      {/* Assign supplier dialog */}
      <Dialog open={!!assignDialog} onOpenChange={() => setAssignDialog(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Asignar proveedor</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-3">
            {assignDialog?.order.product_name} — {assignDialog?.order.quantity}
          </p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {suppliers.map((s) => (
              <button
                key={s.id}
                onClick={() => assignDialog && assignSupplier(assignDialog.order, s.id)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[#f8f5f0] active:scale-[0.99]"
              >
                <Package className="size-4 text-[#006d5a]" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#3d2c24] truncate">{s.name}</p>
                  {s.phone && <p className="text-[10px] text-[#a39e97]">{s.phone}</p>}
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <DialogClose className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Cancelar
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OrderRow component
// ---------------------------------------------------------------------------

function OrderRow({
  order,
  canManage,
  getProfileName,
  onUpdateStatus,
  onAssignSupplier,
}: {
  order: Order
  canManage: boolean
  getProfileName: (id: string | null) => string
  onUpdateStatus: (order: Order, status: string) => void
  onAssignSupplier?: () => void
}) {
  const urgCfg = URGENCY_CONFIG[order.urgency] ?? URGENCY_CONFIG.normal
  const isOrdered = order.status === 'ordered'
  const isReceived = order.status === 'received'
  const timeAgo = formatDistanceToNow(new Date(order.created_at), { addSuffix: true, locale: es })

  return (
    <div className={cn('px-4 py-3', isOrdered && 'bg-[#f0f7f5]/50', isReceived && 'bg-[#e8f5f1]/30 opacity-70')}>
      {/* Product info */}
      <div className="flex items-center gap-2.5">
        <div className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg text-white text-xs',
          order.source === 'barra' ? 'bg-[#8b5e34]' : 'bg-[#d4943a]',
        )}>
          {order.source === 'barra' ? '☕' : '🍳'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#3d2c24] truncate">{order.product_name}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[#a39e97]">
            <span className="font-bold text-[#3d2c24]">{order.quantity}</span>
            <span>·</span>
            <span className="rounded-full px-1.5 py-0.5 font-semibold" style={{ color: urgCfg.color, backgroundColor: urgCfg.bg }}>
              {urgCfg.label}
            </span>
            <span>·</span>
            <span>{getProfileName(order.created_by)}</span>
            <span>·</span>
            <span>{timeAgo}</span>
          </div>
        </div>
        {isOrdered && (
          <span className="shrink-0 rounded-full bg-[#eef4fc] px-2 py-0.5 text-[10px] font-bold text-[#4a90d9]">
            🚚 Pedido
          </span>
        )}
        {isReceived && (
          <span className="shrink-0 rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[10px] font-bold text-[#006d5a]">
            ✅ Recibido
          </span>
        )}
      </div>

      {order.note && (
        <p className="mt-1.5 ml-[42px] text-[11px] italic text-[#a39e97] truncate">💬 {order.note}</p>
      )}

      {/* Action buttons — labeled for clarity */}
      {canManage && !isReceived && (
        <div className="mt-2.5 ml-[42px] flex flex-wrap gap-1.5">
          {onAssignSupplier && (
            <button
              onClick={onAssignSupplier}
              className="flex items-center gap-1 rounded-lg bg-[#fdf6ec] px-2.5 py-1.5 text-[11px] font-semibold text-[#d4943a] transition-all active:scale-95"
            >
              <Package className="size-3" />
              Asignar proveedor
            </button>
          )}
          {!isOrdered && (
            <button
              onClick={() => onUpdateStatus(order, 'ordered')}
              className="flex items-center gap-1 rounded-lg bg-[#d4943a] px-2.5 py-1.5 text-[11px] font-semibold text-white transition-all active:scale-95"
            >
              <Truck className="size-3" />
              Pedido
            </button>
          )}
          <button
            onClick={() => onUpdateStatus(order, 'received')}
            className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[11px] font-semibold text-white transition-all active:scale-95"
          >
            <Check className="size-3" />
            Recibido
          </button>
          <button
            onClick={() => onUpdateStatus(order, 'cancelled')}
            className="flex items-center gap-1 rounded-lg bg-[#fef2f2] px-2.5 py-1.5 text-[11px] font-semibold text-[#ea504c] transition-all active:scale-95"
          >
            <X className="size-3" />
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReceiveDialog — corroboración y carga al stock
// ---------------------------------------------------------------------------

function ReceiveDialog({
  order,
  stockItems,
  onClose,
  onDone,
}: {
  order: Order
  stockItems: StockItem[]
  onClose: () => void
  onDone: () => void
}) {
  const [receivedQty, setReceivedQty] = useState(order.quantity)
  const [unitCost, setUnitCost] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [stockItemId, setStockItemId] = useState<string | null>(null)
  const [stockSearch, setStockSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const filteredStock = stockItems.filter((s) =>
    s.name.toLowerCase().includes(stockSearch.toLowerCase()) ||
    order.product_name.toLowerCase().split(' ').some((w) => w.length > 2 && s.name.toLowerCase().includes(w))
  ).slice(0, 8)

  async function handleConfirm() {
    if (!receivedQty.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'receive_order',
          orderId: order.id,
          source: order.source,
          receivedQty: receivedQty.trim(),
          unitCost: unitCost ? parseFloat(unitCost) : undefined,
          expiresAt: expiresAt || undefined,
          stockItemId: stockItemId ?? undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al confirmar')
      toast.success(json.stockUpdated ? '✅ Recibido y stock actualizado' : '✅ Recepción registrada')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al confirmar recepción')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedItem = stockItems.find((s) => s.id === stockItemId)

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Confirmar recepción</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl bg-[#f3efe9] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Pedido</p>
            <p className="mt-0.5 text-sm font-semibold text-[#3d2c24]">{order.product_name}</p>
            <p className="text-[11px] text-[#7d6c64]">
              Cantidad pedida: <span className="font-bold">{order.quantity}</span>
              {order.source === 'barra' ? ' · Barra' : ' · Cocina'}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-[#3d2c24]">
              Cantidad recibida <span className="text-[#ea504c]">*</span>
            </label>
            <input
              type="text"
              value={receivedQty}
              onChange={(e) => setReceivedQty(e.target.value)}
              placeholder="ej: 5kg, 12 unidades"
              className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm focus:border-[#006d5a] focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-[#3d2c24]">
              Costo unitario <span className="text-[10px] font-normal text-[#a39e97]">(opcional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#a39e97]">$</span>
              <input
                type="number"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0"
                min="0"
                className="w-full rounded-xl border border-[#ebe6df] bg-white py-2 pl-7 pr-3 text-sm focus:border-[#006d5a] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-[#3d2c24]">
              Fecha de vencimiento <span className="text-[10px] font-normal text-[#a39e97]">(opcional)</span>
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm focus:border-[#006d5a] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-[#3d2c24]">
              Actualizar stock de
              <span className="ml-1 text-[10px] font-normal text-[#a39e97]">(opcional — suma al stock existente)</span>
            </label>
            {selectedItem ? (
              <div className="flex items-center gap-2 rounded-xl border border-[#006d5a] bg-[#e8f5f1] px-3 py-2">
                <Package className="size-4 shrink-0 text-[#006d5a]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#006d5a]">{selectedItem.name}</p>
                  <p className="text-[10px] text-[#006d5a]/70">Actual: {selectedItem.current_qty} {selectedItem.unit}</p>
                </div>
                <button onClick={() => { setStockItemId(null); setStockSearch('') }} className="shrink-0 text-[#a39e97]">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
                <input
                  ref={searchRef}
                  type="text"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder={`Buscar "${order.product_name}"…`}
                  className="w-full rounded-xl border border-[#ebe6df] bg-white py-2 pl-8 pr-3 text-sm focus:border-[#006d5a] focus:outline-none"
                />
                {stockSearch && filteredStock.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-xl border border-[#ebe6df] bg-white shadow-lg">
                    {filteredStock.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => { setStockItemId(item.id); setStockSearch('') }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left first:rounded-t-xl last:rounded-b-xl hover:bg-[#f8f5f0]"
                      >
                        <Package className="size-3.5 shrink-0 text-[#006d5a]" />
                        <span className="flex-1 truncate text-sm font-medium text-[#3d2c24]">{item.name}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-[#a39e97]">{item.current_qty} {item.unit}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2">
          <DialogClose className="rounded-xl px-4 py-2 text-sm font-medium text-[#7d6c64] hover:text-[#3d2c24]">
            Cancelar
          </DialogClose>
          <button
            onClick={handleConfirm}
            disabled={submitting || !receivedQty.trim()}
            className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2 text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {submitting ? 'Cargando…' : 'Confirmar recepción'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
