'use client'

// ---------------------------------------------------------------------------
// /pedidos/cuentas — Cuentas por pagar (manager-only)
// ---------------------------------------------------------------------------
// Gastos de compras agrupados por proveedor: cada recepción de mercadería
// con costo queda registrada como "pagado" o "a pagar". Acá se ven los
// saldos pendientes por proveedor y se saldan recibo por recibo.
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ArrowLeft, Wallet, ChevronDown, ChevronUp, Check,
  Loader2, Package, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { isManagerOrAbove } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { FadeIn } from '@/components/ui/motion'

type Receipt = {
  id: number
  supplier_id: string | null
  qty: number
  unit: string | null
  cost_total: number | null
  note: string | null
  received_date: string
  payment_status: 'pagado' | 'a_pagar'
  paid_at: string | null
  supplier_name: string
}

const fmtMoney = (n: number) => `$${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`

export default function CuentasPage() {
  const { profile } = useProfileContext()
  const [loading, setLoading] = useState(true)
  const [migrationMissing, setMigrationMissing] = useState(false)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [paying, setPaying] = useState<number | null>(null)
  const [showPaid, setShowPaid] = useState(false)

  const canManage = isManagerOrAbove(profile?.role)

  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('stock_receipts')
      .select('id, supplier_id, qty, unit, cost_total, note, received_date, payment_status, paid_at, suppliers:supplier_id(name)')
      .not('cost_total', 'is', null)
      .order('received_at', { ascending: false })
      .limit(300)

    if (error) {
      // Columna payment_status inexistente → migración pendiente
      if (/payment_status|paid_at/.test(error.message)) setMigrationMissing(true)
      setLoading(false)
      return
    }

    setReceipts(((data ?? []) as unknown as (Omit<Receipt, 'supplier_name'> & { suppliers: { name: string } | null })[])
      .map((r) => ({ ...r, supplier_name: r.suppliers?.name ?? 'Sin proveedor' })))
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const pending = useMemo(() => receipts.filter((r) => r.payment_status === 'a_pagar'), [receipts])
  const paid = useMemo(() => receipts.filter((r) => r.payment_status === 'pagado').slice(0, 15), [receipts])
  const totalPending = useMemo(() => pending.reduce((acc, r) => acc + (Number(r.cost_total) || 0), 0), [pending])

  // Agrupar pendientes por proveedor
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; receipts: Receipt[]; total: number }>()
    for (const r of pending) {
      const key = r.supplier_id ?? 'none'
      const g = map.get(key) ?? { name: r.supplier_name, receipts: [], total: 0 }
      g.receipts.push(r)
      g.total += Number(r.cost_total) || 0
      map.set(key, g)
    }
    return Array.from(map.entries())
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.total - a.total)
  }, [pending])

  async function markPaid(receipt: Receipt) {
    setPaying(receipt.id)
    try {
      const res = await fetch(`/api/stock/receipts/${receipt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: 'pagado' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al marcar pagado')
      toast.success(`Pagado — ${receipt.supplier_name}${receipt.cost_total != null ? ` (${fmtMoney(Number(receipt.cost_total))})` : ''}`)
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al marcar pagado')
    } finally {
      setPaying(null)
    }
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-[#006d5a]" /></div>
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <AlertTriangle className="mx-auto size-8 text-[#d4943a]" />
        <p className="mt-3 text-sm font-medium text-[#a39e97]">Solo encargados pueden ver las cuentas por pagar</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-28">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link href="/pedidos" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-[#ebe6df] active:scale-95">
            <ArrowLeft className="size-4 text-[#3d2c24]" />
          </Link>
          <div>
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Cuentas por pagar</h1>
            <p className="section-label mt-0.5">Gastos de compras por proveedor</p>
          </div>
        </div>
      </FadeIn>

      {migrationMissing && (
        <FadeIn>
          <div className="rounded-2xl bg-[#fdf6ec] px-4 py-3 ring-1 ring-[#d4943a]/30">
            <p className="text-sm font-semibold text-[#d4943a]">Falta aplicar la migración de pagos</p>
            <p className="mt-0.5 text-xs text-[#a39e97]">
              Aplicá <code>20260723_receipt_payments.sql</code> en Supabase para habilitar el estado de pago de los gastos.
            </p>
          </div>
        </FadeIn>
      )}

      {/* Saldo total pendiente */}
      {!migrationMissing && (
        <FadeIn delay={0.05}>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#fdf6ec]">
                <Wallet className="size-5 text-[#8b5e34]" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Saldo pendiente</p>
                <p className="font-display text-2xl font-bold tabular-nums text-[#3d2c24]">{fmtMoney(totalPending)}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tabular-nums text-[#d4943a]">{pending.length}</p>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">recibos</p>
              </div>
            </div>
          </div>
        </FadeIn>
      )}

      {/* Grupos por proveedor */}
      {!migrationMissing && groups.map((group) => {
        const isExpanded = expanded === group.key
        return (
          <FadeIn key={group.key}>
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <button
                onClick={() => setExpanded(isExpanded ? null : group.key)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#e8f5f1]">
                  <Package className="size-4 text-[#006d5a]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#3d2c24]">{group.name}</p>
                  <p className="text-[11px] text-[#a39e97]">
                    {group.receipts.length} recibo{group.receipts.length > 1 ? 's' : ''} pendiente{group.receipts.length > 1 ? 's' : ''}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-[#d4943a]">{fmtMoney(group.total)}</span>
                {isExpanded ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
              </button>

              {isExpanded && (
                <div className="divide-y border-t">
                  {group.receipts.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[#3d2c24]">
                          {r.note ?? `${r.qty} ${r.unit ?? ''}`}
                        </p>
                        <p className="text-[10px] text-[#a39e97]">
                          {format(new Date(`${r.received_date}T12:00:00`), "d MMM yyyy", { locale: es })}
                          {' · '}{r.qty} {r.unit ?? 'u'}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-bold tabular-nums text-[#3d2c24]">
                        {fmtMoney(Number(r.cost_total) || 0)}
                      </span>
                      <button
                        onClick={() => markPaid(r)}
                        disabled={paying === r.id}
                        className="flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[11px] font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
                      >
                        {paying === r.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Marcar pagado
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FadeIn>
        )
      })}

      {!migrationMissing && pending.length === 0 && (
        <FadeIn>
          <div className="flex flex-col items-center py-10 text-center">
            <Wallet className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">No hay deudas con proveedores</p>
            <p className="mt-1 text-xs text-[#a39e97]/70">
              Los gastos que se reciban como &quot;a pagar&quot; aparecen acá, agrupados por proveedor
            </p>
          </div>
        </FadeIn>
      )}

      {/* Pagados recientes */}
      {!migrationMissing && paid.length > 0 && (
        <FadeIn>
          <button
            onClick={() => setShowPaid((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 py-1 text-[11px] font-semibold text-[#a39e97]"
          >
            {showPaid ? 'Ocultar pagados recientes' : `Ver pagados recientes (${paid.length})`}
            {showPaid ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          {showPaid && (
            <div className="mt-2 overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <div className="divide-y">
                {paid.map((r) => (
                  <div key={r.id} className={cn('flex items-center gap-3 px-4 py-2.5 opacity-70')}>
                    <Check className="size-3.5 shrink-0 text-[#006d5a]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[#3d2c24]">{r.supplier_name} — {r.note ?? `${r.qty} ${r.unit ?? ''}`}</p>
                      <p className="text-[10px] text-[#a39e97]">
                        Pagado {r.paid_at ? format(new Date(r.paid_at), "d MMM", { locale: es }) : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[#006d5a]">
                      {fmtMoney(Number(r.cost_total) || 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </FadeIn>
      )}
    </div>
  )
}
