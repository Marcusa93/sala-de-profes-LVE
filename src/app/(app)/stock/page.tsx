'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Package,
  Plus,
  Loader2,
  Pencil,
  CheckCircle2,
  Truck,
  CalendarClock,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import type { StockItem, StockItemInsert, Supplier, StockCategoryValue, MenuItem } from '@/types/database'
import {
  STOCK_CATEGORIES,
  STOCK_CATEGORY_OPTIONS,
  STOCK_UNITS,
  type StockCategory,
} from '@/lib/constants'
import {
  StockSemaphoreBadge,
  getSemaphore,
} from '@/components/stock/StockSemaphoreBadge'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockItemWithSupplier = StockItem & {
  suppliers: { name: string } | null
}

type FudoMenuItem = Pick<MenuItem, 'id' | 'name' | 'sale_price' | 'fudo_product_id'>

type StockFormData = {
  name: string
  category: StockCategoryValue
  unit: string
  current_qty: string
  min_qty: string
  next_purchase_date: string
  supplier_id: string
  fudo_product_id: string
  notes: string
}

const EMPTY_FORM: StockFormData = {
  name: '',
  category: 'otros',
  unit: 'unidad',
  current_qty: '0',
  min_qty: '0',
  next_purchase_date: '',
  supplier_id: '',
  fudo_product_id: '',
  notes: '',
}

type SemaphoreColor = 'red' | 'yellow' | 'green'

