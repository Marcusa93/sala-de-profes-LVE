'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
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
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import type { Supplier, SupplierInsert } from '@/types/database'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
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
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [formData, setFormData] = useState<SupplierFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isEncargado = profile?.role === 'encargado'

  // -------------------------------------------------------------------------
  // Fetch suppliers
  // -------------------------------------------------------------------------

  const fetchSuppliers = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (error) throw error
      setSuppliers(data ?? [])
    } catch (err) {
      console.error(err)
      toast.error('Error al cargar proveedores')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (profile) fetchSuppliers()
  }, [profile, fetchSuppliers])

  // -------------------------------------------------------------------------
  // Filtered suppliers
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let result = suppliers
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
  }, [suppliers, searchQuery])

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
        toast.success('Proveedor actualizado')
      } else {
        const { error } = await supabase.from('suppliers').insert(payload)

        if (error) throw error
        toast.success('Proveedor creado')
      }

      setDialogOpen(false)
      fetchSuppliers()
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

      toast.success('Proveedor eliminado')
      setDeleteDialogOpen(false)
      setSupplierToDelete(null)
      fetchSuppliers()
    } catch (err) {
      console.error(err)
      toast.error('Error al eliminar proveedor')
    } finally {
      setDeleting(false)
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
          <Truck className="mb-0.5 mr-1.5 inline-block size-5 text-primary" />
          Proveedores
        </h1>
        {isEncargado && (
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="size-4" />
            Agregar Proveedor
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, contacto, email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
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
              onEdit={() => openEditDialog(supplier)}
              onDelete={() => openDeleteDialog(supplier)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
            </DialogTitle>
            <DialogDescription>
              {editingSupplier
                ? 'Modifica los datos del proveedor'
                : 'Completa los datos del nuevo proveedor'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="supplier-name">Nombre *</Label>
              <Input
                id="supplier-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Nombre del proveedor"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-contact">Persona de contacto</Label>
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
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-phone">Telefono</Label>
              <Input
                id="supplier-phone"
                type="tel"
                value={formData.phone}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, phone: e.target.value }))
                }
                placeholder="+54 11 1234-5678"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-email">Email</Label>
              <Input
                id="supplier-email"
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="proveedor@email.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-notes">Notas</Label>
              <Textarea
                id="supplier-notes"
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
                {editingSupplier ? 'Guardar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar proveedor</DialogTitle>
            <DialogDescription>
              Estas seguro de que deseas eliminar a{' '}
              <span className="font-medium text-foreground">
                {supplierToDelete?.name}
              </span>
              ? Esta accion se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SupplierCard
// ---------------------------------------------------------------------------

type SupplierCardProps = {
  supplier: Supplier
  isEncargado: boolean
  onEdit: () => void
  onDelete: () => void
}

function SupplierCard({
  supplier,
  isEncargado,
  onEdit,
  onDelete,
}: SupplierCardProps) {
  const phoneDigits = supplier.phone ? stripNonDigits(supplier.phone) : null

  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        {/* Name and actions */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-medium text-foreground">{supplier.name}</h3>
            {supplier.contact_name && (
              <p className="text-xs text-muted-foreground">
                {supplier.contact_name}
              </p>
            )}
          </div>
          {isEncargado && (
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-xs" onClick={onEdit}>
                <Pencil className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={onDelete}>
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          )}
        </div>

        {/* Contact info */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {supplier.phone && (
            <span className="flex items-center gap-1">
              <Phone className="size-3" />
              {supplier.phone}
            </span>
          )}
          {supplier.email && (
            <span className="flex items-center gap-1">
              <Mail className="size-3" />
              {supplier.email}
            </span>
          )}
        </div>

        {/* Quick action buttons */}
        <div className="flex gap-2">
          {phoneDigits && (
            <>
              <a
                href={`https://wa.me/${phoneDigits}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="xs">
                  <MessageCircle className="size-3" />
                  WhatsApp
                </Button>
              </a>
              <a href={`tel:${supplier.phone}`}>
                <Button variant="outline" size="xs">
                  <Phone className="size-3" />
                  Llamar
                </Button>
              </a>
            </>
          )}
          {supplier.email && (
            <a href={`mailto:${supplier.email}`}>
              <Button variant="outline" size="xs">
                <Mail className="size-3" />
                Email
              </Button>
            </a>
          )}
        </div>

        {/* Notes */}
        {supplier.notes && (
          <p className="text-xs text-muted-foreground italic">
            {supplier.notes}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
