'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  X,
  ChevronRight,
  History,
  User,
  Clock,
  Settings2,
  Loader2,
  ClipboardCheck,
  Trash2,
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logAuditClient } from '@/lib/audit'
import type { StockItem } from '@/lib/hooks/use-stock'
import {
  COLORS,
  getSemaphore,
  getStockSource,
  isPerishableForUi,
  formatQty,
  getVariance,
  needsVarianceNote,
  type WasteReason,
} from '@/lib/stock/helpers'
import { MetadataEditor } from './MetadataEditor'

type StockLog = {
  id: number
  old_qty: number | null
  new_qty: number | null
  created_at: string
  profiles?: { first_name: string; last_name: string } | null
}

type StockMovement = {
  id: string
  change: number
  movement_type: string
  reason: string | null
  note: string | null
  created_at: string | null
  profiles?: { first_name: string; last_name: string } | null
}

type Props = {
  item: StockItem
  isEncargado: boolean
  fudoState: 'checking' | 'ok' | 'warning' | 'error'
  profile: { id: string; first_name: string | null } | null
  countOpen: boolean
  wasteOpen: boolean
  metaOpen: boolean
  onRequestCount: () => void
  onCloseCount: () => void
  onRequestWaste: () => void
  onCloseWaste: () => void
  onToggleMeta: () => void
  onUpdated: () => void
}

const WASTE_REASON_OPTIONS: { value: WasteReason; label: string }[] = [
  { value: 'vencido', label: 'Venció' },
  { value: 'roto', label: 'Roto / dañado' },
  { value: 'consumo_interno', label: 'Consumo interno' },
  { value: 'otro', label: 'Otro' },
]

