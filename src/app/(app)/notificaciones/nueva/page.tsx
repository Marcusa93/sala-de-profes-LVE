'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Megaphone,
  Loader2,
  ShieldAlert,
  ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
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
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import {
  ANNOUNCEMENT_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  ROLE_OPTIONS,
} from '@/lib/constants'
import type { AppRole, AnnouncementInsert } from '@/types/database'

// ---------------------------------------------------------------------------
// Scope options
// ---------------------------------------------------------------------------

const SCOPE_OPTIONS = [
  { value: 'todos', label: 'Todos' },
  { value: 'por_rol', label: 'Por rol' },
  { value: 'usuario', label: 'Usuario especifico' },
] as const

type Scope = (typeof SCOPE_OPTIONS)[number]['value']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmployeeOption = {
  id: string
  first_name: string
  last_name: string
  role: AppRole
}

// ---------------------------------------------------------------------------
// Create Notification Page
// ---------------------------------------------------------------------------

export default function NuevaNotificacionPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const router = useRouter()
  const supabase = createClient()

  const canCreate =
    profile?.role === 'encargado' || profile?.role === 'chef'

  // Form state
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [type, setType] = useState('general')
  const [priority, setPriority] = useState('low')
  const [scope, setScope] = useState<Scope>('todos')
  const [targetRole, setTargetRole] = useState<AppRole | ''>('')
  const [targetUserId, setTargetUserId] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [saving, setSaving] = useState(false)

  // Employees (for scope=usuario)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])

  // ------------------------------------------
  // Fetch employees
  // ------------------------------------------
  const fetchEmployees = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .eq('is_active', true)
        .order('first_name')

      if (error) throw error
      setEmployees(data ?? [])
    } catch (err) {
      console.error('Error al cargar empleados:', err)
    }
  }, [supabase])

  useEffect(() => {
    if (canCreate) {
      fetchEmployees()
    }
  }, [canCreate, fetchEmployees])

  // ------------------------------------------
  // Submit
  // ------------------------------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!profile) return
    if (!title.trim() || !body.trim()) {
      toast.error('El titulo y el contenido son obligatorios')
      return
    }

    setSaving(true)
    try {
      // Determine scope and targets based on form selection
      let dbScope: 'all' | 'role' | 'user' = 'all'
      let dbTargetRole: AppRole | null = null
      let dbTargetUserId: string | null = null

      if (scope === 'por_rol' && targetRole) {
        dbScope = 'role'
        dbTargetRole = targetRole as AppRole
      } else if (scope === 'usuario' && targetUserId) {
        dbScope = 'user'
        dbTargetUserId = targetUserId
      }

      const insertData: AnnouncementInsert = {
        title: title.trim(),
        body: body.trim(),
        type,
        priority,
        author_id: profile.id,
        scope: dbScope,
        target_role: dbTargetRole,
        target_user_id: dbTargetUserId,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      }

      const { error } = await supabase.from('announcements').insert(insertData)

      if (error) throw error

      toast.success('Notificacion creada correctamente')
      router.push('/notificaciones')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al crear la notificacion'
      toast.error('Error', { description: message })
    } finally {
      setSaving(false)
    }
  }

  // ------------------------------------------
  // Loading / Permission
  // ------------------------------------------
  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!profile || !canCreate) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center justify-center rounded-xl bg-muted p-3">
            <ShieldAlert className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium text-foreground">Sin permisos</h3>
          <p className="max-w-xs text-sm text-muted-foreground">
            Solo los encargados y chefs pueden crear notificaciones.
          </p>
        </div>
      </div>
    )
  }

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push('/notificaciones')}
      >
        <ArrowLeft className="size-4" />
        Volver
      </Button>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          <Megaphone className="mb-1 mr-1.5 inline-block size-6 text-primary" />
          Nueva Notificacion
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea un aviso o comunicado para el equipo
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="notif-title">Titulo</Label>
              <Input
                id="notif-title"
                placeholder="Titulo del aviso"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            {/* Body */}
            <div className="space-y-2">
              <Label htmlFor="notif-body">Contenido</Label>
              <Textarea
                id="notif-body"
                placeholder="Escribe el contenido del aviso..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                required
              />
            </div>

            {/* Type + Priority row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="notif-type">Tipo</Label>
                <Select value={type} onValueChange={(v) => v && setType(v)}>
                  <SelectTrigger className="w-full" id="notif-type">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {ANNOUNCEMENT_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notif-priority">Prioridad</Label>
                <Select value={priority} onValueChange={(v) => v && setPriority(v)}>
                  <SelectTrigger className="w-full" id="notif-priority">
                    <SelectValue placeholder="Prioridad" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Scope */}
            <div className="space-y-2">
              <Label htmlFor="notif-scope">Alcance</Label>
              <Select
                value={scope}
                onValueChange={(v) => {
                  if (!v) return
                  setScope(v as Scope)
                  setTargetRole('')
                  setTargetUserId('')
                }}
              >
                <SelectTrigger className="w-full" id="notif-scope">
                  <SelectValue placeholder="Alcance" />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Conditional: role select */}
            {scope === 'por_rol' && (
              <div className="space-y-2">
                <Label htmlFor="notif-target-role">Rol destinatario</Label>
                <Select
                  value={targetRole}
                  onValueChange={(v) => v && setTargetRole(v as AppRole)}
                >
                  <SelectTrigger className="w-full" id="notif-target-role">
                    <SelectValue placeholder="Seleccionar rol" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Conditional: user select */}
            {scope === 'usuario' && (
              <div className="space-y-2">
                <Label htmlFor="notif-target-user">
                  Usuario destinatario
                </Label>
                <Select
                  value={targetUserId}
                  onValueChange={(v) => v && setTargetUserId(v)}
                >
                  <SelectTrigger className="w-full" id="notif-target-user">
                    <SelectValue placeholder="Seleccionar usuario" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.first_name} {emp.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Expiration date */}
            <div className="space-y-2">
              <Label htmlFor="notif-expires">
                Fecha de expiracion (opcional)
              </Label>
              <Input
                id="notif-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/notificaciones')}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                )}
                Publicar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
