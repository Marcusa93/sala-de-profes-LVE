'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, Check, Plus, Trash2,
  Package, AlertTriangle, Loader2, Leaf, TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockItem = {
  id: string
  name: string
  unit: string
  current_qty: number
  shelf_life_days: number | null
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  fudo_skip: boolean | null
}

type Template = {
  id: number
  name: string
  description: string | null
  input_stock_item_id: string | null
  input_unit: string
  input_stock_item: { id: string; name: string; unit: string } | null
  outputs: {
    id: number
    stock_item_id: string | null
    output_name: string
    theoretical_yield_pct: number
    output_unit: string
    is_waste: boolean
    notes: string | null
  }[]
}

type OutputRow = {
  localId: string
  stock_item_id: string | null
  stock_item_name: string
  output_name: string
  qty_produced: string
  theoretical_qty: number | null
  unit: string
  is_waste: boolean
  notes: string
  lot_code: string
  expires_on: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _localId = 0
function nextId() { return `local_${++_localId}` }

function formatQty(n: number) {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(3).replace(/\.?0+$/, '')
}

function toLocalDateInput(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDaysToDateInput(dateInput: string, days: number) {
  if (!dateInput || Number.isNaN(days)) return ''
  const base = new Date(`${dateInput}T00:00:00`)
  if (Number.isNaN(base.getTime())) return ''
  base.setDate(base.getDate() + days)
  return toLocalDateInput(base)
}

function dateInputToIso(dateInput: string) {
  if (!dateInput) return null
  const date = new Date(`${dateInput}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function suggestedExpiryDate(item: Pick<StockItem, 'shelf_life_days'> | null, productionDate: string) {
  if (!item || item.shelf_life_days == null) return ''
  return addDaysToDateInput(productionDate, item.shelf_life_days)
}

function getStockSource(item: StockItem | null) {
  if (!item) return null
  if (item.fudo_product_id) return { label: 'Fudo producto', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true }
  if (item.fudo_ingredient_id) return { label: 'Fudo insumo', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true }
  if (item.fudo_skip === true) return { label: 'Local LVE', tone: 'bg-[#f3efe9] text-[#7d6c64]', actionable: true }
  return { label: 'Sin mapeo Fudo', tone: 'bg-[#fef2f2] text-[#ea504c]', actionable: false }
}

function isStockActionable(item: StockItem | null) {
  return getStockSource(item)?.actionable === true
}

function efficiencyLabel(pct: number | null) {
  if (pct === null) return { text: '—', color: 'text-muted-foreground' }
  if (pct >= 90) return { text: 'Excelente', color: 'text-[#006d5a]' }
  if (pct >= 75) return { text: 'Buena',      color: 'text-[#d4943a]' }
  return { text: 'Baja',       color: 'text-[#ea504c]' }
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-all',
            i < current ? 'bg-[#006d5a]' : i === current ? 'bg-[#006d5a]/60' : 'bg-[#ebe6df]',
          )}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stock item search input
// ---------------------------------------------------------------------------

function StockSearch({
  items,
  value,
  onChange,
  placeholder = 'Buscar insumo...',
  className,
}: {
  items: StockItem[]
  value: StockItem | null
  onChange: (item: StockItem | null) => void
  placeholder?: string
  className?: string
}) {
  const [query, setQuery] = useState(value?.name ?? '')
  const [open, setOpen] = useState(false)

  const filtered = query.length >= 1
    ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : []

  return (
    <div className={cn('relative', className)}>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(null) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-[#ebe6df] bg-white shadow-lg">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(item)
                setQuery(item.name)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] first:rounded-t-xl last:rounded-b-xl hover:bg-[#f5f2ee]"
            >
              <span className="font-medium text-[#3d2c24]">{item.name}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${getStockSource(item)?.tone}`}>
                  {getStockSource(item)?.label}
                </span>
                {formatQty(item.current_qty)} {item.unit}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export default function NuevaProduccionPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)      // 0=insumo, 1=salidas, 2=resumen
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Data
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [templates, setTemplates] = useState<Template[]>([])

  // Step 0 — input
  const [inputItem, setInputItem] = useState<StockItem | null>(null)
  const [inputQty, setInputQty] = useState('')
  const [inputUnit, setInputUnit] = useState('kg')
  const [productionDate, setProductionDate] = useState(() => toLocalDateInput(new Date()))
  const [orderName, setOrderName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [notes, setNotes] = useState('')

  // Step 1 — outputs
  const [outputs, setOutputs] = useState<OutputRow[]>([])
  const previousProductionDate = useRef(productionDate)

  // Load data
  useEffect(() => {
    const load = async () => {
      const [stockRes, tmplRes] = await Promise.all([
        fetch('/api/stock/items?preset=full'),
        fetch('/api/produccion/templates'),
      ])

      if (stockRes.ok) {
        const stockList = await stockRes.json()
        const items: StockItem[] = (stockList.items ?? []).map((i: Record<string, unknown>) => ({
          id: String(i.id),
          name: String(i.name),
          unit: String(i.unit),
          current_qty: Number(i.current_qty ?? 0),
          shelf_life_days: i.shelf_life_days == null ? null : Number(i.shelf_life_days),
          fudo_ingredient_id: i.fudo_ingredient_id == null ? null : String(i.fudo_ingredient_id),
          fudo_product_id: i.fudo_product_id == null ? null : String(i.fudo_product_id),
          fudo_skip: i.fudo_skip == null ? null : Boolean(i.fudo_skip),
        }))
        setStockItems(items)
      }

      if (tmplRes.ok) {
        const tj = await tmplRes.json()
        setTemplates(tj.templates ?? [])
      }
    }
    load()
  }, [])

  // Auto-generate order name
  useEffect(() => {
    if (inputItem) {
      const date = new Date(`${productionDate}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
      setOrderName(`${inputItem.name} — ${date}`)
    }
  }, [inputItem, productionDate])

  // When template selected, set input item and unit
  useEffect(() => {
    if (selectedTemplate) {
      if (selectedTemplate.input_stock_item) {
        const found = stockItems.find((s) => s.id === selectedTemplate.input_stock_item!.id)
        if (found) setInputItem(found)
      }
      setInputUnit(selectedTemplate.input_unit)
    }
  }, [selectedTemplate, stockItems])

  // Pre-fill outputs from template when qty changes
  const applyTemplate = useCallback(() => {
    if (!selectedTemplate || !inputQty) return
    const qty = parseFloat(inputQty)
    if (isNaN(qty) || qty <= 0) return

    const rows: OutputRow[] = selectedTemplate.outputs.map((o) => {
      const linkedItem = stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null

      return {
        localId: nextId(),
        stock_item_id: o.stock_item_id,
        stock_item_name: linkedItem?.name ?? '',
        output_name: o.output_name,
        qty_produced: (qty * o.theoretical_yield_pct / 100).toFixed(3),
        theoretical_qty: qty * o.theoretical_yield_pct / 100,
        unit: linkedItem?.unit ?? o.output_unit,
        is_waste: o.is_waste,
        notes: o.notes ?? '',
        lot_code: '',
        expires_on: o.is_waste ? '' : suggestedExpiryDate(linkedItem, productionDate),
      }
    })
    setOutputs(rows)
  }, [inputQty, productionDate, selectedTemplate, stockItems])

  useEffect(() => {
    const previousDate = previousProductionDate.current
    if (previousDate === productionDate) return

    setOutputs((current) => current.map((output) => {
      if (output.is_waste || !output.stock_item_id) return output

      const linkedItem = stockItems.find((stockItem) => stockItem.id === output.stock_item_id) ?? null
      if (!linkedItem || linkedItem.shelf_life_days == null) return output

      const previousSuggestion = suggestedExpiryDate(linkedItem, previousDate)
      const nextSuggestion = suggestedExpiryDate(linkedItem, productionDate)

      if (!output.expires_on || output.expires_on === previousSuggestion) {
        return { ...output, expires_on: nextSuggestion }
      }

      return output
    }))

    previousProductionDate.current = productionDate
  }, [productionDate, stockItems])

  // ── Step 0 validation ──
  const step0Valid = Boolean(inputItem && isStockActionable(inputItem) && parseFloat(inputQty) > 0 && orderName.trim() && productionDate)

  // ── Step 1 helpers ──
  const totalOutputQty = outputs.reduce((s, o) => {
    const q = parseFloat(o.qty_produced)
    return s + (isNaN(q) ? 0 : q)
  }, 0)
  const totalInputQty = parseFloat(inputQty) || 0
  const balance = totalInputQty - totalOutputQty
  const balanceOk = Math.abs(balance) < 0.001
  const efficiency = totalInputQty > 0
    ? Math.round((1 - outputs.filter((o) => o.is_waste).reduce((s, o) => s + (parseFloat(o.qty_produced) || 0), 0) / totalInputQty) * 1000) / 10
    : null

  function addOutput(isWaste = false) {
    setOutputs((prev) => [...prev, {
      localId: nextId(),
      stock_item_id: null,
      stock_item_name: '',
      output_name: isWaste ? 'Merma' : '',
      qty_produced: '',
      theoretical_qty: null,
      unit: inputUnit,
      is_waste: isWaste,
      notes: '',
      lot_code: '',
      expires_on: '',
    }])
  }

  function updateOutput(localId: string, patch: Partial<OutputRow>) {
    setOutputs((prev) => prev.map((o) => o.localId === localId ? { ...o, ...patch } : o))
  }

  function removeOutput(localId: string) {
    setOutputs((prev) => prev.filter((o) => o.localId !== localId))
  }

  const step1Valid = outputs.length > 0 && outputs.every((o) => {
    const linkedItem = o.stock_item_id ? stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null : null
    return o.output_name
      && parseFloat(o.qty_produced) >= 0
      && (o.is_waste || !linkedItem || isStockActionable(linkedItem))
  })

  // ── Submit ──
  async function handleConfirm() {
    if (!isStockActionable(inputItem)) {
      setError('Producción bloqueada: el insumo madre no está mapeado a Fudo ni marcado como Local LVE.')
      return
    }
    const blockedOutputs = outputs
      .filter((o) => !o.is_waste && o.stock_item_id)
      .map((o) => stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null)
      .filter((item): item is StockItem => Boolean(item && !isStockActionable(item)))
    if (blockedOutputs.length > 0) {
      setError(`Producción bloqueada: salidas sin mapeo Fudo/Local LVE (${blockedOutputs.map((item) => item.name).join(', ')}).`)
      return
    }
    const ok = window.confirm('Esto va a actualizar el stock. ¿Confirmar producción?')
    if (!ok) return
    setSaving(true)
    setError(null)
    try {
      // Single request: create order + add inputs/outputs + complete
      const res = await fetch('/api/produccion/orders/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: orderName,
          template_id: selectedTemplate?.id ?? null,
          notes: notes || null,
          input: {
            stock_item_id: inputItem!.id,
            qty_used: parseFloat(inputQty),
            unit: inputUnit,
          },
          outputs: outputs
            .filter((o) => o.output_name && !isNaN(parseFloat(o.qty_produced)))
            .map((o) => ({
              stock_item_id: o.stock_item_id,
              output_name: o.output_name,
              qty_produced: parseFloat(o.qty_produced),
              theoretical_qty: o.theoretical_qty,
              unit: o.unit,
              is_waste: o.is_waste,
              notes: o.notes || null,
              lot_code: o.lot_code.trim() || null,
              produced_at: dateInputToIso(productionDate),
              expires_at: o.expires_on ? dateInputToIso(o.expires_on) : null,
            })),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Error al procesar la producción')
      }

      // Success — navigate to list
      router.push('/cocina/produccion')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  const STEPS = [
    {
      label: 'Qué entra',
      title: 'Elegí el insumo que sale del stock',
      help: 'Este paso descuenta mercadería. Si el item no está vinculado a Fudo ni marcado como Local LVE, la producción queda bloqueada.',
    },
    {
      label: 'Qué sale',
      title: 'Cargá productos obtenidos, merma y vencimientos',
      help: 'Vinculá cada salida a su item de stock cuando corresponda. LVE suma stock, registra lotes y respeta la fuente Fudo/Local.',
    },
    {
      label: 'Impacto',
      title: 'Revisá exactamente qué stock cambia',
      help: 'Antes de confirmar, validá entrada, salidas, balance, lote y origen. Si algo depende de Fudo, se sincroniza desde la confirmación.',
    },
  ]
  const currentStep = STEPS[step]

  return (
    <div className="min-h-screen bg-[#faf8f5] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#ebe6df] bg-[#faf8f5]/95 backdrop-blur-md">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => step === 0 ? router.back() : setStep(step - 1)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {currentStep.label}
              </p>
              <p className="text-[15px] font-bold text-[#3d2c24]">Nueva producción</p>
            </div>
            <span className="text-[12px] font-medium text-muted-foreground">
              {step + 1}/{STEPS.length}
            </span>
          </div>
          <div className="mt-2">
            <StepIndicator current={step} total={STEPS.length} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-4">
        <FadeIn>
          <div className="mb-4 rounded-2xl border border-[#ebe6df] bg-white p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#006d5a]">
              Paso {step + 1}: {currentStep.label}
            </p>
            <h2 className="mt-1 text-[16px] font-bold text-[#3d2c24]">{currentStep.title}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#7d6c64]">{currentStep.help}</p>
          </div>
        </FadeIn>

        {/* ── STEP 0: Insumo ── */}
        {step === 0 && (
          <FadeIn>
            <div className="space-y-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <h2 className="mb-3 text-[13px] font-semibold text-[#3d2c24]">Template (opcional)</h2>
                <select
                  value={selectedTemplate?.id ?? ''}
                  onChange={(e) => {
                    const tmpl = templates.find((t) => t.id === Number(e.target.value)) ?? null
                    setSelectedTemplate(tmpl)
                  }}
                  className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                >
                  <option value="">Sin template — registro libre</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {selectedTemplate?.description && (
                  <p className="mt-1.5 text-[12px] text-muted-foreground">{selectedTemplate.description}</p>
                )}
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <h2 className="mb-3 text-[13px] font-semibold text-[#3d2c24]">¿Qué vas a procesar?</h2>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Insumo madre</label>
                    <StockSearch
                      key={inputItem?.id ?? 'input-empty'}
                      items={stockItems}
                      value={inputItem}
                      onChange={setInputItem}
                      placeholder="Buscar insumo (ej: Nalga)..."
                    />
                    {inputItem && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>Stock actual: {formatQty(inputItem.current_qty)} {inputItem.unit}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${getStockSource(inputItem)?.tone}`}>
                          {getStockSource(inputItem)?.label}
                        </span>
                      </div>
                    )}
                    {inputItem && !isStockActionable(inputItem) && (
                      <p className="mt-1 rounded-xl bg-[#fff7f7] px-3 py-2 text-[11px] font-semibold text-[#ea504c]">
                        No se puede producir con este insumo hasta mapearlo a Fudo o marcarlo como Local LVE.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Cantidad</label>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={inputQty}
                        onChange={(e) => setInputQty(e.target.value)}
                        placeholder="0.000"
                        className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Unidad</label>
                      <select
                        value={inputUnit}
                        onChange={(e) => setInputUnit(e.target.value)}
                        className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                      >
                        {['kg', 'g', 'lt', 'ml', 'unidad', 'atado', 'bandeja'].map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Fecha de elaboracion</label>
                    <input
                      type="date"
                      value={productionDate}
                      onChange={(e) => setProductionDate(e.target.value)}
                      className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Se usa para sugerir vencimientos y crear el lote en LVE.
                    </p>
                  </div>

                  {inputItem && parseFloat(inputQty) > inputItem.current_qty && (
                    <div className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-[#ea504c]">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      Cantidad mayor al stock disponible ({formatQty(inputItem.current_qty)} {inputItem.unit})
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <h2 className="mb-3 text-[13px] font-semibold text-[#3d2c24]">Nombre de la producción</h2>
                <input
                  type="text"
                  value={orderName}
                  onChange={(e) => setOrderName(e.target.value)}
                  placeholder="Ej: Despiece nalga — 4 abr"
                  className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                />
                <div className="mt-3">
                  <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Notas (opcional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Observaciones, lote, etc."
                    className="w-full resize-none rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                  />
                </div>
              </div>
            </div>
          </FadeIn>
        )}

        {/* ── STEP 1: Salidas ── */}
        {step === 1 && (
          <FadeIn>
            <div className="space-y-3">
              {/* Input summary */}
              <div className="flex items-center gap-2 rounded-xl bg-[#e8f5f1] px-3 py-2">
                <Package className="size-4 text-[#006d5a]" />
                <span className="text-[13px] font-semibold text-[#006d5a]">
                  Entrada: {formatQty(totalInputQty)} {inputUnit} de {inputItem?.name}
                </span>
              </div>

              {/* Balance indicator */}
              {totalOutputQty > 0 && (
                <div className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium',
                  balanceOk
                    ? 'bg-[#e8f5f1] text-[#006d5a]'
                    : Math.abs(balance) < 0.05
                    ? 'bg-amber-50 text-[#d4943a]'
                    : 'bg-red-50 text-[#ea504c]',
                )}>
                  {balanceOk
                    ? <Check className="size-3.5" />
                    : <AlertTriangle className="size-3.5" />}
                  {balanceOk
                    ? 'Balance cerrado ✓'
                    : balance > 0
                    ? `Faltan ${formatQty(balance)} ${inputUnit} en salidas`
                    : `Exceso de ${formatQty(-balance)} ${inputUnit}`}
                  <span className="ml-auto">
                    {formatQty(totalOutputQty)}/{formatQty(totalInputQty)} {inputUnit}
                  </span>
                </div>
              )}

              {/* Template pre-fill button */}
              {selectedTemplate && outputs.length === 0 && (
                <button
                  onClick={applyTemplate}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#006d5a]/40 bg-[#006d5a]/5 py-3 text-[13px] font-medium text-[#006d5a]"
                >
                  <TrendingUp className="size-4" />
                  Cargar salidas del template &quot;{selectedTemplate.name}&quot;
                </button>
              )}

              {/* Output rows */}
              {outputs.map((o, idx) => (
                <div
                  key={o.localId}
                  className={cn(
                    'rounded-2xl bg-white p-4 shadow-sm ring-1',
                    o.is_waste ? 'ring-[#ea504c]/20' : 'ring-[#ebe6df]',
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className={cn(
                      'text-[11px] font-semibold uppercase tracking-wider',
                      o.is_waste ? 'text-[#ea504c]' : 'text-[#006d5a]',
                    )}>
                      {o.is_waste ? '🗑 Merma' : `Producto ${idx + 1 - outputs.slice(0, idx).filter((x) => x.is_waste).length}`}
                    </span>
                    <button
                      onClick={() => removeOutput(o.localId)}
                      className="rounded-lg p-1 text-muted-foreground hover:bg-red-50 hover:text-[#ea504c]"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {!o.is_waste && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          Insumo de destino (opcional)
                        </label>
                        <StockSearch
                          key={`${o.localId}-${o.stock_item_id ?? 'empty'}`}
                          items={stockItems}
                          value={stockItems.find((s) => s.id === o.stock_item_id) ?? null}
                          onChange={(item) => {
                            const previousLinkedItem = stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null
                            const previousSuggestion = suggestedExpiryDate(previousLinkedItem, productionDate)
                            const nextSuggestion = suggestedExpiryDate(item, productionDate)
                            const shouldReplaceName = !o.output_name || o.output_name === previousLinkedItem?.name

                            updateOutput(o.localId, {
                              stock_item_id: item?.id ?? null,
                              stock_item_name: item?.name ?? '',
                              output_name: shouldReplaceName ? item?.name ?? '' : o.output_name,
                              unit: item?.unit ?? o.unit,
                              expires_on: !o.expires_on || o.expires_on === previousSuggestion
                                ? nextSuggestion
                                : o.expires_on,
                            })
                          }}
                          placeholder="Buscar en stock..."
                        />
                        {o.stock_item_id && (() => {
                          const linkedItem = stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null
                          if (!linkedItem) return null
                          const source = getStockSource(linkedItem)
                          return (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${source?.tone}`}>
                                {source?.label}
                              </span>
                              {!source?.actionable && (
                                <span className="text-[11px] font-semibold text-[#ea504c]">
                                  Bloqueado hasta mapear Fudo/Local LVE
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Nombre en el registro
                      </label>
                      <input
                        type="text"
                        value={o.output_name}
                        onChange={(e) => updateOutput(o.localId, { output_name: e.target.value })}
                        placeholder="Ej: Milanesa cruda, Merma hueso..."
                        className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          Cantidad obtenida
                          {o.theoretical_qty !== null && (
                            <span className="ml-1 text-muted-foreground/60">
                              (teórico: {formatQty(o.theoretical_qty)})
                            </span>
                          )}
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={o.qty_produced}
                          onChange={(e) => updateOutput(o.localId, { qty_produced: e.target.value })}
                          placeholder="0.000"
                          className={cn(
                            'w-full rounded-xl border bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-1',
                            o.theoretical_qty !== null && parseFloat(o.qty_produced) > 0
                              ? parseFloat(o.qty_produced) < o.theoretical_qty * 0.9
                                ? 'border-[#ea504c]/40 focus:border-[#ea504c] focus:ring-[#ea504c]'
                                : 'border-[#006d5a]/40 focus:border-[#006d5a] focus:ring-[#006d5a]'
                              : 'border-[#ebe6df] focus:border-[#006d5a] focus:ring-[#006d5a]',
                          )}
                        />
                        {o.theoretical_qty !== null && parseFloat(o.qty_produced) > 0 &&
                          parseFloat(o.qty_produced) < o.theoretical_qty * 0.9 && (
                          <p className="mt-0.5 text-[10px] text-[#ea504c]">
                            Por debajo del rendimiento esperado
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Unidad</label>
                        <select
                          value={o.unit}
                          onChange={(e) => updateOutput(o.localId, { unit: e.target.value })}
                          className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                        >
                          {['kg', 'g', 'lt', 'ml', 'unidad', 'porción', 'atado'].map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {!o.is_waste && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                            Lote
                          </label>
                          <input
                            type="text"
                            value={o.lot_code}
                            onChange={(e) => updateOutput(o.localId, { lot_code: e.target.value })}
                            placeholder="Opcional, si no se genera solo"
                            className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                            Vencimiento
                          </label>
                          <input
                            type="date"
                            value={o.expires_on}
                            onChange={(e) => updateOutput(o.localId, { expires_on: e.target.value })}
                            className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                          />
                        </div>
                      </div>
                    )}

                    {!o.is_waste && (() => {
                      const linkedItem = o.stock_item_id
                        ? stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null
                        : null

                      if (!linkedItem || linkedItem.shelf_life_days == null) return null

                      return (
                        <p className="rounded-xl bg-[#fdf6ec] px-3 py-2 text-[11px] text-[#8b5e34]">
                          Vida util configurada: {linkedItem.shelf_life_days} dias.
                          {!o.expires_on && ' Si no elegis fecha, LVE la calcula automaticamente.'}
                        </p>
                      )
                    })()}

                    <input
                      type="text"
                      value={o.notes}
                      onChange={(e) => updateOutput(o.localId, { notes: e.target.value })}
                      placeholder="Notas (opcional)"
                      className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[12px] text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    />
                  </div>
                </div>
              ))}

              {/* Add buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => addOutput(false)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#006d5a]/40 py-2.5 text-[13px] font-medium text-[#006d5a]"
                >
                  <Plus className="size-4" />
                  Producto
                </button>
                <button
                  onClick={() => addOutput(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#ea504c]/30 py-2.5 text-[13px] font-medium text-[#ea504c]"
                >
                  <Leaf className="size-4" />
                  Merma
                </button>
              </div>
            </div>
          </FadeIn>
        )}

        {/* ── STEP 2: Resumen ── */}
        {step === 2 && (
          <FadeIn>
            <div className="space-y-3">
              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-[#ea504c]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              )}

              {/* Header card */}
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <p className="text-[13px] text-muted-foreground">Producción</p>
                <p className="mt-0.5 text-[16px] font-bold text-[#3d2c24]">{orderName}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">Elaboracion: {productionDate}</p>
                {notes && <p className="mt-1 text-[12px] text-muted-foreground">{notes}</p>}
              </div>

              {/* Input */}
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Entrada</p>
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="font-medium text-[#3d2c24]">{inputItem?.name}</span>
                    {inputItem && (
                      <p className={`mt-1 w-fit rounded-full px-1.5 py-0.5 text-[9px] font-bold ${getStockSource(inputItem)?.tone}`}>
                        {getStockSource(inputItem)?.label}
                      </p>
                    )}
                  </div>
                  <span className="font-bold text-[#3d2c24]">{formatQty(totalInputQty)} {inputUnit}</span>
                </div>
              </div>

              {/* Outputs */}
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Salidas</p>
                <div className="space-y-2">
                  {outputs.map((o) => {
                    const qty = parseFloat(o.qty_produced) || 0
                    const pct = totalInputQty > 0 ? (qty / totalInputQty * 100).toFixed(1) : '0'
                    const isBelow = o.theoretical_qty !== null && qty < o.theoretical_qty * 0.9
                    const linkedItem = o.stock_item_id
                      ? stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null
                      : null
                    const source = getStockSource(linkedItem)
                    return (
                      <div key={o.localId} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={cn(
                            'size-2 shrink-0 rounded-full',
                            o.is_waste ? 'bg-[#ea504c]' : 'bg-[#006d5a]',
                          )} />
                          <div className="min-w-0">
                            <span className={cn('truncate text-[13px]', o.is_waste ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>
                              {o.output_name}
                            </span>
                            {(!o.is_waste && (o.lot_code || o.expires_on)) && (
                              <p className="truncate text-[10px] text-muted-foreground">
                                {o.lot_code ? `Lote ${o.lot_code}` : 'Lote automatico'}
                                {o.expires_on ? ` · vence ${o.expires_on}` : ''}
                              </p>
                            )}
                            {!o.is_waste && source && (
                              <p className={`mt-1 w-fit rounded-full px-1.5 py-0.5 text-[9px] font-bold ${source.tone}`}>
                                {source.label}
                              </p>
                            )}
                          </div>
                          {isBelow && <AlertTriangle className="size-3 shrink-0 text-[#d4943a]" />}
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-[13px] font-bold text-[#3d2c24]">{formatQty(qty)} {o.unit}</span>
                          <span className="ml-1.5 text-[11px] text-muted-foreground">({pct}%)</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Balance check */}
                <div className={cn(
                  'mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-[12px] font-semibold',
                  balanceOk ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-amber-50 text-[#d4943a]',
                )}>
                  <span>Balance</span>
                  <span>
                    {formatQty(totalOutputQty)}/{formatQty(totalInputQty)} {inputUnit}
                    {!balanceOk && ` (diferencia: ${formatQty(Math.abs(balance))})`}
                  </span>
                </div>
              </div>

              {/* Efficiency */}
              {efficiency !== null && (
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Eficiencia</p>
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 rounded-full bg-[#f5f2ee]">
                      <div
                        className={cn('h-2 rounded-full transition-all', efficiency >= 90 ? 'bg-[#006d5a]' : efficiency >= 75 ? 'bg-[#d4943a]' : 'bg-[#ea504c]')}
                        style={{ width: `${Math.min(efficiency, 100)}%` }}
                      />
                    </div>
                    <div className="text-right">
                      <span className={cn('text-[20px] font-bold', efficiencyLabel(efficiency).color)}>
                        {efficiency}%
                      </span>
                      <p className={cn('text-[11px]', efficiencyLabel(efficiency).color)}>
                        {efficiencyLabel(efficiency).text}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Stock warning */}
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] text-[#d4943a]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Al confirmar, se descontará <strong>{formatQty(totalInputQty)} {inputUnit} de {inputItem?.name}</strong> del stock
                  y se sumarán los productos obtenidos. Los items vinculados se sincronizan con Fudo; los no mapeados quedan bloqueados.
                  Si la salida tiene vida util, LVE crea un lote con vencimiento.
                </span>
              </div>
            </div>
          </FadeIn>
        )}

        {/* ── Navigation buttons ── */}
        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-1 rounded-xl border border-[#ebe6df] bg-white px-4 py-3 text-[14px] font-medium text-[#3d2c24]"
            >
              <ChevronLeft className="size-4" />
              Atrás
            </button>
          )}

          {step < 2 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 0 ? !step0Valid : !step1Valid}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-3 text-[14px] font-semibold text-white disabled:opacity-50 active:scale-[0.99]"
            >
              {step === 1 && <span>Revisar impacto</span>}
              {step === 0 && <span>Seguir: qué sale</span>}
              <ChevronRight className="size-4" />
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-[14px] font-semibold text-white disabled:opacity-60 active:scale-[0.99]"
            >
              {saving ? (
                <><Loader2 className="size-4 animate-spin" />Sincronizando stock...</>
              ) : (
                <><Check className="size-4" />Confirmar y sincronizar</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
