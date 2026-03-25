'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ShoppingCart, Truck, Check, X, Phone, MessageCircle,
  Coffee, UtensilsCrossed, ChevronDown, ChevronUp,
  Loader2, Package, Clock, Filter, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { isManagerOrAbove } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
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
  supplier_id: string | null
  created_by: string | null
  created_at: string
  source: 'barra' | 'cocina'
}

type Supplier = {
  id: string
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
  const [filter, setFilter] = useState<'all' | 'barra' | 'cocina'>('all')
  const [assignDialog, setAssignDialog] = useState<{ order: Order } | null>(null)
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null)

  const canManage = isManagerOrAbove(profile?.role)

  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const [barRes, kitchenRes, suppRes, profRes] = await Promise.all([
      supabase.from('bar_orders').select('*').in('status', ['pending', 'ordered']).order('created_at', { ascending: false }),
      supabase.from('kitchen_orders').select('*').in('status', ['pending', 'ordered']).order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name, phone, contact_name').eq('is_active', true).order('name'),
      supabase.from('profiles').select('id, first_name, last_name').eq('is_active', true),
    ])

    const bar: Order[] = (barRes.data ?? []).map((o) => ({ ...o, source: 'barra' as const }))
    const kitchen: Order[] = (kitchenRes.data ?? []).map((o) => ({ ...o, source: 'cocina' as const }))
    setBarOrders(bar)
    setKitchenOrders(kitchen)
    setSuppliers(suppRes.data ?? [])
    setProfiles(profRes.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // All orders filtered
  const allOrders = useMemo(() => {
    const combined = [...barOrders, ...kitchenOrders]
    if (filter === 'barra') return combined.filter((o) => o.source === 'barra')
    if (filter === 'cocina') return combined.filter((o) => o.source === 'cocina')
    return combined
  }, [barOrders, kitchenOrders, filter])

  // Group by supplier
  const grouped = useMemo(() => {
    const supplierMap = new Map<string, { supplier: Supplier; orders: Order[] }>()
    const noSupplier: Order[] = []

    for (const order of allOrders) {
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
    const table = order.source === 'barra' ? 'bar_orders' : 'kitchen_orders'
    try {
      // Also call the API for bar orders (handles notifications)
      if (order.source === 'barra') {
        await fetch('/api/kitchen/bar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_order_status', orderId: order.id, status: newStatus }),
        })
      } else {
        const supabase = createClient()
        await supabase.from(table).update({ status: newStatus }).eq('id', order.id)
      }
      toast.success(newStatus === 'ordered' ? 'Marcado como pedido' : newStatus === 'received' ? 'Recibido' : 'Cancelado')
      fetchData()
    } catch {
      toast.error('Error al actualizar')
    }
  }

  async function assignSupplier(order: Order, supplierId: string) {
    const table = order.source === 'barra' ? 'bar_orders' : 'kitchen_orders'
    const supabase = createClient()
    await supabase.from(table).update({ supplier_id: supplierId }).eq('id', order.id)
    setAssignDialog(null)
    toast.success('Proveedor asignado')
    fetchData()
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

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-28">
      {/* Header */}
      <FadeIn>
        <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Gestión de Pedidos</h1>
        <p className="section-label mt-0.5">Pedidos de barra y cocina</p>
      </FadeIn>

      {/* KPIs */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-[#fdf6ec] p-3 text-center">
            <p className="font-display text-xl font-bold tabular-nums text-[#d4943a]"><AnimatedNumber value={pending.length} /></p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">Pendientes</p>
          </div>
          <div className="rounded-xl bg-[#eef4fc] p-3 text-center">
            <p className="font-display text-xl font-bold tabular-nums text-[#4a90d9]"><AnimatedNumber value={ordered.length} /></p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#4a90d9]">Pedidos</p>
          </div>
          <div className={cn('rounded-xl p-3 text-center', grouped.noSupplier.length > 0 ? 'bg-[#fef2f2]' : 'bg-[#e8f5f1]')}>
            <p className={cn('font-display text-xl font-bold tabular-nums', grouped.noSupplier.length > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]')}>
              <AnimatedNumber value={grouped.noSupplier.length} />
            </p>
            <p className={cn('text-[9px] font-semibold uppercase tracking-wider', grouped.noSupplier.length > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]')}>
              Sin asignar
            </p>
          </div>
        </div>
      </FadeIn>

      {/* Filter */}
      <FadeIn delay={0.08}>
        <div className="flex gap-1.5">
          {(['all', 'barra', 'cocina'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all',
                filter === f ? 'bg-[#006d5a] text-white' : 'bg-secondary text-muted-foreground',
              )}
            >
              {f === 'all' && <Filter className="size-3" />}
              {f === 'barra' && <Coffee className="size-3" />}
              {f === 'cocina' && <UtensilsCrossed className="size-3" />}
              {f === 'all' ? 'Todos' : f === 'barra' ? 'Barra' : 'Cocina'}
              <span className="tabular-nums">
                ({f === 'all' ? allOrders.length : allOrders.filter((o) => o.source === f).length})
              </span>
            </button>
          ))}
        </div>
      </FadeIn>

      {/* Grouped by supplier */}
      {grouped.groups.map(({ supplier, orders }) => {
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
      {grouped.noSupplier.length > 0 && (
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

      {allOrders.length === 0 && (
        <FadeIn>
          <div className="flex flex-col items-center py-12 text-center">
            <ShoppingCart className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">Sin pedidos pendientes</p>
            <p className="mt-1 text-xs text-[#a39e97]/70">Los pedidos de barra y cocina aparecerán acá</p>
          </div>
        </FadeIn>
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
  const timeAgo = formatDistanceToNow(new Date(order.created_at), { addSuffix: true, locale: es })

  return (
    <div className={cn('px-4 py-3', isOrdered && 'bg-[#f0f7f5]/50')}>
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
      </div>

      {order.note && (
        <p className="mt-1.5 ml-[42px] text-[11px] italic text-[#a39e97] truncate">💬 {order.note}</p>
      )}

      {/* Action buttons — labeled for clarity */}
      {canManage && (
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