export function StockItemRow({
  item,
  isEncargado,
  fudoState,
  profile,
  countOpen,
  wasteOpen,
  metaOpen,
  onRequestCount,
  onCloseCount,
  onRequestWaste,
  onCloseWaste,
  onToggleMeta,
  onUpdated,
}: Props) {
  const [editQty, setEditQty] = useState('')
  const [countNote, setCountNote] = useState('')

  const [wasteQty, setWasteQty] = useState('')
  const [wasteReason, setWasteReason] = useState<WasteReason | ''>('')
  const [wasteNote, setWasteNote] = useState('')
  const [savingWaste, setSavingWaste] = useState(false)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyTab, setHistoryTab] = useState<'movimientos' | 'conteos'>('movimientos')
  const [historyLogs, setHistoryLogs] = useState<StockLog[]>([])
  const [historyMovements, setHistoryMovements] = useState<StockMovement[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const s = getSemaphore(item)
  const c = COLORS[s]
  const isEditing = countOpen
  const source = getStockSource(item)

  const handleCountSave = async () => {
    const newQty = parseFloat(editQty)
    if (isNaN(newQty) || newQty < 0) { toast.error('Cantidad inválida'); return }
    if (Math.abs(newQty - item.current_qty) < 0.001) {
      toast.info('Sin cambios de stock')
      onCloseCount()
      setEditQty('')
      setCountNote('')
      return
    }
    const note = countNote.trim()
    if (needsVarianceNote(item, newQty) && note.length < 6) {
      toast.error('La diferencia es relevante: agregá una nota corta del conteo')
      return
    }
    if (source.kind === 'fudo' && (fudoState === 'checking' || fudoState === 'error')) {
      toast.error('Stock bloqueado: primero hay que reconectar con Fudo')
      return
    }
    try {
      const res = await fetch('/api/stock/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId: item.id, newQty, reason: 'physical_count', note }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || data.message)

      logAuditClient({
        userId: profile?.id ?? null,
        userName: profile?.first_name ?? null,
        action: 'update_stock_qty',
        module: 'stock',
        entityType: 'stock_item',
        entityId: item.id,
        description: `${profile?.first_name ?? 'User'} actualizó stock de ${item.name}: ${item.current_qty} -> ${newQty} ${item.unit ?? 'unidad'}`,
      })

      if (data.fudoSynced) {
        toast.success('Stock actualizado — sincronizado con Fudo ✓')
      } else {
        toast.success('Stock actualizado')
      }
      onCloseCount()
      setEditQty('')
      setCountNote('')
      onUpdated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  const handleWasteSaveAction = async () => {
    const qty = parseFloat(wasteQty)
    if (isNaN(qty) || qty <= 0) { toast.error('Cantidad de merma inválida'); return }
    if (!wasteReason) { toast.error('Seleccioná un motivo de merma'); return }
    if (qty > item.current_qty + 0.001) {
      toast.error(`No podés dar de baja más de lo que hay (${formatQty(item.current_qty)} ${item.unit})`)
      return
    }
    setSavingWaste(true)
    try {
      const res = await fetch('/api/stock/waste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId: item.id, qty, wasteReason, note: wasteNote.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar la merma')
      logAuditClient({
        userId: profile?.id ?? null,
        userName: profile?.first_name ?? null,
        action: 'register_waste',
        module: 'stock',
        entityType: 'stock_item',
        entityId: item.id,
        description: `Merma ${formatQty(qty)} ${item.unit} de ${item.name} (${wasteReason})`,
      })
      toast.success(data.fudoSynced ? 'Merma registrada y sincronizada con Fudo ✓' : 'Merma registrada')
      onCloseWaste()
      setWasteQty('')
      setWasteReason('')
      setWasteNote('')
      onUpdated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar merma')
    } finally {
      setSavingWaste(false)
    }
  }

  const toggleHistory = async () => {
    if (historyOpen) { setHistoryOpen(false); return }
    setHistoryOpen(true)
    setLoadingHistory(true)
    const supabase = createClient()
    const [logsRes, movRes] = await Promise.all([
      supabase
        .from('stock_logs')
        .select('id, old_qty, new_qty, created_at, profiles:user_id(first_name, last_name)')
        .eq('stock_item_id', item.id)
        .order('created_at', { ascending: false })
        .limit(15),
      fetch(`/api/stock/movements?itemId=${item.id}&limit=20`).then(r => r.json()).catch(() => ({ movements: [] })),
    ])
    setHistoryLogs((logsRes.data as unknown as StockLog[]) ?? [])
    setHistoryMovements((movRes.movements ?? []) as StockMovement[])
    setLoadingHistory(false)
  }

  // Physical count editor
  const countedQty = parseFloat(editQty)
  const hasCount = !Number.isNaN(countedQty) && countedQty >= 0
  const variance = hasCount ? getVariance(item, countedQty) : null
  const noteRequired = hasCount ? needsVarianceNote(item, countedQty) : false

  return (
    <div
      key={item.id}
      className="overflow-hidden rounded-[1.15rem] border border-[#ebe6df] bg-white transition hover:border-[#d8cfc6] hover:shadow-sm"
      style={{ borderLeftWidth: 3, borderLeftColor: c.border.replace('border-[', '').replace(']', '') }}
    >
      <div className="flex items-center px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {/* El nombre es la puerta a la ficha del insumo (todo sobre este item) */}
          <Link
            href={`/stock/item/${item.id}`}
            className="group flex items-center gap-1 truncate text-sm font-bold text-[#3d2c24] transition-colors hover:text-[#006d5a]"
          >
            <span className="truncate">{item.name}</span>
            <ChevronRight className="size-3 shrink-0 text-[#c8bfb6] transition-colors group-hover:text-[#006d5a]" />
          </Link>
          {item.suppliers?.name && (
            <p className="truncate text-[10px] text-[#a39e97]">{item.suppliers.name}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${source.tone}`}>
              {source.label}
            </span>
            {item.shelf_life_days != null ? (
              <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[9px] font-bold text-[#d4943a]">
                Vida util {item.shelf_life_days}d
              </span>
            ) : isPerishableForUi(item) ? (
              <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[9px] font-bold text-[#ea504c]">
                Sin vida util
              </span>
            ) : null}
            {item.current_qty < 0 && (
              <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[9px] font-bold text-[#ea504c]">
                {getStockSource(item).kind === 'fudo' ? 'Negativo en Fudo — contar' : 'Negativo — contar'}
              </span>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="ml-2 flex items-center gap-1">
            <span className="rounded-lg bg-[#e8f5f1] px-2 py-1 text-[10px] font-bold text-[#006d5a]">
              Contando
            </span>
            <button
              onClick={() => {
                onCloseCount()
                setEditQty('')
                setCountNote('')
              }}
              className="rounded-lg px-1.5 py-1.5 text-[#a39e97]"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <div className="ml-2 flex items-center gap-1">
            <button
              onClick={() => {
                if (!isEncargado) return
                if (source.kind === 'fudo' && (fudoState === 'checking' || fudoState === 'error')) {
                  toast.error('Stock bloqueado: primero hay que reconectar con Fudo')
                  return
                }
                if (!source.actionable) {
                  toast.error('Stock bloqueado: item sin mapeo Fudo ni Local LVE')
                  return
                }
                onCloseWaste()
                onRequestCount()
                setEditQty('')
                setCountNote('')
              }}
              title={source.actionable ? `Editar ${source.label}` : 'Bloqueado: falta mapear a Fudo o marcar Local LVE'}
              className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 ${isEncargado && source.actionable ? 'cursor-pointer bg-[#faf8f5] hover:bg-[#f3efe9] active:scale-95' : ''} ${((source.kind === 'fudo' && (fudoState === 'checking' || fudoState === 'error')) || !source.actionable) ? 'opacity-60' : ''}`}
            >
              <span className={`text-base font-bold tabular-nums ${c.text}`}>{formatQty(item.current_qty)}</span>
              <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
              <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-[#7d6c64] ring-1 ring-[#ebe6df]">
                Contar
              </span>
            </button>
            <button
              onClick={() => void toggleHistory()}
              className="rounded-lg p-1.5 text-[#a39e97] hover:bg-[#f3efe9]"
              title="Ver historial"
            >
              <History className="size-3.5" />
            </button>
            {isEncargado && (
              <button
                onClick={() => {
                  onCloseCount()
                  setEditQty('')
                  setCountNote('')
                  if (wasteOpen) {
                    onCloseWaste()
                  } else {
                    onRequestWaste()
                    setWasteQty('')
                    setWasteReason('')
                    setWasteNote('')
                  }
                }}
                className={`rounded-lg p-1.5 ${wasteOpen ? 'bg-[#fff7f7] text-[#d4943a]' : 'text-[#a39e97] hover:bg-[#f3efe9]'}`}
                title="Registrar merma"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
            <button
              onClick={onToggleMeta}
              className={`rounded-lg p-1.5 ${metaOpen ? 'bg-[#f3efe9] text-[#3d2c24]' : 'text-[#a39e97] hover:bg-[#f3efe9]'}`}
              title="Editar configuración"
            >
              <Settings2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {countOpen && (
        <div className="border-t border-[#ebe6df] bg-[#fbfaf8] px-3 py-3">
          <div className="flex items-start gap-2 rounded-xl bg-white p-3 ring-1 ring-[#ebe6df]">
            <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-[#006d5a]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#3d2c24]">Conteo físico de {item.name}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[#7d6c64]">
                {source.kind === 'fudo'
                  ? 'Primero se escribe en Fudo y solo después se actualiza LVE. Si Fudo no confirma, no se guarda.'
                  : 'Este item es Local LVE: no toca Fudo. Usalo solo para descartables o controles internos.'}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#ebe6df]">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Sistema</p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-[#3d2c24]">
                {formatQty(item.current_qty)}
              </p>
              <p className="text-[10px] text-[#a39e97]">{item.unit}</p>
            </div>

            <label className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#006d5a]/25">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#006d5a]">Conteo real</span>
              <input
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="mt-0.5 w-full bg-transparent text-base font-bold tabular-nums text-[#3d2c24] outline-none placeholder:text-[#c8bfb6]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCountSave()
                  if (e.key === 'Escape') {
                    onCloseCount()
                    setEditQty('')
                    setCountNote('')
                  }
                }}
              />
              <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
            </label>

            <div className={`rounded-xl px-3 py-2 ring-1 ${
              !variance || variance.abs < 0.001
                ? 'bg-[#faf8f5] ring-[#ebe6df]'
                : variance.diff < 0
                  ? 'bg-[#fff7f7] ring-[#f3d0cf]'
                  : 'bg-[#f6fcfa] ring-[#dcefe8]'
            }`}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Diferencia</p>
              <p className={`mt-0.5 text-base font-bold tabular-nums ${
                !variance || variance.abs < 0.001
                  ? 'text-[#7d6c64]'
                  : variance.diff < 0
                    ? 'text-[#ea504c]'
                    : 'text-[#006d5a]'
              }`}>
                {variance ? `${variance.diff > 0 ? '+' : ''}${formatQty(variance.diff)}` : '-'}
              </p>
              <p className="text-[10px] text-[#a39e97]">{item.unit}</p>
            </div>
          </div>

          <label className="mt-3 block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
              Nota del conteo {noteRequired ? '(obligatoria)' : '(opcional)'}
            </span>
            <textarea
              value={countNote}
              onChange={(e) => setCountNote(e.target.value)}
              rows={2}
              placeholder="Ej. conteo cierre, caja abierta, merma detectada, proveedor entregó..."
              className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none"
            />
          </label>

          {noteRequired && (
            <p className="mt-2 rounded-lg bg-[#fff8eb] px-3 py-2 text-[11px] font-semibold text-[#8b5e34]">
              La diferencia supera el margen normal. Dejamos nota para auditar si fue venta, merma, error de carga o diferencia física.
            </p>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                onCloseCount()
                setEditQty('')
                setCountNote('')
              }}
              className="rounded-lg px-3 py-2 text-[11px] font-semibold text-[#7d6c64] hover:bg-[#f3efe9]"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleCountSave()}
              disabled={!hasCount || (noteRequired && countNote.trim().length < 6)}
              className="rounded-lg bg-[#006d5a] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
            >
              Guardar conteo
            </button>
          </div>
        </div>
      )}

      {wasteOpen && (
        <div className="border-t border-[#ebe6df] bg-[#fffaf4] px-3 py-3">
          <div className="flex items-start gap-2 rounded-xl bg-white p-3 ring-1 ring-[#f1dfba]">
            <Trash2 className="mt-0.5 size-4 shrink-0 text-[#d4943a]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#3d2c24]">Registrar merma de {item.name}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[#7d6c64]">
                {source.kind === 'fudo'
                  ? 'Se descuenta del sistema y se sincroniza con Fudo.'
                  : 'Se descuenta del sistema. Este item es Local LVE.'}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#ebe6df]">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Stock actual</p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-[#3d2c24]">{formatQty(item.current_qty)}</p>
              <p className="text-[10px] text-[#a39e97]">{item.unit}</p>
            </div>
            <label className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#f1dfba]">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#d4943a]">Cantidad a dar de baja</span>
              <input
                value={wasteQty}
                onChange={(e) => setWasteQty(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="mt-0.5 w-full bg-transparent text-base font-bold tabular-nums text-[#3d2c24] outline-none placeholder:text-[#c8bfb6]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    onCloseWaste()
                    setWasteQty('')
                    setWasteReason('')
                    setWasteNote('')
                  }
                }}
              />
              <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
            </label>
          </div>

          <div className="mt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Motivo</span>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {WASTE_REASON_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setWasteReason(value)}
                  className={`rounded-xl px-2.5 py-2 text-left text-[11px] font-semibold transition-all ${
                    wasteReason === value
                      ? 'bg-[#3d2c24] text-white'
                      : 'bg-[#faf8f5] text-[#7d6c64] hover:bg-[#f3efe9]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-3 block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Nota (opcional)</span>
            <textarea
              value={wasteNote}
              onChange={(e) => setWasteNote(e.target.value)}
              rows={2}
              placeholder="Ej. encontrado vencido al abrir, se rompió el frasco, degustación..."
              className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none"
            />
          </label>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                onCloseWaste()
                setWasteQty('')
                setWasteReason('')
                setWasteNote('')
              }}
              className="rounded-lg px-3 py-2 text-[11px] font-semibold text-[#7d6c64] hover:bg-[#f3efe9]"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleWasteSaveAction()}
              disabled={savingWaste || !wasteQty || !wasteReason}
              className="flex items-center gap-1.5 rounded-lg bg-[#d4943a] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
            >
              {savingWaste ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Registrar merma
            </button>
          </div>
        </div>
      )}

      {metaOpen && (
        <MetadataEditor
          item={item}
          onSaved={() => { onUpdated(); onToggleMeta() }}
          onCancel={onToggleMeta}
        />
      )}

      {historyOpen && (
        <div className="border-t bg-[#faf8f5] px-3 py-2.5">
          {loadingHistory ? (
            <Loader2 className="size-4 animate-spin text-[#a39e97] mx-auto" />
          ) : (
            <>
              <div className="mb-2 flex gap-1.5">
                {(['movimientos', 'conteos'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setHistoryTab(tab)}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${historyTab === tab ? 'bg-[#3d2c24] text-white' : 'bg-[#ebe6df] text-[#7d6c64]'}`}
                  >
                    {tab === 'movimientos' ? `Movimientos (${historyMovements.length})` : `Conteos (${historyLogs.length})`}
                  </button>
                ))}
              </div>
              {historyTab === 'movimientos' ? (
                historyMovements.length === 0 ? (
                  <p className="text-[11px] text-[#a39e97] text-center">Sin movimientos registrados</p>
                ) : (
                  <div className="space-y-1.5">
                    {historyMovements.map(mv => {
                      const isEntry = mv.change > 0
                      const reasonLabels: Record<string, string> = {
                        compra: 'Compra', merma: 'Merma', waste: 'Merma',
                        produccion_input: 'Producción ↓', produccion_output: 'Producción ↑',
                        manual_adjustment: 'Ajuste', conteo: 'Conteo', sale: 'Venta',
                      }
                      return (
                        <div key={mv.id} className="flex items-start justify-between gap-2 text-[11px]">
                          <div className="min-w-0 flex-1">
                            <span className={`font-bold ${isEntry ? 'text-[#006d5a]' : 'text-[#ea504c]'}`}>
                              {isEntry ? '+' : ''}{mv.change > 0 ? `+${mv.change}` : mv.change}
                            </span>
                            <span className="ml-1.5 rounded-full bg-[#ebe6df] px-1.5 py-0.5 text-[9px] font-semibold text-[#7d6c64]">
                              {reasonLabels[mv.reason as string] ?? mv.reason}
                            </span>
                            {mv.note && <p className="mt-0.5 truncate text-[10px] text-[#a39e97]">{mv.note}</p>}
                          </div>
                          <span className="shrink-0 text-[10px] text-[#a39e97]">
                            {format(new Date(mv.created_at as string), 'd MMM HH:mm', { locale: es })}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              ) : (
                historyLogs.length === 0 ? (
                  <p className="text-[11px] text-[#a39e97] text-center">Sin conteos registrados</p>
                ) : (
                  <div className="space-y-1.5">
                    {historyLogs.map(log => (
                      <div key={log.id} className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <User className="size-2.5 text-[#a39e97]" />
                          <span className="font-medium text-[#3d2c24]">{log.profiles?.first_name ?? '?'}</span>
                          <span className="text-[#a39e97]">{log.old_qty} → {log.new_qty}</span>
                        </div>
                        <span className="flex items-center gap-1 text-[#a39e97]">
                          <Clock className="size-2.5" />
                          {format(new Date(log.created_at), 'd MMM HH:mm', { locale: es })}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
