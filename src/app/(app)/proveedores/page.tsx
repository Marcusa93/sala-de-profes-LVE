'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import {
  Truck,
  Phone,
  Mail,
  MessageCircle,
  Plus,
  Search,
  Loader2,
  Pencil,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Package,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logAuditClient } from '@/lib/audit'
import { useProfileContext } from '@/lib/hooks/use-profile'
import type { Supplier, SupplierInsert, StockItem } from '@/types/database'
import { getSemaphore } from '@/components/stock/StockSemaphoreBadge'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

type SupplierFormData = {
  name: string
  category: string
  contact_name: string
  phone: string
  email: string
  notes: string
}

const EMPTY_FORM: SupplierFormData = {
  name: '',
  category: '',
  contact_name: '',
  phone: '',
  email: '',
  notes: '',
}

type LowStockItem = Pick<StockItem, 'id' | 'name' | 'current_qty' | 'min_qty' | 'unit' | 'supplier_id' | 'category'>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripNonDigits(phone: string): string {
  return phone.replace(/\D/g, '')
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProveedoresPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showOnlyWithAlerts, setShowOnlyWithAlerts] = useState(false)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [formData, setFormData] = useState<SupplierFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Assign stock items dialog
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [assignSupplier, setAssignSupplier] = useState<Supplier | null>(null)
  const [allStockItems, setAllStockItems] = useState<LowStockItem[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const [assignFilter, setAssignFilter] = useState('')

  const isEncargado = isManagerOrAbove(profile?.role)

  // -------------------------------------------------------------------------
  // Fetch suppliers + low stock items
  // -------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const [suppRes, stockRes, barRes] = await Promise.all([
        supabase
          .from('suppliers')
          .select('*')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('stock_items')
          .select('id, name, current_qty, min_qty, unit, supplier_id, category')
          .eq('is_active', true),
        supabase
          .from('bar_stock_items')
          .select('id, name, current_qty, min_level, unit, supplier_id, category')
          .eq('is_active', true),
      ])

      if (suppRes.error) throw suppRes.error
      setSuppliers(suppRes.data ?? [])

      // Merge kitchen stock + bar stock (bar items get negative IDs to avoid collisions)
      const kitchenStock = (stockRes.data ?? []) as LowStockItem[]
      const barStock = (barRes.data ?? []).map((b: { id: number; name: string; current_qty: number; min_level: number; unit: string; supplier_id: string | null; category: string }) => ({
        id: -b.id, // negative to distinguish from kitchen items
        name: `☕ ${b.name}`,
        current_qty: b.current_qty,
        min_qty: b.min_level,
        unit: b.unit,
        supplier_id: b.supplier_id ? Number(b.supplier_id) : null,
        category: b.category,
        _barId: b.id, // real bar_stock_items id
        _isBar: true,
      })) as (LowStockItem & { _barId?: number; _isBar?: boolean })[]

      const allStock = [...kitchenStock, ...barStock]
      setAllStockItems(allStock)

      // Filter to only low stock (red/yellow semaphore)
      const low = allStock.filter((item) => {
        const sem = getSemaphore(item.current_qty, item.min_qty)
        return sem === 'red' || sem === 'yellow'
      })
      setLowStockItems(low)
    } catch (err) {
      console.error(err)
      toast.error('Error al cargar proveedores')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  // -------------------------------------------------------------------------
  // Sync from Fudo
  // -------------------------------------------------------------------------

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/fudo/sync/providers', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(`${data.created} nuevos, ${data.synced} actualizados`)
        await fetchData()
      } else {
        toast.error(data.error ?? 'Error al sincronizar')
      }
    } catch {
      toast.error('Error de conexión')
    } finally {
      setSyncing(false)
    }
  }

  // -------------------------------------------------------------------------
  // Low stock items grouped by supplier
  // -------------------------------------------------------------------------

  const lowStockBySupplier = useMemo(() => {
    const map = new Map<number, LowStockItem[]>()
    for (const item of lowStockItems) {
      if (item.supplier_id) {
        const list = map.get(item.supplier_id) ?? []
        list.push(item)
        map.set(item.supplier_id, list)
      }
    }
    return map
  }, [lowStockItems])

  const unlinkedLowStock = useMemo(
    () => lowStockItems.filter((i) => !i.supplier_id),
    [lowStockItems],
  )

  const suppliersWithAlerts = useMemo(
    () => new Set([...lowStockBySupplier.keys()]),
    [lowStockBySupplier],
  )

  // -------------------------------------------------------------------------
  // Filtered suppliers
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let result = suppliers
    if (showOnlyWithAlerts) {
      result = result.filter((s) => suppliersWithAlerts.has(s.id))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.contact_name?.toLowerCase().includes(q) ||
          s.email?.toLowerCase().includes(q) ||
          s.phone?.includes(q),
      )
    }
    return result
  }, [suppliers, searchQuery, showOnlyWithAlerts, suppliersWithAlerts])

  // -------------------------------------------------------------------------
  // Form handlers
  // -------------------------------------------------------------------------

  function openCreateDialog() {
    setEditingSupplier(null)
    setFormData(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEditDialog(supplier: Supplier) {
    setEditingSupplier(supplier)
    setFormData({
      name: supplier.name,
      category: supplier.category ?? '',
      contact_name: supplier.contact_name ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      notes: supplier.notes ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.name.trim()) {
      toast.error('El nombre del proveedor es obligatorio')
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const payload: SupplierInsert = {
        name: formData.name.trim(),
        category: formData.category.trim() || 'otros',
        contact_name: formData.contact_name.trim() || null,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        notes: formData.notes.trim() || null,
      }

      if (editingSupplier) {
        const { error } = await supabase
          .from('suppliers')
          .update(payload)
          .eq('id', editingSupplier.id)

        if (error) throw error
        logAuditClient({
          userId: profile?.id ?? null,
          userName: profile?.first_name ?? null,
          action: 'update_supplier',
          module: 'proveedores',
          entityType: 'supplier',
          entityId: String(editingSupplier.id),
          description: `${profile?.first_name ?? 'User'} editó proveedor: ${formData.name.trim()}`,
        })
        toast.success('Proveedor actualizado')
      } else {
        const { error } = await supabase.from('suppliers').insert(payload)

        if (error) throw error
        logAuditClient({
          userId: profile?.id ?? null,
          userName: profile?.first_name ?? null,
          action: 'create_supplier',
          module: 'proveedores',
          entityType: 'supplier',
          description: `${profile?.first_name ?? 'User'} creó proveedor: ${formData.name.trim()}`,
        })
        toast.success('Proveedor creado')
      }

      setDialogOpen(false)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar proveedor')
    } finally {
      setSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // Delete handler (soft delete)
  // -------------------------------------------------------------------------

  function openDeleteDialog(supplier: Supplier) {
    setSupplierToDelete(supplier)
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!supplierToDelete) return

    setDeleting(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('suppliers')
        .update({ is_active: false })
        .eq('id', supplierToDelete.id)

      if (error) throw error
      logAuditClient({
        userId: profile?.id ?? null,
        userName: profile?.first_name ?? null,
        action: 'delete_supplier',
        module: 'proveedores',
        entityType: 'supplier',
        entityId: String(supplierToDelete.id),
        description: `${profile?.first_name ?? 'User'} desactivó proveedor: ${supplierToDelete.name}`,
      })

      toast.success('Proveedor eliminado')
      setDeleteDialogOpen(false)
      setSupplierToDelete(null)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Error al eliminar proveedor')
    } finally {
      setDeleting(false)
    }
  }

  // -------------------------------------------------------------------------
  // Assign stock items to supplier
  // -------------------------------------------------------------------------

  function openAssignDialog(supplier: Supplier) {
    setAssignSupplier(supplier)
    // Pre-select items already linked to this supplier
    const alreadyLinked = allStockItems
      .filter((i) => i.supplier_id === supplier.id)
      .map((i) => i.id)
    setSelectedItems(new Set(alreadyLinked))
    setAssignFilter('')
    setAssignDialogOpen(true)
  }

  const assignableItems = useMemo(() => {
    if (!assignSupplier) return []
    // Show items that are unlinked OR already linked to this supplier
    return allStockItems
      .filter((i) => !i.supplier_id || i.supplier_id === assignSupplier.id)
      .sort((a, b) => {
        // Sort: same category as supplier first, then alphabetical
        const aCat = a.category === assignSupplier.category ? 0 : 1
        const bCat = b.category === assignSupplier.category ? 0 : 1
        if (aCat !== bCat) return aCat - bCat
        return a.name.localeCompare(b.name)
      })
  }, [allStockItems, assignSupplier])

  const filteredAssignable = useMemo(() => {
    if (!assignFilter.trim()) return assignableItems
    const q = assignFilter.toLowerCase()
    return assignableItems.filter(
      (i) => i.name.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q),
    )
  }, [assignableItems, assignFilter])

  function toggleItem(id: number) {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllCategory(category: string) {
    const categoryItems = filteredAssignable.filter((i) => i.category === category)
    setSelectedItems((prev) => {
      const next = new Set(prev)
      const allSelected = categoryItems.every((i) => next.has(i.id))
      for (const item of categoryItems) {
        if (allSelected) next.delete(item.id)
        else next.add(item.id)
      }
      return next
    })
  }

  async function handleAssign() {
    if (!assignSupplier) return
    setAssigning(true)
    try {
      const supabase = createClient()

      // Unlink items that were removed
      const previouslyLinked = allStockItems
        .filter((i) => i.supplier_id === assignSupplier.id)
        .map((i) => i.id)
      const toUnlink = previouslyLinked.filter((id) => !selectedItems.has(id))
      const toLink = [...selectedItems].filter(
        (id) => !previouslyLinked.includes(id),
      )

      // Split into kitchen items (positive IDs) and bar items (negative IDs)
      const kitchenUnlink = toUnlink.filter((id) => id > 0)
      const barUnlink = toUnlink.filter((id) => id < 0).map((id) => -id)
      const kitchenLink = toLink.filter((id) => id > 0)
      const barLink = toLink.filter((id) => id < 0).map((id) => -id)

      // Kitchen stock_items
      if (kitchenUnlink.length > 0) {
        await supabase.from('stock_items').update({ supplier_id: null }).in('id', kitchenUnlink)
      }
      if (kitchenLink.length > 0) {
        await supabase.from('stock_items').update({ supplier_id: assignSupplier.id }).in('id', kitchenLink)
      }

      // Bar stock items (use API route for admin client)
      for (const barId of barUnlink) {
        await fetch('/api/kitchen/bar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_supplier', itemId: barId, supplierId: null }),
        })
      }
      for (const barId of barLink) {
        await fetch('/api/kitchen/bar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_supplier', itemId: barId, supplierId: assignSupplier.id }),
        })
      }

      const totalLinked = kitchenLink.length + barLink.length
      const totalUnlinked = kitchenUnlink.length + barUnlink.length
      logAuditClient({
        userId: profile?.id ?? null,
        userName: profile?.first_name ?? null,
        action: 'link_supplier_stock',
        module: 'proveedores',
        entityType: 'supplier',
        entityId: String(assignSupplier.id),
        description: `${profile?.first_name ?? 'User'} vinculó proveedor ${assignSupplier.name} a ${totalLinked} items de stock (${totalUnlinked} desvinculados)`,
      })
      toast.success(`${totalLinked} vinculados, ${totalUnlinked} desvinculados`)
      setAssignDialogOpen(false)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Error al asignar productos')
    } finally {
      setAssigning(false)
    }
  }

  // -------------------------------------------------------------------------
  // Build WhatsApp message with low stock items for a supplier
  // -------------------------------------------------------------------------

  function buildWhatsAppMessage(supplier: Supplier): string {
    const items = lowStockBySupplier.get(supplier.id)
    let msg = `Hola, soy de La Vieja Escuela. Te escribo para hacer un pedido.`
    if (items && items.length > 0) {
      msg += `\n\nNecesitamos:`
      for (const item of items) {
        const needed = Math.max(0, item.min_qty - item.current_qty)
        const semaphore = getSemaphore(item.current_qty, item.min_qty)
        const urgency = semaphore === 'red' ? ' (URGENTE)' : ''
        msg += `\n- ${item.name}: quedan ${item.current_qty} ${item.unit}, necesitamos ${needed > 0 ? needed : 'reponer'}${urgency}`
      }
    }
    return msg
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

  // Solo encargado/socio puede acceder a proveedores
  if (profile && !isEncargado) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-2">
        <div className="card-elevated-lg rounded-2xl p-8 text-center">
          <Truck className="mx-auto size-10 text-[#a39e97]" />
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
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#3d2c24]">
            Proveedores
          </h1>
          <p className="section-label">Directorio de contactos</p>
        </div>
        {isEncargado && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-95 disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {syncing ? 'Sincronizando...' : 'Sync Fudo'}
          </button>
        )}
      </div>

      {/* Low stock alert banner */}
      {suppliersWithAlerts.size > 0 && (
        <button
          onClick={() => setShowOnlyWithAlerts(!showOnlyWithAlerts)}
          className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-all ${
            showOnlyWithAlerts
              ? 'bg-[#ea504c]/10 ring-2 ring-[#ea504c]/30'
              : 'bg-[#fef7ed] ring-1 ring-[#d4943a]/20'
          }`}
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#ea504c]/10">
            <AlertTriangle className="size-5 text-[#ea504c]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#3d2c24]">
              {lowStockItems.length} productos con stock bajo
            </p>
            <p className="text-xs text-[#a39e97]">
              {suppliersWithAlerts.size} proveedores necesitan pedido
              {unlinkedLowStock.length > 0 && ` · ${unlinkedLowStock.length} sin proveedor`}
              {' · '}
              <span className="font-medium text-[#006d5a]">
                {showOnlyWithAlerts ? 'Ver todos' : 'Filtrar'}
              </span>
            </p>
          </div>
        </button>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
        <Input
          placeholder="Buscar por nombre, contacto, email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-12 rounded-xl border-[#ebe6df] bg-[#faf8f5] pl-10 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-2 focus-visible:ring-[#006d5a]"
        />
      </div>

      {/* Supplier cards */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Sin proveedores"
          description={
            searchQuery
              ? 'No se encontraron proveedores con esa busqueda'
              : showOnlyWithAlerts
                ? 'No hay proveedores con alertas de stock'
                : 'Agrega tu primer proveedor para comenzar'
          }
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              isEncargado={isEncargado}
              lowStockItems={lowStockBySupplier.get(supplier.id) ?? []}
              linkedCount={allStockItems.filter((i) => i.supplier_id === supplier.id).length}
              whatsAppMessage={buildWhatsAppMessage(supplier)}
              onEdit={() => openEditDialog(supplier)}
              onDelete={() => openDeleteDialog(supplier)}
              onAssign={() => openAssignDialog(supplier)}
            />
          ))}
        </div>
      )}

      {/* Unlinked low stock items */}
      {unlinkedLowStock.length > 0 && !searchQuery && (
        <div className="space-y-2 pt-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#a39e97]">
            Sin proveedor asignado ({unlinkedLowStock.length})
          </h2>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
            <div className="space-y-2">
              {unlinkedLowStock.slice(0, 10).map((item) => (
                <LowStockRow key={item.id} item={item} />
              ))}
              {unlinkedLowStock.length > 10 && (
                <p className="text-xs text-[#a39e97] text-center pt-1">
                  +{unlinkedLowStock.length - 10} más
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FAB for adding supplier (encargado only) */}
      {isEncargado && (
        <button
          onClick={openCreateDialog}
          className="fab"
          aria-label="Agregar proveedor"
        >
          <Plus className="size-6" />
        </button>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-[#3d2c24]">
              {editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
            </DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              {editingSupplier
                ? 'Modifica los datos del proveedor'
                : 'Completa los datos del nuevo proveedor'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="supplier-name" className="text-[#3d2c24] text-xs font-semibold">Nombre *</Label>
              <Input
                id="supplier-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Nombre del proveedor"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-contact" className="text-[#3d2c24] text-xs font-semibold">Persona de contacto</Label>
              <Input
                id="supplier-contact"
                value={formData.contact_name}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    contact_name: e.target.value,
                  }))
                }
                placeholder="Nombre del contacto"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-phone" className="text-[#3d2c24] text-xs font-semibold">Telefono</Label>
              <Input
                id="supplier-phone"
                type="tel"
                value={formData.phone}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, phone: e.target.value }))
                }
                placeholder="+54 11 1234-5678"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-email" className="text-[#3d2c24] text-xs font-semibold">Email</Label>
              <Input
                id="supplier-email"
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="proveedor@email.com"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-notes" className="text-[#3d2c24] text-xs font-semibold">Notas</Label>
              <Textarea
                id="supplier-notes"
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
                {editingSupplier ? 'Guardar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9]">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-[#3d2c24]">Eliminar proveedor</DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              Estas seguro de que deseas eliminar a{' '}
              <span className="font-medium text-[#3d2c24]">
                {supplierToDelete?.name}
              </span>
              ? Esta accion se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24] hover:bg-[#faf8f5]" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-xl"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Stock Items Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-[#3d2c24]">
              Vincular productos
            </DialogTitle>
            <DialogDescription className="text-[#a39e97]">
              Selecciona los productos que provee{' '}
              <span className="font-medium text-[#3d2c24]">
                {assignSupplier?.name}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
            <Input
              placeholder="Buscar producto..."
              value={assignFilter}
              onChange={(e) => setAssignFilter(e.target.value)}
              className="h-9 rounded-xl border-[#ebe6df] bg-[#faf8f5] pl-9 text-xs text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
            />
          </div>

          {/* Category quick-select buttons */}
          {assignSupplier && (
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(filteredAssignable.map((i) => i.category))].map((cat) => {
                const catItems = filteredAssignable.filter((i) => i.category === cat)
                const allSelected = catItems.every((i) => selectedItems.has(i.id))
                return (
                  <button
                    key={cat}
                    onClick={() => selectAllCategory(cat ?? 'otros')}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all ${
                      allSelected
                        ? 'bg-[#006d5a] text-white'
                        : 'bg-[#f0f7f5] text-[#006d5a] hover:bg-[#e0efe9]'
                    }`}
                  >
                    {cat ?? 'otros'} ({catItems.length})
                  </button>
                )
              })}
            </div>
          )}

          {/* Scrollable item list */}
          <div className="flex-1 overflow-y-auto max-h-[40vh] -mx-1 px-1 space-y-0.5">
            {filteredAssignable.map((item) => {
              const isSelected = selectedItems.has(item.id)
              const sem = getSemaphore(item.current_qty, item.min_qty)
              return (
                <button
                  key={item.id}
                  onClick={() => toggleItem(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all ${
                    isSelected
                      ? 'bg-[#f0f7f5] ring-1 ring-[#006d5a]/20'
                      : 'hover:bg-[#faf8f5]'
                  }`}
                >
                  <div
                    className={`flex size-4 shrink-0 items-center justify-center rounded border transition-all ${
                      isSelected
                        ? 'border-[#006d5a] bg-[#006d5a]'
                        : 'border-[#ebe6df]'
                    }`}
                  >
                    {isSelected && (
                      <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-[#3d2c24]">{item.name}</p>
                    <p className="text-[10px] text-[#a39e97]">{item.category}</p>
                  </div>
                  {sem !== 'green' && (
                    <div className={`size-1.5 shrink-0 rounded-full ${sem === 'red' ? 'bg-[#ea504c]' : 'bg-[#d4943a]'}`} />
                  )}
                </button>
              )
            })}
            {filteredAssignable.length === 0 && (
              <p className="py-8 text-center text-xs text-[#a39e97]">
                No hay productos disponibles
              </p>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[#ebe6df] pt-3">
            <p className="text-xs text-[#a39e97]">
              {selectedItems.size} seleccionados
            </p>
            <div className="flex gap-2">
              <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24] hover:bg-[#faf8f5] text-xs h-9" />}>
                Cancelar
              </DialogClose>
              <Button
                onClick={handleAssign}
                disabled={assigning}
                className="rounded-xl bg-[#006d5a] text-white hover:bg-[#004d3f] text-xs h-9"
              >
                {assigning && <Loader2 className="size-3.5 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SupplierCard with low stock alerts
// ---------------------------------------------------------------------------

type SupplierCardProps = {
  supplier: Supplier
  isEncargado: boolean
  lowStockItems: LowStockItem[]
  linkedCount: number
  whatsAppMessage: string
  onEdit: () => void
  onDelete: () => void
  onAssign: () => void
}

function SupplierCard({
  supplier,
  isEncargado,
  lowStockItems,
  linkedCount,
  whatsAppMessage,
  onEdit,
  onDelete,
  onAssign,
}: SupplierCardProps) {
  const phoneDigits = supplier.phone ? stripNonDigits(supplier.phone) : null
  const hasAlerts = lowStockItems.length > 0

  return (
    <div className={`rounded-xl p-5 space-y-3 transition-all ${
      hasAlerts
        ? 'bg-white ring-2 ring-[#ea504c]/20 shadow-sm'
        : 'card-elevated hover-lift'
    }`}>
      {/* Name + category + edit/delete */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[#3d2c24]">{supplier.name}</h3>
            {hasAlerts && (
              <span className="flex items-center gap-1 rounded-full bg-[#ea504c]/10 px-2 py-0.5 text-[10px] font-bold text-[#ea504c]">
                <AlertTriangle className="size-3" />
                {lowStockItems.length}
              </span>
            )}
          </div>
          {supplier.contact_name && (
            <p className="text-xs text-[#a39e97]">
              {supplier.contact_name}
            </p>
          )}
          <div className="flex items-center gap-1.5">
            {supplier.category && (
              <span className="inline-block rounded-full bg-[#f0f7f5] px-2.5 py-0.5 text-[11px] font-semibold text-[#006d5a]">
                {supplier.category}
              </span>
            )}
            {linkedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#faf8f5] px-2 py-0.5 text-[10px] font-medium text-[#a39e97]">
                <Package className="size-2.5" />
                {linkedCount}
              </span>
            )}
          </div>
        </div>
        {isEncargado && (
          <div className="flex gap-1">
            <button
              onClick={onAssign}
              className="icon-btn hover:bg-[#f0f7f5] hover:text-[#006d5a]"
              title="Vincular productos"
            >
              <Package className="size-4" />
            </button>
            <button
              onClick={onEdit}
              className="icon-btn hover:bg-[#faf8f5] hover:text-[#3d2c24]"
            >
              <Pencil className="size-4" />
            </button>
            <button
              onClick={onDelete}
              className="icon-btn hover:bg-[#fef2f2] hover:text-[#ea504c]"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>

      {/* Low stock items */}
      {hasAlerts && (
        <div className="rounded-xl bg-[#fef7ed] p-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#d4943a]">
            Productos con stock bajo
          </p>
          {lowStockItems.map((item) => (
            <LowStockRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Contact info */}
      {(supplier.phone || supplier.email) && (
        <div className="space-y-1.5 text-xs text-[#a39e97]">
          {supplier.phone && (
            <a href={`tel:${supplier.phone}`} className="flex items-center gap-2 hover:text-[#006d5a] transition-colors">
              <Phone className="size-3 shrink-0" />
              <span className="text-[#3d2c24] underline decoration-dotted">{supplier.phone}</span>
            </a>
          )}
          {supplier.email && (
            <a href={`mailto:${supplier.email}`} className="flex items-center gap-2 hover:text-[#006d5a] transition-colors">
              <Mail className="size-3 shrink-0" />
              <span className="text-[#3d2c24] underline decoration-dotted">{supplier.email}</span>
            </a>
          )}
        </div>
      )}

      {/* Quick action buttons */}
      <div className="flex gap-2 pt-1">
        {phoneDigits ? (
          <a
            href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(whatsAppMessage)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <button className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-all active:scale-95 ${
              hasAlerts
                ? 'border-[#25D366] bg-[#25D366] text-white hover:bg-[#1da851]'
                : 'border-[#ebe6df] bg-[#fefcf9] text-[#25D366] hover:bg-[#25D366] hover:text-white hover:border-[#25D366]'
            }`}>
              <MessageCircle className="size-4" />
              {hasAlerts ? 'Pedir por WhatsApp' : 'WhatsApp'}
            </button>
          </a>
        ) : (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-[#ebe6df] px-3 py-2 text-xs font-medium text-[#a39e97] transition-all hover:border-[#25D366] hover:text-[#25D366] active:scale-95"
          >
            <MessageCircle className="size-4" />
            Agregar teléfono
          </button>
        )}
        {phoneDigits && (
          <a href={`tel:${supplier.phone}`}>
            <button className="flex size-9 items-center justify-center rounded-full border border-[#ebe6df] bg-[#fefcf9] text-[#3d2c24] transition-all hover:bg-[#f0f7f5] hover:text-[#006d5a] hover:border-[#006d5a]/20 active:scale-95">
              <Phone className="size-4" />
            </button>
          </a>
        )}
        {supplier.email && (
          <a href={`mailto:${supplier.email}`}>
            <button className="flex size-9 items-center justify-center rounded-full border border-[#ebe6df] bg-[#fefcf9] text-[#006d5a] transition-all hover:bg-[#006d5a] hover:text-white hover:border-[#006d5a] active:scale-95">
              <Mail className="size-4" />
            </button>
          </a>
        )}
      </div>

      {/* Notes */}
      {supplier.notes && (
        <p className="text-xs text-[#a39e97] italic leading-relaxed border-t border-[#ebe6df] pt-3">
          {supplier.notes}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Low stock row
// ---------------------------------------------------------------------------

function LowStockRow({ item }: { item: LowStockItem }) {
  const semaphore = getSemaphore(item.current_qty, item.min_qty)
  const isRed = semaphore === 'red'

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`size-1.5 shrink-0 rounded-full ${isRed ? 'bg-[#ea504c]' : 'bg-[#d4943a]'}`} />
        <span className={`truncate text-xs ${isRed ? 'font-semibold text-[#ea504c]' : 'text-[#3d2c24]'}`}>
          {item.name}
        </span>
      </div>
      <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[#a39e97]">
        {item.current_qty} / {item.min_qty} {item.unit}
      </span>
    </div>
  )
}
