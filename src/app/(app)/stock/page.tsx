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
import type { StockItem, StockItemInsert, Supplier } from '@/types/database'
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
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
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

type StockFormData = {
  name: string
  category: string
  unit: string
  current_qty: string
  min_qty: string
  next_purchase_date: string
  supplier_id: string
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
  notes: '',
}

type SemaphoreTab = 'todos' | 'red' | 'yellow' | 'green'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StockPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [items, setItems] = useState<StockItemWithSupplier[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [activeTab, setActiveTab] = useState<SemaphoreTab>('todos')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<StockItemWithSupplier | null>(
    null,
  )
  const [formData, setFormData] = useState<StockFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Inline qty edit
  const [editingQty, setEditingQty] = useState<string | null>(null)
  const [qtyValue, setQtyValue] = useState('')

  const isEncargado = profile?.role === 'encargado'

  // -------------------------------------------------------------------------
  // Fetch data
  // -------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()

      const [itemsRes, suppliersRes] = await Promise.all([
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
      ])

      if (itemsRes.error) throw itemsRes.error
      if (suppliersRes.error) throw suppliersRes.error

      setItems(
        (itemsRes.data as unknown as StockItemWithSupplier[]) ?? [],
      )
      setSuppliers(suppliersRes.data ?? [])
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
  // Filtered items
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let result = items

    // Filter by semaphore
    if (activeTab !== 'todos') {
      result = result.filter(
        (item) =>
          getSemaphore(item.current_qty, item.min_qty) ===
          activeTab,
      )
    }

    // Filter by category
    if (categoryFilter !== 'all') {
      result = result.filter((item) => item.category === categoryFilter)
    }

    return result
  }, [items, activeTab, categoryFilter])

  // Counts for tabs
  const counts = useMemo(() => {
    const c = { todos: items.length, red: 0, yellow: 0, green: 0 }
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
      supplier_id: item.supplier_id ?? '',
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
        supplier_id: formData.supplier_id || null,
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

  async function handleQtyUpdate(itemId: string) {
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

  async function handleMarkOrdered(itemId: string) {
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('stock_items')
        .update({ updated_at: new Date().toISOString() })
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
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">
          <Package className="mb-0.5 mr-1.5 inline-block size-5 text-primary" />
          Stock
        </h1>
        {isEncargado && (
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="size-4" />
            Agregar Item
          </Button>
        )}
      </div>

      {/* Semaphore tabs */}
      <Tabs
        defaultValue="todos"
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as SemaphoreTab)}
      >
        <TabsList className="w-full">
          <TabsTrigger value="todos">Todos ({counts.todos})</TabsTrigger>
          <TabsTrigger value="red">
            <span className="mr-1 inline-block size-2 rounded-full bg-red-500" />
            {counts.red}
          </TabsTrigger>
          <TabsTrigger value="yellow">
            <span className="mr-1 inline-block size-2 rounded-full bg-yellow-500" />
            {counts.yellow}
          </TabsTrigger>
          <TabsTrigger value="green">
            <span className="mr-1 inline-block size-2 rounded-full bg-green-500" />
            {counts.green}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Category filter */}
      <Select value={categoryFilter} onValueChange={(v) => v && setCategoryFilter(v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Filtrar por categoria" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las categorias</SelectItem>
          {STOCK_CATEGORY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? 'Editar Item' : 'Nuevo Item de Stock'}
            </DialogTitle>
            <DialogDescription>
              {editingItem
                ? 'Modifica los datos del item'
                : 'Completa los datos del nuevo item'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="stock-name">Nombre *</Label>
              <Input
                id="stock-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Nombre del item"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select
                  value={formData.category}
                  onValueChange={(val) =>
                    val && setFormData((prev) => ({ ...prev, category: val }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STOCK_CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Unidad</Label>
                <Select
                  value={formData.unit}
                  onValueChange={(val) =>
                    val && setFormData((prev) => ({ ...prev, unit: val }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
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
                <Label htmlFor="stock-current-qty">Cantidad actual</Label>
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
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="stock-min-qty">Cantidad minima</Label>
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
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Proveedor</Label>
              <Select
                value={formData.supplier_id}
                onValueChange={(val) =>
                  val !== null && setFormData((prev) => ({ ...prev, supplier_id: val }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sin proveedor asignado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin proveedor</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stock-notes">Notas</Label>
              <Textarea
                id="stock-notes"
                value={formData.notes}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Notas adicionales..."
              />
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancelar
              </DialogClose>
              <Button type="submit" disabled={saving}>
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
  editingQty: string | null
  qtyValue: string
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
  onEdit,
  onQtyClick,
  onQtyChange,
  onQtySubmit,
  onQtyCancel,
  onMarkOrdered,
}: StockCardProps) {
  const semaphore = getSemaphore(item.current_qty, item.min_qty)
  const categoryConfig =
    STOCK_CATEGORIES[item.category as StockCategory] ?? STOCK_CATEGORIES.otros
  const isEditingThisQty = editingQty === item.id

  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-foreground">{item.name}</h3>
              <StockSemaphoreBadge semaphore={semaphore} />
            </div>
            <p className="text-xs text-muted-foreground">
              {categoryConfig.icon} {categoryConfig.label}
            </p>
          </div>
          {isEncargado && (
            <Button variant="ghost" size="icon-xs" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </Button>
          )}
        </div>

        {/* Quantity */}
        <div className="flex items-center gap-2">
          {isEditingThisQty ? (
            <div className="flex items-center gap-1.5">
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
                className="h-7 w-20 text-sm"
                autoFocus
              />
              <span className="text-xs text-muted-foreground">
                / {item.min_qty} {item.unit}
              </span>
              <Button variant="ghost" size="icon-xs" onClick={onQtySubmit}>
                <CheckCircle2 className="size-3.5 text-green-600" />
              </Button>
            </div>
          ) : (
            <button
              onClick={onQtyClick}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm transition-colors hover:bg-muted"
              title="Toca para editar cantidad"
            >
              <span className="font-semibold tabular-nums">
                {item.current_qty}
              </span>
              <span className="text-muted-foreground">
                / {item.min_qty} {item.unit}
              </span>
            </button>
          )}
        </div>

        {/* Meta info */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {item.suppliers?.name && (
            <span className="flex items-center gap-1">
              <Truck className="size-3" />
              {item.suppliers.name}
            </span>
          )}
          {item.updated_at && (
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3" />
              Act.{' '}
              {format(new Date(item.updated_at), "d MMM", {
                locale: es,
              })}
            </span>
          )}
        </div>

        {/* Mark ordered button */}
        {isEncargado && semaphore !== 'green' && (
          <Button
            variant="outline"
            size="xs"
            onClick={onMarkOrdered}
            className="mt-1"
          >
            <CheckCircle2 className="size-3" />
            Marcar pedido realizado
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