const SEMAPHORE_ACCENT: Record<SemaphoreColor, string> = {
  green: 'bg-[#006d5a]',
  yellow: 'bg-[#d4943a]',
  red: 'bg-[#ea504c]',
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StockPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [items, setItems] = useState<StockItemWithSupplier[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [menuItems, setMenuItems] = useState<FudoMenuItem[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [semaphoreFilter, setSemaphoreFilter] = useState<SemaphoreColor | null>(null)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<StockItemWithSupplier | null>(
    null,
  )
  const [formData, setFormData] = useState<StockFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Inline qty edit
  const [editingQty, setEditingQty] = useState<number | null>(null)
  const [qtyValue, setQtyValue] = useState('')

  const isEncargado = profile?.role === 'encargado'

  // -------------------------------------------------------------------------
  // Fetch data
  // -------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()

      const [itemsRes, suppliersRes, menuRes] = await Promise.all([
        supabase
          .from('stock_items')
          .select('*, suppliers(name)')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('suppliers')
          .select('*')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('menu_items')
          .select('id, name, sale_price, fudo_product_id')
          .not('fudo_product_id', 'is', null)
          .eq('is_active', true)
          .order('name'),
      ])

      if (itemsRes.error) throw itemsRes.error
      if (suppliersRes.error) throw suppliersRes.error

      setItems(
        (itemsRes.data as unknown as StockItemWithSupplier[]) ?? [],
      )
      setSuppliers(suppliersRes.data ?? [])
      if (menuRes.data) setMenuItems(menuRes.data as FudoMenuItem[])
    } catch (err) {
      console.error(err)
      toast.error('Error al cargar el stock')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  // -------------------------------------------------------------------------
  // Auto-sync Fudo sales → stock deduction (every 5 min)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!profile) return

    const COOLDOWN_KEY = 'fudo_sales_last_sync'
    const COOLDOWN_MS = 5 * 60 * 1000

    async function syncSales() {
      const lastSync = localStorage.getItem(COOLDOWN_KEY)
      const now = Date.now()
      if (lastSync && now - Number(lastSync) < COOLDOWN_MS) return

      try {
        const res = await fetch('/api/fudo/sync/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await res.json()
        localStorage.setItem(COOLDOWN_KEY, String(now))

        if (data.success && data.importedSales > 0) {
          toast.success(`${data.importedSales} ventas Fudo sincronizadas — stock actualizado`)
          fetchData() // Refresh stock after deductions
        }
      } catch {
        // Silent fail — don't bother user with sync errors
      }
    }

    syncSales()
    const interval = setInterval(syncSales, COOLDOWN_MS)
    return () => clearInterval(interval)
  }, [profile, fetchData])

  // -------------------------------------------------------------------------
  // Filtered items
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let result = items

    // Filter by semaphore
    if (semaphoreFilter) {
      result = result.filter(
        (item) =>
          getSemaphore(item.current_qty, item.min_qty) === semaphoreFilter,
      )
    }

    // Filter by category
    if (categoryFilter !== 'all') {
      result = result.filter((item) => item.category === categoryFilter)
    }

    return result
  }, [items, semaphoreFilter, categoryFilter])

  // Counts for semaphore dots
  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, green: 0 }
    items.forEach((item) => {
      const s = getSemaphore(item.current_qty, item.min_qty)
      c[s]++
    })
    return c
  }, [items])

  // -------------------------------------------------------------------------
  // Form handlers
  // -------------------------------------------------------------------------

  function openCreateDialog() {
    setEditingItem(null)
    setFormData(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEditDialog(item: StockItemWithSupplier) {
    setEditingItem(item)
    setFormData({
      name: item.name,
      category: item.category,
      unit: item.unit,
      current_qty: String(item.current_qty),
      min_qty: String(item.min_qty),
      next_purchase_date: '',
      supplier_id: item.supplier_id ? String(item.supplier_id) : '',
      fudo_product_id: item.fudo_product_id ?? '',
      notes: item.notes ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.name.trim()) {
      toast.error('El nombre del item es obligatorio')
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const payload: StockItemInsert = {
        name: formData.name.trim(),
        category: formData.category,
        unit: formData.unit,
        current_qty: Number(formData.current_qty) || 0,
        min_qty: Number(formData.min_qty) || 0,
        supplier_id: formData.supplier_id ? Number(formData.supplier_id) : null,
        fudo_product_id: formData.fudo_product_id || null,
        notes: formData.notes.trim() || null,
      }

      if (editingItem) {
        const { error } = await supabase
          .from('stock_items')
          .update(payload)
          .eq('id', editingItem.id)

        if (error) throw error
        toast.success('Item actualizado')
      } else {
        const { error } = await supabase.from('stock_items').insert(payload)

        if (error) throw error
        toast.success('Item creado')
      }

      setDialogOpen(false)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar item')
    } finally {
      setSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // Inline quantity update
  // -------------------------------------------------------------------------

  async function handleQtyUpdate(itemId: number) {
    const newQty = Number(qtyValue)
    if (isNaN(newQty) || newQty < 0) {
      toast.error('Cantidad invalida')
      return
    }

    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('stock_items')
        .update({ current_qty: newQty })
        .eq('id', itemId)

      if (error) throw error

      toast.success('Cantidad actualizada')
      setEditingQty(null)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Error al actualizar cantidad')
    }
  }

  // -------------------------------------------------------------------------
  // Mark as ordered
  // -------------------------------------------------------------------------

  async function handleMarkOrdered(itemId: number) {
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('stock_items')
        .update({ last_ordered_at: new Date().toISOString() })
        .eq('id', itemId)

      if (error) throw error

      toast.success('Pedido marcado como realizado')
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Error al marcar pedido')
    }
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (profileLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-[#006d5a]" />
          <p className="text-sm text-[#a39e97]">Cargando...</p>
        </div>
      </div>
    )
  }

  // Solo encargado puede acceder a stock
  if (profile && profile.role !== 'encargado') {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-2">
        <div className="card-elevated-lg rounded-2xl p-8 text-center">
          <Package className="mx-auto size-10 text-[#a39e97]" />
          <p className="mt-4 text-sm font-medium text-[#3d2c24]">Acceso restringido</p>
          <p className="mt-1 text-xs text-[#a39e97]">Esta sección es solo para encargados.</p>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="relative mx-auto max-w-2xl space-y-5 pb-24">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#3d2c24]">
          Stock
        </h1>
        <p className="section-label">Inventario y control</p>
      </div>

      {/* Category filter: horizontal scrollable pills */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-none">
        <button
          onClick={() => setCategoryFilter('all')}
          className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition-all ${
            categoryFilter === 'all'
              ? 'bg-[#006d5a] text-white shadow-sm shadow-[#006d5a]/20'
              : 'border border-[#ebe6df] bg-[#fefcf9] text-[#3d2c24] hover:border-[#006d5a]/20 hover:bg-[#f0f7f5]'
          }`}
        >
          Todas
        </button>
        {STOCK_CATEGORY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setCategoryFilter(opt.value)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition-all ${
              categoryFilter === opt.value
                ? 'bg-[#006d5a] text-white shadow-sm shadow-[#006d5a]/20'
                : 'border border-[#ebe6df] bg-[#fefcf9] text-[#3d2c24] hover:border-[#006d5a]/20 hover:bg-[#f0f7f5]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Semaphore filter row */}
      <div className="card-elevated flex items-center justify-between rounded-xl px-4 py-3">
        <span className="section-label">Estado</span>
        <div className="flex items-center gap-4">
          {(['red', 'yellow', 'green'] as const).map((color) => {
            const isActive = semaphoreFilter === color
            const dotColors: Record<SemaphoreColor, string> = {
              red: 'bg-[#ea504c]',
              yellow: 'bg-[#d4943a]',
              green: 'bg-[#006d5a]',
            }
            const labels: Record<SemaphoreColor, string> = {
              red: 'Critico',
              yellow: 'Atencion',
              green: 'Normal',
            }
            return (
              <button
                key={color}
                onClick={() =>
                  setSemaphoreFilter(isActive ? null : color)
                }
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-[#faf8f5] ring-2 ring-[#3d2c24]/10 shadow-sm'
                    : 'hover:bg-[#faf8f5]'
                }`}
                aria-label={`Filtrar por ${color}`}
              >
                <span
                  className={`size-2.5 rounded-full ${dotColors[color]}`}
                  style={isActive ? { boxShadow: `0 0 0 2px #fefcf9, 0 0 0 4px currentColor` } : undefined}
                />
                <span className={`tabular-nums ${isActive ? 'text-[#3d2c24] font-semibold' : 'text-[#a39e97]'}`}>
                  {counts[color]}
                </span>
                <span className={`hidden sm:inline ${isActive ? 'text-[#3d2c24]' : 'text-[#a39e97]'}`}>
                  {labels[color]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Stock cards */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Sin items de stock"
          description="No hay items que coincidan con los filtros seleccionados"
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map((item) => (
            <StockCard
              key={item.id}
              item={item}
              isEncargado={isEncargado}
              editingQty={editingQty}
              qtyValue={qtyValue}
              fudoMenuItem={menuItems.find((m) => m.fudo_product_id === item.fudo_product_id) ?? null}
              onEdit={() => openEditDialog(item)}
              onQtyClick={() => {
                setEditingQty(item.id)
                setQtyValue(String(item.current_qty))
              }}
              onQtyChange={setQtyValue}
              onQtySubmit={() => handleQtyUpdate(item.id)}
              onQtyCancel={() => setEditingQty(null)}
              onMarkOrdered={() => handleMarkOrdered(item.id)}
            />
          ))}
        </div>
      )}

      {/* FAB for adding item (encargado only) */}
      {isEncargado && (
        <button
          onClick={openCreateDialog}
          className="fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-[#006d5a] text-white shadow-lg shadow-[#006d5a]/25 transition-all active:scale-95 hover:shadow-xl hover:shadow-[#006d5a]/30 sm:bottom-6 sm:right-6"
          aria-label="Agregar item de stock"
        >
          <Plus className="size-6" />
        </button>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-[#3d2c24]">
              {editingItem ? 'Editar Item' : 'Nuevo Item de Stock'}
            </DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              {editingItem
                ? 'Modifica los datos del item'
                : 'Completa los datos del nuevo item'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="stock-name" className="text-[#3d2c24] text-xs font-semibold">Nombre *</Label>
              <Input
                id="stock-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Nombre del item"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[#3d2c24] text-xs font-semibold">Categoria</Label>
                <Select
                  value={formData.category}
                  onValueChange={(val) =>
                    val && setFormData((prev) => ({ ...prev, category: val as StockCategoryValue }))
                  }
                >
                  <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-[#ebe6df] bg-[#fefcf9]">
                    {STOCK_CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[#3d2c24] text-xs font-semibold">Unidad</Label>
                <Select
                  value={formData.unit}
                  onValueChange={(val) =>
                    val && setFormData((prev) => ({ ...prev, unit: val }))
                  }
                >
                  <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-[#ebe6df] bg-[#fefcf9]">
                    {STOCK_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="stock-current-qty" className="text-[#3d2c24] text-xs font-semibold">Cantidad actual</Label>
                <Input
                  id="stock-current-qty"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.current_qty}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      current_qty: e.target.value,
                    }))
                  }
                  className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] focus-visible:ring-[#006d5a]"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="stock-min-qty" className="text-[#3d2c24] text-xs font-semibold">Cantidad minima</Label>
                <Input
                  id="stock-min-qty"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.min_qty}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      min_qty: e.target.value,
                    }))
                  }
                  className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] focus-visible:ring-[#006d5a]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[#3d2c24] text-xs font-semibold">Proveedor</Label>
              <Select
                value={formData.supplier_id}
                onValueChange={(val) =>
                  val !== null && setFormData((prev) => ({ ...prev, supplier_id: val }))
                }
              >
                <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24]">
                  <SelectValue placeholder="Sin proveedor asignado" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[#ebe6df] bg-[#fefcf9]">
                  <SelectItem value="">Sin proveedor</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {menuItems.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-[#3d2c24] text-xs font-semibold">Producto Fudo</Label>
                <Select
                  value={formData.fudo_product_id}
                  onValueChange={(val) =>
                    setFormData((prev) => ({ ...prev, fudo_product_id: val }))
                  }
                >
                  <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24]">
                    <SelectValue placeholder="Sin vincular a Fudo" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 rounded-xl border-[#ebe6df] bg-[#fefcf9]">
                    <SelectItem value="">Sin vincular</SelectItem>
                    {menuItems.map((m) => (
                      <SelectItem key={m.id} value={m.fudo_product_id!}>
                        {m.name} — ${m.sale_price?.toLocaleString('es-AR')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-[#a39e97]">Vincula este item con un producto del POS Fudo</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="stock-notes" className="text-[#3d2c24] text-xs font-semibold">Notas</Label>
              <Textarea
                id="stock-notes"
                value={formData.notes}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Notas adicionales..."
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
              />
            </div>

            <DialogFooter className="gap-2 pt-2">
              <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24] hover:bg-[#faf8f5]" />}>
                Cancelar
              </DialogClose>
              <Button type="submit" disabled={saving} className="rounded-xl bg-[#006d5a] text-white hover:bg-[#004d3f]">
                {saving && <Loader2 className="size-4 animate-spin" />}
                {editingItem ? 'Guardar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StockCard
// ---------------------------------------------------------------------------

type StockCardProps = {
  item: StockItemWithSupplier
  isEncargado: boolean
  editingQty: number | null
  qtyValue: string
  fudoMenuItem: FudoMenuItem | null
  onEdit: () => void
  onQtyClick: () => void
  onQtyChange: (val: string) => void
  onQtySubmit: () => void
  onQtyCancel: () => void
  onMarkOrdered: () => void
}

function StockCard({
  item,
  isEncargado,
  editingQty,
  qtyValue,
  fudoMenuItem,
  onEdit,
  onQtyClick,
  onQtyChange,
  onQtySubmit,
  onQtyCancel,
  onMarkOrdered,
}: StockCardProps) {
  const semaphore = getSemaphore(item.current_qty, item.min_qty)
  const categoryConfig =
    STOCK_CATEGORIES[item.category] ?? STOCK_CATEGORIES.otros
  const isEditingThisQty = editingQty === item.id

  return (
    <div className="card-elevated hover-lift relative flex overflow-hidden rounded-xl">
      {/* Left accent bar */}
      <div className={`w-1 shrink-0 ${SEMAPHORE_ACCENT[semaphore]}`} />

      {/* Card content */}
      <div className="flex-1 p-5 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2.5">
              <h3 className="font-semibold text-[#3d2c24]">{item.name}</h3>
              <StockSemaphoreBadge semaphore={semaphore} />
            </div>
            <p className="text-xs text-[#a39e97]">
              {categoryConfig.icon} {categoryConfig.label}
              <span className="mx-2 text-[#ebe6df]">|</span>
              {item.unit}
            </p>
          </div>
          {isEncargado && (
            <button
              onClick={onEdit}
              className="flex size-8 items-center justify-center rounded-lg text-[#a39e97] transition-colors hover:bg-[#faf8f5] hover:text-[#3d2c24]"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>

        {/* Quantity display: current vs min */}
        <div className="flex items-center gap-2">
          {isEditingThisQty ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={qtyValue}
                onChange={(e) => onQtyChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onQtySubmit()
                  if (e.key === 'Escape') onQtyCancel()
                }}
                className="h-8 w-20 rounded-lg border-[#ebe6df] bg-[#faf8f5] text-sm text-[#3d2c24] focus-visible:ring-[#006d5a]"
                autoFocus
              />
              <span className="text-xs text-[#a39e97]">
                / {item.min_qty} {item.unit}
              </span>
              <button
                onClick={onQtySubmit}
                className="flex size-7 items-center justify-center rounded-full bg-[#f0f7f5] text-[#006d5a] transition-colors hover:bg-[#006d5a] hover:text-white"
              >
                <CheckCircle2 className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onQtyClick}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[#faf8f5]"
              title="Toca para editar cantidad"
            >
              <span className="font-display text-xl font-semibold tabular-nums text-[#3d2c24]">
                {item.current_qty}
              </span>
              <span className="text-sm text-[#a39e97]">
                / {item.min_qty} {item.unit}
              </span>
            </button>
          )}
        </div>

        {/* Meta info: supplier + date + Fudo */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#a39e97]">
          {item.suppliers?.name && (
            <span className="flex items-center gap-1.5">
              <Truck className="size-3" />
              {item.suppliers.name}
            </span>
          )}
          {item.last_ordered_at && (
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-3" />
              Pedido{' '}
              {format(new Date(item.last_ordered_at), 'd MMM', {
                locale: es,
              })}
            </span>
          )}
          {fudoMenuItem && (
            <span className="flex items-center gap-1.5 rounded-full bg-[#f0f7f5] px-2 py-0.5 text-[10px] font-semibold text-[#006d5a]">
              Fudo · ${fudoMenuItem.sale_price?.toLocaleString('es-AR')}
            </span>
          )}
        </div>

        {/* Mark ordered button */}
        {isEncargado && semaphore !== 'green' && (
          <button
            onClick={onMarkOrdered}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-[#006d5a]/20 bg-[#f0f7f5] px-3 py-1.5 text-xs font-semibold text-[#006d5a] transition-all hover:bg-[#006d5a] hover:text-white active:scale-95"
          >
            <CheckCircle2 className="size-3" />
            Marcar pedido realizado
          </button>
        )}
      </div>
    </div>
  )
}
