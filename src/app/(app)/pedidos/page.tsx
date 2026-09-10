'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale/es'
import Link from 'next/link'
import {
  ShoppingCart, Truck, Check, X, MessageCircle, Plus, Loader2, Package, AlertTriangle,
  CalendarClock, ChevronDown, ChevronUp, Trash2, Search, Receipt, Wallet, ChevronRight, Pencil,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { logAuditClient } from '@/lib/audit'
import { isManagerOrAbove } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { FadeIn, AnimatedNumber, motion } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import { BackToHoy } from '@/components/layout/BackToHoy'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog'
import type { SugerenciasPayload, SugerenciaCompra } from '@/lib/compras/sugerencias'

// ---------------------------------------------------------------------------
// /pedidos — el ciclo real, en tres pasos y sin duplicar Fudo
// ---------------------------------------------------------------------------
//   PEDIR     un solo motor (ventas × recetas + mínimos + calendario del
//             proveedor) → armás el pedido por proveedor → WhatsApp → queda
//             "en camino" con fecha de envío.
//   EN CAMINO cuando Fudo registra la compra (Gastos) aparece acá el gasto
//             sugerido → "Llegó" cierra el pedido SIN volver a cargar stock.
//             Si la compra no se cargó en Fudo, LVE suma el stock por delta.
//   RECIBIDOS historial con quién, cuándo, cómo y por cuánto (monto Fudo).
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
  /** bar_orders guarda el autor en requested_by */
  requested_by?: string | null
  created_at: string
  source: 'barra' | 'cocina'
  stock_item_id: string | null
  received_qty: string | null
  unit_cost: number | null
  received_at: string | null
  received_by: string | null
  ordered_at?: string | null
  fudo_expense_id?: string | null
  fudo_amount?: number | null
  received_mode?: string | null
  received_note?: string | null
  payment_method?: string | null
}

type Supplier = { id: string; name: string; phone: string | null; contact_name: string | null; fudo_provider_id?: string | null }
type Profile = { id: string; first_name: string; last_name: string }
type StockLite = { id: string; name: string; unit: string; current_qty: number; fudo_skip?: boolean | null; fudo_ingredient_id?: string | null; fudo_product_id?: string | null }

type ExpenseLite = { id: string; provider: string | null; providerId: string | null; date: string; amount: number; ingredientNames: string[] }
type Match = { order_id: number; source: 'cocina' | 'barra'; strength: 'fuerte' | 'probable'; why: string; expense: ExpenseLite }
type ConciliarPayload = { matches: Match[]; expenses: ExpenseLite[] }

type Step = 'pedir' | 'camino' | 'recibido' | 'pagos'

type ReceiptRow = {
  id: number
  supplier_id: string | null
  qty: number
  unit: string | null
  cost_total: number | null
  note: string | null
  received_date: string
  payment_status: 'pagado' | 'a_pagar'
  paid_at: string | null
  payment_method: string | null
  supplier_name: string
}
type ReceiptPayState = { id: number; method: 'efectivo' | 'transferencia' | 'tarjeta' | null }

const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

function stripNonDigits(s: string): string { return s.replace(/\D/g, '') }
function money(n: number) { return `$${Math.round(n).toLocaleString('es-AR')}` }

export default function PedidosPage() {
  return (
    <Suspense fallback={<LoadingState message="Cargando pedidos..." />}>
      <PedidosContent />
    </Suspense>
  )
}

function PedidosContent() {
  const router = useRouter()
  const params = useSearchParams()
  const { profile } = useProfileContext()
  const canManage = isManagerOrAbove(profile?.role)

  const stepParam = params.get('step')
  const [step, setStepState] = useState<Step>(stepParam === 'camino' || stepParam === 'recibido' || stepParam === 'pagos' ? stepParam : 'pedir')
  const setStep = (s: Step) => {
    setStepState(s)
    const p = new URLSearchParams(params.toString())
    p.set('step', s)
    router.replace(`/pedidos?${p}`, { scroll: false })
  }

  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<Order[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [stockItems, setStockItems] = useState<StockLite[]>([])
  const [sugerencias, setSugerencias] = useState<SugerenciasPayload | null>(null)
  const [loadingSug, setLoadingSug] = useState(true)
  const [conciliar, setConciliar] = useState<ConciliarPayload | null>(null)

  // Carrito: stock_item_id → cantidad a pedir (string editable)
  const [cart, setCart] = useState<Record<string, string>>({})
  const [sending, setSending] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [arrivalDialog, setArrivalDialog] = useState<Order | null>(null)
  const [correctionDialog, setCorrectionDialog] = useState<Order | null>(null)
  const [assignDialog, setAssignDialog] = useState<Order | null>(null)
  const [newOrderOpen, setNewOrderOpen] = useState(false)
  // Saldo pendiente de pago a proveedores (null si la migración de pagos no está)
  const [porPagar, setPorPagar] = useState<number | null>(null)
  const [receiptsCount, setReceiptsCount] = useState(0)
  const [receipts, setReceipts] = useState<ReceiptRow[]>([])
  const [receiptsLoading, setReceiptsLoading] = useState(false)
  const [receiptPayState, setReceiptPayState] = useState<ReceiptPayState | null>(null)
  const [receiptConfirming, setReceiptConfirming] = useState(false)

  const fetchOrders = useCallback(async () => {
    const supabase = createClient()
    const [barRes, kitchenRes, suppRes, profRes, stockRes] = await Promise.all([
      supabase.from('bar_orders').select('*').in('status', ['pending', 'ordered', 'received']).order('created_at', { ascending: false }).limit(120),
      supabase.from('kitchen_orders').select('*').in('status', ['pending', 'ordered', 'received']).order('created_at', { ascending: false }).limit(120),
      supabase.from('suppliers').select('id, name, phone, contact_name, fudo_provider_id').eq('is_active', true).order('name'),
      supabase.from('profiles').select('id, first_name, last_name').eq('is_active', true),
      supabase.from('stock_items').select('id, name, unit, current_qty, fudo_skip, fudo_ingredient_id, fudo_product_id').eq('is_active', true).order('name'),
    ])
    const bar = (barRes.data ?? []).map((o) => ({ ...(o as Record<string, unknown>), source: 'barra' as const })) as unknown as Order[]
    const kitchen = (kitchenRes.data ?? []).map((o) => ({ ...(o as Record<string, unknown>), source: 'cocina' as const })) as unknown as Order[]
    setOrders([...kitchen, ...bar])
    setSuppliers((suppRes.data ?? []) as unknown as Supplier[])
    setProfiles((profRes.data ?? []) as unknown as Profile[])
    setStockItems((stockRes.data ?? []) as unknown as StockLite[])
    setLoading(false)

    supabase
      .from('stock_receipts')
      .select('cost_total')
      .eq('payment_status', 'a_pagar')
      .not('cost_total', 'is', null)
      .then(({ data, error }) => {
        if (error) { setPorPagar(null); return }
        const rows = data ?? []
        setPorPagar(Math.round(rows.reduce((acc, r) => acc + (Number((r as { cost_total: number | null }).cost_total) || 0), 0)))
        setReceiptsCount(rows.length)
      })
  }, [])

  const fetchSugerencias = useCallback(async (fresh = false) => {
    setLoadingSug(true)
    try {
      const res = await fetch(`/api/compras/sugerencias${fresh ? '?fresh=1' : ''}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'No se pudieron calcular las sugerencias')
      setSugerencias(await res.json())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al calcular qué pedir')
    } finally {
      setLoadingSug(false)
    }
  }, [])

  const fetchConciliar = useCallback(async () => {
    if (!canManage) return
    try {
      const res = await fetch('/api/compras/conciliar')
      if (res.ok) setConciliar(await res.json())
    } catch { /* best-effort */ }
  }, [canManage])

  const fetchReceipts = useCallback(async () => {
    setReceiptsLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('stock_receipts')
      .select('id, supplier_id, qty, unit, cost_total, note, received_date, payment_status, paid_at, payment_method, suppliers:supplier_id(name)')
      .eq('payment_status', 'a_pagar')
      .not('cost_total', 'is', null)
      .order('received_date', { ascending: false })
      .limit(300)
    if (!error && data) {
      setReceipts(((data) as unknown as (Omit<ReceiptRow, 'supplier_name'> & { suppliers: { name: string } | null })[])
        .map((r) => ({ ...r, supplier_name: r.suppliers?.name ?? 'Sin proveedor' })))
    }
    setReceiptsLoading(false)
  }, [])

  useEffect(() => { void fetchOrders(); void fetchSugerencias() }, [fetchOrders, fetchSugerencias])
  useEffect(() => { if (step === 'camino') void fetchConciliar() }, [step, fetchConciliar])
  useEffect(() => { if (step === 'pagos') void fetchReceipts() }, [step, fetchReceipts])

  const pending = useMemo(() => orders.filter((o) => o.status === 'pending'), [orders])
  const ordered = useMemo(() => orders.filter((o) => o.status === 'ordered'), [orders])
  const received = useMemo(() => orders.filter((o) => o.status === 'received').sort((a, b) => (b.received_at ?? '').localeCompare(a.received_at ?? '')), [orders])

  const profileName = (id: string | null) => {
    if (!id) return 'Sistema'
    const p = profiles.find((x) => x.id === id)
    return p ? `${p.first_name} ${p.last_name?.[0] ?? ''}.` : 'Equipo'
  }

  // ── Carrito ──
  const toggleCart = (s: SugerenciaCompra) => setCart((c) => {
    const next = { ...c }
    if (next[s.stock_item_id] !== undefined) delete next[s.stock_item_id]
    else next[s.stock_item_id] = String(s.suggested_qty)
    return next
  })
  const selectAll = (items: SugerenciaCompra[]) => setCart((c) => {
    const next = { ...c }
    for (const s of items) if (!s.already_ordered && next[s.stock_item_id] === undefined) next[s.stock_item_id] = String(s.suggested_qty)
    return next
  })

  function buildMessage(supplierName: string, contact: string | null, lines: { name: string; qty: string; unit: string }[]) {
    const list = lines.map((l) => `- ${l.name}: ${l.qty} ${l.unit}`).join('\n')
    return `Hola${contact ? ` ${contact}` : ''}, soy de *La Vieja Escuela*.\nTe paso el pedido:\n\n${list}\n\n¡Gracias!`
  }

  async function sendGroup(group: SugerenciasPayload['groups'][number], viaWhatsApp: boolean) {
    const lines = group.items
      .filter((s) => cart[s.stock_item_id] !== undefined && Number(cart[s.stock_item_id]) > 0)
      .map((s) => ({ item: s, qty: cart[s.stock_item_id] }))
    if (lines.length === 0) { toast.error('Elegí al menos un insumo'); return }
    setSending(group.supplier_id ?? 'none')
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_order',
          items: lines.map(({ item, qty }) => ({ product_name: item.name, quantity: `${qty} ${item.unit}`, stock_item_id: item.stock_item_id })),
          urgency: lines.some(({ item }) => item.reason === 'negativo' || item.reason === 'sin_stock') ? 'alta' : 'normal',
          supplier_id: group.supplier_id,
          initial_status: 'ordered',
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? 'No se pudo crear el pedido')
      if (viaWhatsApp && group.supplier_phone) {
        const url = `https://wa.me/${stripNonDigits(group.supplier_phone)}?text=${encodeURIComponent(buildMessage(group.supplier_name, group.supplier_contact, lines.map(({ item, qty }) => ({ name: item.name, qty, unit: item.unit }))))}`
        window.open(url, '_blank', 'noopener,noreferrer')
      }
      toast.success(`Pedido a ${group.supplier_name}: ${lines.length} insumo${lines.length !== 1 ? 's' : ''} en camino`)
      setCart((c) => { const n = { ...c }; for (const { item } of lines) delete n[item.stock_item_id]; return n })
      // Fire-and-forget: no bloqueamos la UI mientras refrescan los datos
      void fetchOrders()
      void fetchSugerencias(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al enviar el pedido')
    } finally {
      setSending(null)
    }
  }

  async function updateStatus(order: Order, status: 'ordered' | 'cancelled') {
    try {
      const endpoint = order.source === 'barra' ? '/api/kitchen/bar' : '/api/kitchen/orders'
      const action = order.source === 'barra' ? 'update_order_status' : 'update_status'
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, orderId: order.id, status }) })
      if (!res.ok) throw new Error('Error')
      toast.success(status === 'ordered' ? 'Marcado como enviado al proveedor' : 'Pedido cancelado')
      void fetchOrders()
    } catch {
      toast.error('No se pudo actualizar el pedido')
    }
  }

  async function assignSupplier(order: Order, supplierId: string) {
    const table = order.source === 'barra' ? 'bar_orders' : 'kitchen_orders'
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from(table) as any).update({ supplier_id: supplierId }).eq('id', order.id)
    if (error) { toast.error('No se pudo asignar el proveedor'); return }
    const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? supplierId
    logAuditClient({
      userId: profile?.id ?? null,
      userName: profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null : null,
      action: 'assign_order_supplier',
      module: 'pedidos',
      entityType: order.source === 'barra' ? 'bar_order' : 'kitchen_order',
      entityId: String(order.id),
      description: `${order.product_name}: proveedor asignado a ${supplierName}`,
      metadata: { supplier_id: supplierId, supplier_name: supplierName },
    })
    setAssignDialog(null)
    toast.success('Proveedor asignado')
    void fetchOrders()
  }

  async function markReceiptPaid(receipt: ReceiptRow, method: 'efectivo' | 'transferencia' | 'tarjeta') {
    setReceiptConfirming(true)
    try {
      const res = await fetch(`/api/stock/receipts/${receipt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: 'pagado', payment_method: method }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al marcar pagado')
      const fudoMsg = json.fudoSynced ? ' — imputado en Fudo' : ''
      toast.success(`Pagado (${method}) — ${receipt.supplier_name}${fudoMsg}`)
      setReceiptPayState(null)
      void fetchReceipts()
      void fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al marcar pagado')
    } finally {
      setReceiptConfirming(false)
    }
  }

  if (loading) return <LoadingState message="Cargando pedidos..." />

  const orderToday = sugerencias?.groups.filter((g) => g.is_order_day && g.supplier_id) ?? []
  const cartCount = Object.keys(cart).length
  const matchByOrder = new Map((conciliar?.matches ?? []).map((m) => [`${m.source}-${m.order_id}`, m]))

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      <BackToHoy />

      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">Pedidos</h1>
            <p className="mt-0.5 text-[12px] text-[#7d6c64]">Pedir · en camino · recibido · pagos</p>
          </div>
          {canManage && (
            <button onClick={() => setNewOrderOpen(true)} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-sm font-semibold text-white shadow-sm active:scale-[0.97]">
              <Plus className="size-4" /> Manual
            </button>
          )}
        </div>
      </FadeIn>

      {/* Pasos */}
      <FadeIn delay={0.04}>
        <div className="grid grid-cols-4 gap-1.5 rounded-[1.4rem] bg-[#faf8f5] p-1 ring-1 ring-[#ebe6df]">
          {([
            { key: 'pedir' as const, label: 'Pedir', count: (sugerencias?.total_items ?? 0) + pending.length, Icon: ShoppingCart, tone: '#d4943a' },
            { key: 'camino' as const, label: 'En camino', count: ordered.length, Icon: Truck, tone: '#4a90d9' },
            { key: 'recibido' as const, label: 'Recibidos', count: received.length, Icon: Check, tone: '#006d5a' },
            { key: 'pagos' as const, label: 'Pagos', count: receiptsCount, Icon: Wallet, tone: '#8b5e34' },
          ]).map(({ key, label, count, Icon, tone }) => {
            const active = step === key
            return (
              <button key={key} onClick={() => setStep(key)} className={cn('relative rounded-2xl p-3 text-center transition-opacity', active ? 'opacity-100' : 'opacity-55 hover:opacity-80')}>
                {active && (
                  <motion.span layoutId="pedidos-step-pill" className="absolute inset-0 rounded-2xl bg-white shadow-sm" style={{ boxShadow: `inset 0 -3px 0 ${tone}, 0 2px 8px rgba(0,0,0,0.05)` }} transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                )}
                <span className="relative z-10 block">
                  <Icon className="mx-auto size-4" style={{ color: tone }} />
                  <p className="mt-1 font-display text-xl font-bold tabular-nums" style={{ color: tone }}><AnimatedNumber value={count} /></p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">{label}</p>
                </span>
              </button>
            )
          })}
        </div>
      </FadeIn>

      {/* ═══════════ PASO 1 — PEDIR ═══════════ */}
      {step === 'pedir' && (
        <>
          {orderToday.length > 0 && (
            <FadeIn delay={0.06}>
              <div className="flex items-start gap-2.5 rounded-2xl bg-[#fffbf5] px-4 py-3 ring-1 ring-[#d4943a]/30">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-[#d4943a]" />
                <p className="text-[12px] text-[#3d2c24]">
                  <span className="font-bold">Hoy toca pedir:</span> {orderToday.map((g) => g.supplier_name).join(', ')}
                </p>
              </div>
            </FadeIn>
          )}

          {/* Pedidos de cocina/barra sin enviar */}
          {pending.length > 0 && (
            <FadeIn delay={0.07}>
              <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
                <div className="flex items-center gap-2 border-b border-[#f5f0ea] bg-[#faf8f5] px-4 py-2.5">
                  <AlertTriangle className="size-4 text-[#d4943a]" />
                  <p className="flex-1 text-[12px] font-bold uppercase tracking-wider text-[#3d2c24]">Pidió el equipo · sin enviar</p>
                  <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[11px] font-bold text-[#d4943a]">{pending.length}</span>
                </div>
                <div className="divide-y divide-[#f5f0ea]">
                  {pending.map((o) => (
                    <OrderRow key={`${o.source}-${o.id}`} order={o} who={profileName(o.created_by ?? o.requested_by ?? null)} supplier={suppliers.find((s) => s.id === o.supplier_id) ?? null}>
                      {canManage && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {!o.supplier_id && (
                            <button onClick={() => setAssignDialog(o)} className="flex items-center gap-1 rounded-lg bg-[#fdf6ec] px-2.5 py-1.5 text-[11px] font-semibold text-[#d4943a] active:scale-95">
                              <Package className="size-3" /> Proveedor
                            </button>
                          )}
                          <button onClick={() => void updateStatus(o, 'ordered')} className="flex items-center gap-1 rounded-lg bg-[#4a90d9] px-2.5 py-1.5 text-[11px] font-semibold text-white active:scale-95">
                            <Truck className="size-3" /> Ya lo pedí
                          </button>
                          <button onClick={() => void updateStatus(o, 'cancelled')} className="flex items-center gap-1 rounded-lg bg-[#fef2f2] px-2.5 py-1.5 text-[11px] font-semibold text-[#ea504c] active:scale-95">
                            <X className="size-3" /> Cancelar
                          </button>
                        </div>
                      )}
                    </OrderRow>
                  ))}
                </div>
              </section>
            </FadeIn>
          )}

          {/* Sugerencias por proveedor */}
          {loadingSug && !sugerencias ? (
            <LoadingState message="Calculando qué pedir (ventas × recetas)..." />
          ) : !sugerencias || sugerencias.groups.length === 0 ? (
            <FadeIn>
              <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-10 text-center ring-1 ring-[#ebe6df]">
                <ShoppingCart className="size-8 text-[#ebe6df]" />
                <p className="mt-3 text-sm font-medium text-[#7d6c64]">Nada para pedir ahora</p>
                <p className="mt-1 text-[11px] text-[#a39e97]">Ningún insumo por debajo del mínimo ni por acabarse antes de la próxima entrega.</p>
              </div>
            </FadeIn>
          ) : (
            <div className="space-y-3">
              <p className="px-1 text-[11px] text-[#a39e97]">
                Sugerido con ventas de {sugerencias.window_days} días × recetas, mínimos y calendario de cada proveedor.
                {canManage && sugerencias.total_estimated_cost > 0 && <> Total estimado: <span className="font-semibold text-[#3d2c24]">{money(sugerencias.total_estimated_cost)}</span>.</>}
              </p>
              {sugerencias.groups.map((g) => {
                const key = g.supplier_id ?? 'sin-proveedor'
                const open = expanded.has(key) || g.is_order_day || sugerencias.groups.length <= 3
                const selectedInGroup = g.items.filter((s) => cart[s.stock_item_id] !== undefined)
                const groupCost = selectedInGroup.reduce((acc, s) => acc + (s.cost_per_unit ? s.cost_per_unit * Number(cart[s.stock_item_id] || 0) : 0), 0)
                return (
                  <section key={key} className={cn('overflow-hidden rounded-2xl bg-white ring-1', g.is_order_day ? 'ring-[#d4943a]/40' : 'ring-[#ebe6df]')}>
                    <button
                      onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', g.supplier_id ? 'bg-[#e8f5f1]' : 'bg-[#fef2f2]')}>
                        {g.supplier_id ? <Package className="size-4 text-[#006d5a]" /> : <AlertTriangle className="size-4 text-[#ea504c]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#3d2c24]">{g.supplier_name}</p>
                        <p className="text-[11px] text-[#a39e97]">
                          {g.items.length} insumo{g.items.length !== 1 ? 's' : ''}
                          {g.is_order_day && <span className="ml-1 font-bold text-[#d4943a]">· hoy toca pedir</span>}
                          {!g.is_order_day && g.order_days.length > 0 && <span> · pide {g.order_days.map((d) => DOW[d]).join('/')}</span>}
                          {g.coverage_days && <span> · cubrir {g.coverage_days}d</span>}
                        </p>
                      </div>
                      {open ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
                    </button>

                    {open && (
                      <div className="border-t border-[#f5f0ea]">
                        {!g.supplier_id && (
                          <p className="bg-[#fef2f2]/50 px-4 py-2 text-[11px] text-[#ea504c]">
                            Sin proveedor no se puede armar el pedido. <Link href="/proveedores/vincular" className="font-bold underline">Vincular proveedores</Link>
                          </p>
                        )}
                        <div className="divide-y divide-[#f5f0ea]">
                          {g.items.map((s) => {
                            const inCart = cart[s.stock_item_id] !== undefined
                            return (
                              <div key={s.stock_item_id} className={cn('flex items-center gap-3 px-4 py-2.5', inCart && 'bg-[#f0f7f5]/60')}>
                                <button
                                  disabled={s.already_ordered || !g.supplier_id}
                                  onClick={() => toggleCart(s)}
                                  className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors', inCart ? 'border-[#006d5a] bg-[#006d5a] text-white' : 'border-[#ebe6df] bg-white', (s.already_ordered || !g.supplier_id) && 'opacity-40')}
                                >
                                  {inCart && <Check className="size-3.5" />}
                                </button>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{s.name}</p>
                                  <p className="text-[11px] text-[#a39e97]">
                                    <span className={cn('font-semibold', s.reason === 'negativo' || s.reason === 'sin_stock' ? 'text-[#ea504c]' : 'text-[#d4943a]')}>{s.reason_label}</span>
                                    {s.daily_consumption ? <span> · ~{s.daily_consumption} {s.unit}/día</span> : null}
                                    {s.already_ordered && <span className="ml-1 font-bold text-[#006d5a]">· ya pedido</span>}
                                  </p>
                                </div>
                                {inCart ? (
                                  <div className="flex shrink-0 items-center gap-1">
                                    <input
                                      inputMode="decimal"
                                      value={cart[s.stock_item_id]}
                                      onChange={(e) => setCart((c) => ({ ...c, [s.stock_item_id]: e.target.value }))}
                                      className="w-16 rounded-lg border border-[#006d5a] bg-white px-2 py-1.5 text-center text-[13px] font-bold tabular-nums text-[#006d5a] focus:outline-none"
                                    />
                                    <span className="text-[10px] text-[#7d6c64]">{s.unit}</span>
                                  </div>
                                ) : (
                                  <span className="shrink-0 text-right text-[12px] tabular-nums text-[#7d6c64]">
                                    <span className="font-bold text-[#3d2c24]">{s.suggested_qty}</span> {s.unit}
                                    {canManage && s.estimated_cost ? <span className="block text-[10px] text-[#a39e97]">{money(s.estimated_cost)}</span> : null}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        {g.supplier_id && (
                          <div className="border-t border-[#f5f0ea] bg-[#faf8f5] p-3">
                            <div className="flex items-center gap-2">
                              <button onClick={() => selectAll(g.items)} className="rounded-xl px-3 py-2 text-[12px] font-semibold text-[#3d2c24] ring-1 ring-[#ebe6df]">Todo</button>
                              {g.supplier_phone ? (
                                <button
                                  onClick={() => void sendGroup(g, true)}
                                  disabled={selectedInGroup.length === 0 || sending === key}
                                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] py-2.5 text-[13px] font-bold text-white active:scale-[0.98] disabled:opacity-50"
                                >
                                  {sending === key ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
                                  WhatsApp
                                  {selectedInGroup.length > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[11px]">{selectedInGroup.length}</span>}
                                  {canManage && groupCost > 0 && <span className="text-[11px] font-medium opacity-90">· {money(groupCost)}</span>}
                                </button>
                              ) : (
                                <button
                                  onClick={() => void sendGroup(g, false)}
                                  disabled={selectedInGroup.length === 0 || sending === key}
                                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#4a90d9] py-2.5 text-[13px] font-bold text-white active:scale-[0.98] disabled:opacity-50"
                                >
                                  {sending === key ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
                                  Marcar como pedido
                                  {selectedInGroup.length > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[11px]">{selectedInGroup.length}</span>}
                                  {canManage && groupCost > 0 && <span className="text-[11px] font-medium opacity-90">· {money(groupCost)}</span>}
                                </button>
                              )}
                            </div>
                            {g.supplier_phone && (
                              <button
                                onClick={() => void sendGroup(g, false)}
                                disabled={selectedInGroup.length === 0 || sending === key}
                                className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-semibold text-[#7d6c64] ring-1 ring-[#ebe6df] active:scale-[0.98] disabled:opacity-50"
                              >
                                <Truck className="size-3.5" />
                                Solo marcar como pedido (sin WhatsApp)
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}
          {cartCount > 0 && <p className="text-center text-[11px] text-[#a39e97]">{cartCount} insumo{cartCount !== 1 ? 's' : ''} elegido{cartCount !== 1 ? 's' : ''} — se envían por proveedor</p>}
        </>
      )}

      {/* ═══════════ PASO 2 — EN CAMINO ═══════════ */}
      {step === 'camino' && (
        ordered.length === 0 ? (
          <FadeIn>
            <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-10 text-center ring-1 ring-[#ebe6df]">
              <Truck className="size-8 text-[#ebe6df]" />
              <p className="mt-3 text-sm font-medium text-[#7d6c64]">Nada en camino</p>
              <p className="mt-1 text-[11px] text-[#a39e97]">Los pedidos enviados al proveedor aparecen acá hasta que confirmás que llegaron.</p>
            </div>
          </FadeIn>
        ) : (
          <FadeIn>
            <p className="px-1 text-[11px] text-[#a39e97]">
              Cuando llegue el pedido, tocá <strong className="text-[#006d5a]">Llegó</strong> para registrar la recepción y elegir cómo se paga.
            </p>
            <div className="mt-2 space-y-2">
              {groupBySupplier(ordered, suppliers).map(({ supplier, list }) => (
                <section key={supplier?.id ?? 'none'} className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
                  <div className="flex items-center gap-2 border-b border-[#f5f0ea] bg-[#faf8f5] px-4 py-2.5">
                    <Package className="size-4 text-[#4a90d9]" />
                    <p className="flex-1 truncate text-[12px] font-bold uppercase tracking-wider text-[#3d2c24]">{supplier?.name ?? 'Sin proveedor'}</p>
                    <span className="text-[11px] tabular-nums text-[#a39e97]">{list.length}</span>
                  </div>
                  <div className="divide-y divide-[#f5f0ea]">
                    {list.map((o) => {
                      const match = matchByOrder.get(`${o.source}-${o.id}`)
                      return (
                        <OrderRow key={`${o.source}-${o.id}`} order={o} who={profileName(o.created_by ?? o.requested_by ?? null)} supplier={supplier}>
                          {match && (
                            <div className="mt-2 flex items-start gap-2 rounded-xl bg-[#e8f5f1] px-3 py-2 text-[11px] text-[#006d5a]">
                              <Receipt className="mt-0.5 size-3.5 shrink-0" />
                              <span>
                                <span className="font-bold">Fudo registró {money(match.expense.amount)}</span> el {format(new Date(match.expense.date), 'd MMM', { locale: es })}
                                {match.strength === 'fuerte' ? ' con este insumo' : ''}.
                                {match.expense.ingredientNames.length > 0 && <span className="text-[#006d5a]/70"> ({match.expense.ingredientNames.slice(0, 3).join(', ')}{match.expense.ingredientNames.length > 3 ? '…' : ''})</span>}
                              </span>
                            </div>
                          )}
                          {canManage && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <button onClick={() => setArrivalDialog(o)} className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-[11px] font-semibold text-white active:scale-95">
                                <Check className="size-3" /> Llegó
                              </button>
                              <button onClick={() => void updateStatus(o, 'cancelled')} className="flex items-center gap-1 rounded-lg bg-[#fef2f2] px-2.5 py-1.5 text-[11px] font-semibold text-[#ea504c] active:scale-95">
                                <X className="size-3" /> No vino
                              </button>
                            </div>
                          )}
                        </OrderRow>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </FadeIn>
        )
      )}

      {/* ═══════════ PASO 3 — RECIBIDOS ═══════════ */}
      {step === 'recibido' && (
        <FadeIn>
          {canManage && porPagar !== null && porPagar > 0 && (
            <button
              onClick={() => setStep('pagos')}
              className="mb-2 flex w-full items-center gap-2.5 rounded-2xl bg-[#fdf6ec] px-4 py-2.5 ring-1 ring-[#d4943a]/30 active:scale-[0.99]"
            >
              <Wallet className="size-4 shrink-0 text-[#d4943a]" />
              <span className="flex-1 text-xs font-semibold text-[#8b5e34]">Pendiente de pago</span>
              <span className="rounded-full bg-[#d4943a]/15 px-2.5 py-0.5 text-[12px] font-bold tabular-nums text-[#d4943a]">{money(porPagar)}</span>
              <ChevronRight className="size-4 shrink-0 text-[#a39e97]" />
            </button>
          )}
          {received.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-10 text-center ring-1 ring-[#ebe6df]">
              <Check className="size-8 text-[#ebe6df]" />
              <p className="mt-3 text-sm font-medium text-[#7d6c64]">Sin recepciones todavía</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <div className="divide-y divide-[#f5f0ea]">
                {received.slice(0, 40).map((o) => (
                  <OrderRow key={`${o.source}-${o.id}`} order={o} who={profileName(o.received_by ?? o.created_by ?? o.requested_by ?? null)} supplier={suppliers.find((s) => s.id === o.supplier_id) ?? null} muted>
                    <p className="mt-1 text-[11px] text-[#7d6c64]">
                      {o.received_at ? `Recibido ${format(new Date(o.received_at), "d MMM HH:mm", { locale: es })}` : 'Recibido'}
                      {o.received_by && ` por ${profileName(o.received_by)}`}
                      {o.received_mode === 'fudo_expense' && <span className="ml-1 rounded-full bg-[#e8f5f1] px-1.5 py-0.5 text-[10px] font-bold text-[#006d5a]">Fudo{o.fudo_amount ? ` ${money(o.fudo_amount)}` : ''}</span>}
                      {o.received_mode === 'lve_stock' && <span className="ml-1 rounded-full bg-[#eef4fc] px-1.5 py-0.5 text-[10px] font-bold text-[#4a90d9]">stock LVE{o.received_qty ? ` ${o.received_qty}` : ''}</span>}
                      {o.received_mode === 'sin_stock' && <span className="ml-1 rounded-full bg-[#f3efe9] px-1.5 py-0.5 text-[10px] font-bold text-[#7d6c64]">sin stock</span>}
                      {o.payment_method && (
                        <span className={cn('ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                          o.payment_method === 'cuenta_corriente' ? 'bg-[#fdf6ec] text-[#d4943a]' : 'bg-[#f3efe9] text-[#7d6c64]')}>
                          {o.payment_method === 'cuenta_corriente' ? 'cta. cte.' : o.payment_method}
                        </span>
                      )}
                      {o.received_note && <span className="block italic text-[#a39e97]">"{o.received_note}"</span>}
                    </p>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setCorrectionDialog(o)}
                        className="mt-1.5 text-[11px] font-semibold text-[#a39e97] underline underline-offset-2"
                      >
                        Corregir recepción
                      </button>
                    )}
                  </OrderRow>
                ))}
              </div>
            </div>
          )}
        </FadeIn>
      )}

      {/* Diálogos */}
      {/* ═══════════ PASO 4 — PAGOS ═══════════ */}
      {step === 'pagos' && (
        receiptsLoading ? (
          <LoadingState message="Cargando pagos..." />
        ) : (
          <FadeIn>
            {porPagar !== null && porPagar > 0 && (
              <div className="mb-3 rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#fdf6ec]">
                    <Wallet className="size-4 text-[#8b5e34]" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Saldo pendiente</p>
                    <p className="font-display text-xl font-bold tabular-nums text-[#3d2c24]">{money(porPagar)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold tabular-nums text-[#d4943a]">{receiptsCount}</p>
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">recibos</p>
                  </div>
                </div>
              </div>
            )}

            {receipts.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-10 text-center ring-1 ring-[#ebe6df]">
                <Wallet className="size-8 text-[#ebe6df]" />
                <p className="mt-3 text-sm font-medium text-[#7d6c64]">Todo al día</p>
                <p className="mt-1 text-[11px] text-[#a39e97]">Los pedidos recibidos en cuenta corriente aparecen acá.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groupReceiptsBySupplier(receipts).map((group) => (
                  <div key={group.key} className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
                    <div className="flex items-center gap-3 bg-[#faf8f5] px-4 py-2.5">
                      <Package className="size-4 shrink-0 text-[#006d5a]" />
                      <p className="flex-1 truncate text-[12px] font-bold uppercase tracking-wider text-[#3d2c24]">{group.name}</p>
                      <span className="text-[12px] font-bold tabular-nums text-[#d4943a]">{money(group.total)}</span>
                    </div>
                    <div className="divide-y divide-[#f5f0ea]">
                      {group.receipts.map((r) => {
                        const isPaying = receiptPayState?.id === r.id
                        return (
                          <div key={r.id} className="px-4 py-2.5">
                            <div className="flex items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-[#3d2c24]">{r.note ?? `${r.qty} ${r.unit ?? ''}`}</p>
                                <p className="text-[10px] text-[#a39e97]">
                                  {format(new Date(`${r.received_date}T12:00:00`), 'd MMM', { locale: es })}
                                  {' · '}{r.qty} {r.unit ?? 'u'}
                                </p>
                              </div>
                              <span className="shrink-0 text-xs font-bold tabular-nums text-[#3d2c24]">
                                {money(Number(r.cost_total) || 0)}
                              </span>
                              {!isPaying ? (
                                <button
                                  onClick={() => setReceiptPayState({ id: r.id, method: null })}
                                  className="flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[11px] font-semibold text-white active:scale-95"
                                >
                                  <Check className="size-3" /> Pagar
                                </button>
                              ) : (
                                <button onClick={() => setReceiptPayState(null)} className="flex shrink-0 items-center justify-center rounded-lg bg-[#f3efe9] p-1.5 text-[#a39e97]">
                                  <X className="size-3.5" />
                                </button>
                              )}
                            </div>
                            {isPaying && (
                              <div className="mt-2 border-t border-[#f5f0ea] pt-2">
                                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">¿Cómo se paga?</p>
                                <div className="flex items-center gap-2">
                                  {(['efectivo', 'transferencia', 'tarjeta'] as const).map((m) => (
                                    <button
                                      key={m}
                                      onClick={() => setReceiptPayState((p) => p ? { ...p, method: m } : null)}
                                      className={cn('flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all',
                                        receiptPayState?.method === m ? 'bg-[#006d5a] text-white' : 'bg-[#f3efe9] text-[#7d6c64]')}
                                    >
                                      {m === 'efectivo' ? 'Efectivo' : m === 'transferencia' ? 'Transf.' : 'Tarjeta'}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => { if (receiptPayState?.method) void markReceiptPaid(r, receiptPayState.method) }}
                                    disabled={!receiptPayState?.method || receiptConfirming}
                                    className="flex shrink-0 items-center gap-1 rounded-lg bg-[#3d2c24] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                                  >
                                    {receiptConfirming ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                                    OK
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FadeIn>
        )
      )}

      {correctionDialog && (
        <CorrectionDialog
          order={correctionDialog}
          onClose={() => setCorrectionDialog(null)}
          onDone={() => { setCorrectionDialog(null); void fetchOrders() }}
        />
      )}

      {arrivalDialog && (
        <ArrivalDialog
          order={arrivalDialog}
          supplier={suppliers.find((s) => s.id === arrivalDialog.supplier_id) ?? null}
          stockItems={stockItems}
          onClose={() => setArrivalDialog(null)}
          onDone={() => { setArrivalDialog(null); void fetchOrders(); void fetchSugerencias(true) }}
        />
      )}

      {newOrderOpen && (
        <NewOrderDialog suppliers={suppliers} stockItems={stockItems} onClose={() => setNewOrderOpen(false)} onDone={() => { setNewOrderOpen(false); void fetchOrders() }} />
      )}

      <Dialog open={Boolean(assignDialog)} onOpenChange={() => setAssignDialog(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle>Asignar proveedor</DialogTitle></DialogHeader>
          <p className="mb-3 text-sm text-muted-foreground">{assignDialog?.product_name} — {assignDialog?.quantity}</p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {suppliers.map((s) => (
              <button key={s.id} onClick={() => assignDialog && void assignSupplier(assignDialog, s.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#f8f5f0] active:scale-[0.99]">
                <Package className="size-4 text-[#006d5a]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[#3d2c24]">{s.name}</span>
                  {s.phone && <span className="block text-[10px] text-[#a39e97]">{s.phone}</span>}
                </span>
              </button>
            ))}
          </div>
          <DialogFooter><DialogClose className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground">Cancelar</DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers de presentación
// ---------------------------------------------------------------------------

function groupReceiptsBySupplier(list: ReceiptRow[]) {
  const map = new Map<string, { key: string; name: string; receipts: ReceiptRow[]; total: number }>()
  for (const r of list) {
    const key = r.supplier_id ?? 'none'
    const g = map.get(key) ?? { key, name: r.supplier_name, receipts: [], total: 0 }
    g.receipts.push(r)
    g.total += Number(r.cost_total) || 0
    map.set(key, g)
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

function groupBySupplier(list: Order[], suppliers: Supplier[]) {
  const map = new Map<string, { supplier: Supplier | null; list: Order[] }>()
  for (const o of list) {
    const key = o.supplier_id ?? 'none'
    if (!map.has(key)) map.set(key, { supplier: suppliers.find((s) => s.id === o.supplier_id) ?? null, list: [] })
    map.get(key)!.list.push(o)
  }
  return [...map.values()].sort((a, b) => (a.supplier?.name ?? 'zzz').localeCompare(b.supplier?.name ?? 'zzz'))
}

function OrderRow({ order, who, supplier, muted, children }: { order: Order; who: string; supplier: Supplier | null; muted?: boolean; children?: React.ReactNode }) {
  const when = order.ordered_at ?? order.created_at
  return (
    <div className={cn('px-4 py-3', muted && 'opacity-80')}>
      <div className="flex items-center gap-2.5">
        <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg text-xs text-white', order.source === 'barra' ? 'bg-[#8b5e34]' : 'bg-[#d4943a]')}>
          {order.source === 'barra' ? '☕' : '🍳'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#3d2c24]">{order.product_name}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-[#a39e97]">
            <span className="font-bold text-[#3d2c24]">{order.quantity}</span>
            {supplier && <span>· {supplier.name}</span>}
            <span>· {who}</span>
            <span>· {formatDistanceToNow(new Date(when), { addSuffix: true, locale: es })}</span>
            {order.urgency && order.urgency !== 'normal' && <span className="font-semibold text-[#ea504c]">· {order.urgency}</span>}
          </p>
          {order.note && <p className="mt-0.5 truncate text-[11px] italic text-[#a39e97]">💬 {order.note}</p>}
        </div>
      </div>
      {children && <div className="ml-[42px]">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ArrivalDialog — "Llegó": cerrar el ciclo sin duplicar la carga de Fudo
// ---------------------------------------------------------------------------

type PaymentMethod = 'cuenta_corriente' | 'efectivo' | 'transferencia' | 'tarjeta'

const PAYMENT_METHODS: { key: PaymentMethod; label: string; hint: string }[] = [
  { key: 'cuenta_corriente', label: 'Cuenta corriente', hint: 'Queda en cuentas por pagar' },
  { key: 'efectivo', label: 'Efectivo', hint: 'Pagado en el momento' },
  { key: 'transferencia', label: 'Transferencia', hint: 'Pagado en el momento' },
  { key: 'tarjeta', label: 'Tarjeta', hint: 'Pagado en el momento' },
]

function ArrivalDialog({ order, supplier, stockItems, onClose, onDone }: {
  order: Order
  supplier: Supplier | null
  stockItems: StockLite[]
  onClose: () => void
  onDone: () => void
}) {
  const [stockItemId, setStockItemId] = useState<string | null>(order.stock_item_id)
  const [stockSearch, setStockSearch] = useState('')
  const [receivedQty, setReceivedQty] = useState(order.quantity)
  const [unitCost, setUnitCost] = useState('')
  const [note, setNote] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const mode: 'lve_stock' | 'sin_stock' = stockItemId ? 'lve_stock' : 'sin_stock'
  const selectedStock = stockItems.find((s) => s.id === stockItemId) ?? null
  const filteredStock = stockSearch.length > 1
    ? stockItems.filter((s) => !(s.fudo_product_id && !s.fudo_ingredient_id) && s.name.toLowerCase().includes(stockSearch.toLowerCase())).slice(0, 6)
    : []

  const canConfirm = !!paymentMethod && (mode === 'sin_stock' || (mode === 'lve_stock' && !!stockItemId && !!receivedQty.trim()))

  async function confirm() {
    if (!paymentMethod) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_arrival',
          orderId: order.id,
          source: order.source,
          mode,
          expense: null,
          receivedQty: mode === 'lve_stock' ? receivedQty : null,
          unitCost: unitCost ? parseFloat(unitCost) : null,
          stockItemId: mode === 'lve_stock' ? stockItemId : null,
          note: note.trim() || null,
          paymentMethod,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? 'No se pudo confirmar')
      if (mode === 'lve_stock') {
        toast.success(json.fudoSynced ? 'Llegó — stock actualizado' : 'Llegó — stock registrado en LVE')
      } else {
        toast.success('Llegó — pedido cerrado')
      }
      if (paymentMethod === 'cuenta_corriente') toast.info('Quedó en Pagos pendiente de saldar')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al confirmar')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle className="text-base">Llegó el pedido</DialogTitle></DialogHeader>
        <div className="max-h-[80vh] space-y-4 overflow-y-auto pr-0.5">

          {/* Producto */}
          <div className="rounded-xl bg-[#f3efe9] px-3 py-2.5">
            <p className="text-sm font-semibold text-[#3d2c24]">{order.product_name}</p>
            <p className="text-[11px] text-[#7d6c64]">Pedido: <b>{order.quantity}</b>{supplier ? ` · ${supplier.name}` : ''}</p>
          </div>

          {/* Medio de pago — PRIMERA PREGUNTA */}
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-[#3d2c24]">
              ¿Cómo se paga? <span className="text-[#ea504c]">*</span>
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.key}
                  type="button"
                  onClick={() => setPaymentMethod(paymentMethod === pm.key ? null : pm.key)}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-left transition-all',
                    paymentMethod === pm.key
                      ? pm.key === 'cuenta_corriente'
                        ? 'border-[#d4943a] bg-[#fdf6ec]'
                        : 'border-[#006d5a] bg-[#e8f5f1]'
                      : 'border-[#ebe6df] bg-white',
                  )}
                >
                  <span className={cn(
                    'block text-[13px] font-bold',
                    paymentMethod === pm.key
                      ? pm.key === 'cuenta_corriente' ? 'text-[#d4943a]' : 'text-[#006d5a]'
                      : 'text-[#3d2c24]',
                  )}>
                    {pm.label}
                  </span>
                  <span className="block text-[10px] text-[#7d6c64]">{pm.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Stock (si hay insumo vinculado) */}
          {stockItemId ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-[#006d5a] bg-[#e8f5f1] px-3 py-2">
                <Package className="size-4 shrink-0 text-[#006d5a]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#006d5a]">{selectedStock?.name ?? stockItemId}</span>
                  {selectedStock && <span className="block text-[10px] text-[#006d5a]/70">Ahora: {selectedStock.current_qty} {selectedStock.unit}</span>}
                </span>
                <button onClick={() => { setStockItemId(null); setStockSearch('') }} className="text-[#a39e97]"><X className="size-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] font-semibold text-[#3d2c24]">Cantidad <span className="text-[#ea504c]">*</span></span>
                  <input value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} placeholder="ej: 5 kg" className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm focus:border-[#006d5a] focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-[#3d2c24]">$ por {selectedStock?.unit ?? 'unidad'}</span>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#a39e97]">$</span>
                    <input type="number" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" className="w-full rounded-xl border border-[#ebe6df] bg-white py-2 pl-7 pr-3 text-sm focus:border-[#006d5a] focus:outline-none" />
                  </div>
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold text-[#3d2c24]">Insumo <span className="font-normal text-[#a39e97]">(si aplica — para actualizar stock)</span></p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
                  <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder={`Buscar "${order.product_name}"…`} className="w-full rounded-xl border border-[#ebe6df] bg-white py-2 pl-8 pr-3 text-sm focus:border-[#006d5a] focus:outline-none" />
                  {filteredStock.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-xl border border-[#ebe6df] bg-white shadow-lg">
                      {filteredStock.map((s) => (
                        <button key={s.id} type="button" onClick={() => { setStockItemId(s.id); setStockSearch('') }} className="flex w-full items-center gap-2 px-3 py-2 text-left first:rounded-t-xl last:rounded-b-xl hover:bg-[#f8f5f0]">
                          <span className="flex-1 truncate text-sm font-medium text-[#3d2c24]">{s.name}</span>
                          <span className="text-[10px] text-[#a39e97]">{s.current_qty} {s.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold text-[#3d2c24]">Monto <span className="font-normal text-[#a39e97]">(opcional)</span></p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#a39e97]">$</span>
                  <input type="number" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" className="w-full rounded-xl border border-[#ebe6df] bg-white py-2 pl-7 pr-3 text-sm focus:border-[#006d5a] focus:outline-none" />
                </div>
              </div>
            </div>
          )}

          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Nota (opcional): faltó algo, vino distinto…" className="w-full resize-none rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none" />
        </div>
        <DialogFooter className="mt-2 gap-2">
          <DialogClose className="rounded-xl px-4 py-2 text-sm font-medium text-[#7d6c64]">Cancelar</DialogClose>
          <button
            onClick={() => void confirm()}
            disabled={submitting || !canConfirm}
            className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Confirmar llegada
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// NewOrderDialog — pedido manual (lo que el motor no ve: extras, eventos)
// ---------------------------------------------------------------------------

type OrderItemDraft = { id: string; productName: string; quantity: string; stockItemId: string | null }

function NewOrderDialog({ suppliers, stockItems, onClose, onDone }: { suppliers: Supplier[]; stockItems: StockLite[]; onClose: () => void; onDone: () => void }) {
  const makeItem = (): OrderItemDraft => ({ id: Math.random().toString(36).slice(2), productName: '', quantity: '', stockItemId: null })
  const [items, setItems] = useState<OrderItemDraft[]>([makeItem()])
  const [urgency, setUrgency] = useState<'normal' | 'alta' | 'urgente'>('normal')
  const [supplierId, setSupplierId] = useState('')
  const [note, setNote] = useState('')
  const [alreadySent, setAlreadySent] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [searches, setSearches] = useState<Record<string, string>>({})

  const update = (id: string, patch: Partial<OrderItemDraft>) => setItems((p) => p.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  const filtered = (id: string) => {
    const q = (searches[id] ?? '').toLowerCase()
    if (q.length <= 1) return []
    return stockItems
      .filter((s) => {
        // Excluir productos Fudo (platos del menú): tienen fudo_product_id pero no fudo_ingredient_id
        if (s.fudo_product_id && !s.fudo_ingredient_id) return false
        return s.name.toLowerCase().includes(q)
      })
      .slice(0, 6)
  }
  const canSubmit = items.every((it) => it.productName.trim() && it.quantity.trim())

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_order',
          items: items.map((it) => ({ product_name: it.productName.trim(), quantity: it.quantity.trim(), stock_item_id: it.stockItemId })),
          urgency,
          note: note.trim() || undefined,
          supplier_id: supplierId || undefined,
          initial_status: alreadySent ? 'ordered' : 'pending',
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al crear pedido')
      toast.success(`Pedido creado — ${items.length} ítem${items.length > 1 ? 's' : ''}${alreadySent ? ' (en camino)' : ''}`)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear pedido')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle className="text-base">Pedido manual</DialogTitle></DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-0.5">
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={item.id} className="space-y-2 rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-[18px] text-center text-[10px] font-bold text-[#a39e97]">{idx + 1}</span>
                  <div className="relative flex-1">
                    <input
                      value={item.productName}
                      onChange={(e) => { update(item.id, { productName: e.target.value, stockItemId: null }); setSearches((p) => ({ ...p, [item.id]: e.target.value })) }}
                      placeholder="Insumo…"
                      className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-1.5 text-sm text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none"
                    />
                    {!item.stockItemId && filtered(item.id).length > 0 && (
                      <div className="absolute z-20 mt-1 w-full rounded-xl border border-[#ebe6df] bg-white shadow-lg">
                        {filtered(item.id).map((s) => (
                          <button key={s.id} type="button" onClick={() => { update(item.id, { productName: s.name, stockItemId: s.id }); setSearches((p) => ({ ...p, [item.id]: '' })) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left first:rounded-t-xl last:rounded-b-xl hover:bg-[#f8f5f0]">
                            <Package className="size-3 shrink-0 text-[#006d5a]" />
                            <span className="flex-1 truncate text-xs font-medium text-[#3d2c24]">{s.name}</span>
                            <span className="shrink-0 text-[9px] text-[#a39e97]">{s.current_qty} {s.unit}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems((p) => p.filter((it) => it.id !== item.id))} className="shrink-0 rounded-lg p-1 text-[#a39e97] hover:bg-[#fef2f2] hover:text-[#ea504c]"><Trash2 className="size-3.5" /></button>
                  )}
                </div>
                <input value={item.quantity} onChange={(e) => update(item.id, { quantity: e.target.value })} placeholder="Cantidad — ej: 5 kg, 3 unidades" className="ml-6 w-[calc(100%-1.5rem)] rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-1.5 text-sm text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none" />
              </div>
            ))}
            <button type="button" onClick={() => setItems((p) => [...p, makeItem()])} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#ebe6df] py-2 text-xs font-semibold text-[#a39e97] hover:border-[#006d5a] hover:text-[#006d5a]">
              <Plus className="size-3.5" /> Agregar ítem
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {([['normal', 'Normal', '#006d5a', '#e8f5f1'], ['alta', 'Alta', '#d4943a', '#fdf6ec'], ['urgente', 'Urgente', '#ea504c', '#fef2f2']] as const).map(([key, label, color, bg]) => (
              <button key={key} type="button" onClick={() => setUrgency(key)} className="rounded-xl border py-2 text-xs font-semibold" style={urgency === key ? { color, backgroundColor: bg, borderColor: color } : { color: '#a39e97', borderColor: '#ebe6df', backgroundColor: 'white' }}>{label}</button>
            ))}
          </div>

          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none">
            <option value="">Proveedor (opcional)</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <label className="flex items-center gap-2 rounded-xl bg-[#faf8f5] px-3 py-2 text-[12px] text-[#3d2c24]">
            <input type="checkbox" checked={alreadySent} onChange={(e) => setAlreadySent(e.target.checked)} className="size-4 accent-[#006d5a]" />
            Ya se lo pedí al proveedor (queda en camino)
          </label>

          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Nota (opcional)" className="w-full resize-none rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none" />
        </div>
        <DialogFooter className="mt-2 gap-2">
          <DialogClose className="rounded-xl px-4 py-2 text-sm font-medium text-[#7d6c64]">Cancelar</DialogClose>
          <button onClick={() => void submit()} disabled={submitting || !canSubmit} className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}
            Crear
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// CorrectionDialog — corregir o anular una recepción ya registrada
// ---------------------------------------------------------------------------

type ReceiptData = {
  id: number
  qty: number
  unit: string | null
  cost_total: number | null
  note: string | null
  stock_item_id: string | null
}

function CorrectionDialog({ order, onClose, onDone }: {
  order: Order
  onClose: () => void
  onDone: () => void
}) {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [loadingReceipt, setLoadingReceipt] = useState(true)
  const [qty, setQty] = useState('')
  const [costTotal, setCostTotal] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('stock_receipts')
      .select('id, qty, unit, cost_total, note, stock_item_id')
      .eq('order_id', order.id)
      .eq('order_source', order.source)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const r = data as ReceiptData | null
        setReceipt(r)
        if (r) {
          setQty(String(r.qty))
          setCostTotal(r.cost_total != null ? String(r.cost_total) : '')
          setNote(r.note ?? '')
        }
        setLoadingReceipt(false)
      })
  }, [order.id, order.source])

  async function save() {
    if (!receipt) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      const newQty = parseFloat(qty)
      if (!isNaN(newQty) && newQty > 0 && Math.abs(newQty - receipt.qty) > 0.001) body.qty = newQty
      const newCost = parseFloat(costTotal)
      if (!isNaN(newCost) && newCost !== receipt.cost_total) body.cost_total = newCost
      const trimNote = note.trim()
      if (trimNote !== (receipt.note ?? '')) body.note = trimNote || null
      if (Object.keys(body).length === 0) { onClose(); return }
      const res = await fetch(`/api/stock/receipts/${receipt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Error al guardar')
      toast.success('Recepción corregida')
      if (json.fudoSynced === false && body.qty !== undefined) toast.info('Stock ajustado solo en LVE (insumo sin mapeo Fudo)')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  async function undoReceipt() {
    setDeleting(true)
    try {
      if (!receipt) {
        // Sin recibo: solo devolver el pedido a "ordered" directamente
        const supabase = createClient()
        const table = order.source === 'barra' ? 'bar_orders' : 'kitchen_orders'
        const { error } = await supabase.from(table).update({ status: 'ordered', received_by: null, received_at: null, received_qty: null }).eq('id', order.id)
        if (error) throw error
        toast.success('Pedido devuelto a "en camino"')
      } else {
        const res = await fetch(`/api/stock/receipts/${receipt.id}`, { method: 'DELETE' })
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Error al anular')
        const msg = json.stockReversed
          ? json.fudoReversed ? 'Anulado — stock revertido en Fudo y LVE' : 'Anulado — stock revertido en LVE'
          : 'Recepción anulada — pedido volvió a "en camino"'
        toast.success(msg)
      }
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al anular')
    } finally { setDeleting(false) }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Pencil className="size-4 text-[#a39e97]" />
            Corregir recepción
          </DialogTitle>
        </DialogHeader>

        {loadingReceipt ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-[#a39e97]" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl bg-[#f3efe9] px-3 py-2.5">
              <p className="text-sm font-semibold text-[#3d2c24]">{order.product_name}</p>
              {receipt ? (
                <p className="text-[11px] text-[#7d6c64]">
                  Recibo #{receipt.id} · {receipt.qty} {receipt.unit ?? 'u'}
                  {receipt.cost_total != null ? ` · $${Number(receipt.cost_total).toLocaleString('es-AR')}` : ''}
                </p>
              ) : (
                <p className="text-[11px] text-[#a39e97]">Sin recibo de stock en LVE</p>
              )}
            </div>

            {receipt && (
              <>
                {order.received_mode === 'lve_stock' && (
                  <label className="block">
                    <span className="text-[11px] font-semibold text-[#3d2c24]">
                      Cantidad {receipt.unit ? `(${receipt.unit})` : ''}
                    </span>
                    <input
                      type="number" min="0.001" step="any" value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm focus:border-[#006d5a] focus:outline-none"
                    />
                    {receipt.stock_item_id && (
                      <p className="mt-0.5 text-[10px] text-[#a39e97]">
                        Cambiar la cantidad ajusta el stock en Fudo/LVE.
                      </p>
                    )}
                  </label>
                )}

                <label className="block">
                  <span className="text-[11px] font-semibold text-[#3d2c24]">
                    Monto total <span className="font-normal text-[#a39e97]">(opcional)</span>
                  </span>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#a39e97]">$</span>
                    <input
                      type="number" min="0" value={costTotal}
                      onChange={(e) => setCostTotal(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-xl border border-[#ebe6df] bg-white py-2 pl-7 pr-3 text-sm focus:border-[#006d5a] focus:outline-none"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="text-[11px] font-semibold text-[#3d2c24]">Nota</span>
                  <input
                    value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Corrección, motivo, etc."
                    className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm focus:border-[#006d5a] focus:outline-none"
                  />
                </label>

                <button
                  onClick={() => void save()} disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Guardar cambios
                </button>
              </>
            )}

            <div className={cn('pt-2', receipt ? 'border-t border-[#f3efe9]' : '')}>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#faf8f5] py-2.5 text-sm font-semibold text-[#ea504c]"
                >
                  <Trash2 className="size-4" />
                  {receipt ? 'Anular recepción completa' : 'Devolver a "en camino"'}
                </button>
              ) : (
                <div className="space-y-2 rounded-xl bg-[#fef2f2] p-3">
                  <p className="text-[12px] font-semibold text-[#ea504c]">
                    {receipt?.stock_item_id
                      ? '¿Seguro? Revierte el stock y el pedido vuelve a "en camino".'
                      : '¿Seguro? El pedido vuelve a "en camino".'}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-xl border border-[#ebe6df] py-2 text-[12px] font-semibold text-[#7d6c64]"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => void undoReceipt()} disabled={deleting}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-[#ea504c] py-2 text-[12px] font-semibold text-white disabled:opacity-60"
                    >
                      {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Sí, anular
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
