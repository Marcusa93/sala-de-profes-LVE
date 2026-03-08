'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Settings, LogOut, Loader2, User, Save } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { ROLES } from '@/lib/constants'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConfiguracionPage() {
  const router = useRouter()
  const { profile, loading: profileLoading, refresh } = useProfileContext()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // Initialize form once profile loads
  if (profile && !initialized) {
    setFirstName(profile.first_name ?? '')
    setLastName(profile.last_name ?? '')
    setPhone(profile.phone ?? '')
    setInitialized(true)
  }

  // -------------------------------------------------------------------------
  // Save profile
  // -------------------------------------------------------------------------

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()

    if (!profile) return
    if (!firstName.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim() || null,
        })
        .eq('id', profile.id)

      if (error) throw error

      toast.success('Perfil actualizado')
      await refresh()
    } catch (err) {
      console.error(err)
      toast.error('Error al actualizar perfil')
    } finally {
      setSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  async function handleLogout() {
    setLoggingOut(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/login')
    } catch (err) {
      console.error(err)
      toast.error('Error al cerrar sesion')
      setLoggingOut(false)
    }
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

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

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  const roleConfig = ROLES[profile.role]

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Header */}
      <h1 className="text-xl font-semibold tracking-tight">
        <Settings className="mb-0.5 mr-1.5 inline-block size-5 text-primary" />
        Configuracion
      </h1>

      {/* Profile info card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="size-4" />
            Mi Perfil
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Read-only info */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Rol</span>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: roleConfig.color + '1A',
                  color: roleConfig.color,
                }}
              >
                {roleConfig.emoji} {roleConfig.label}
              </span>
            </div>
          </div>

          <Separator />

          {/* Editable form */}
          <form onSubmit={handleSave} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="config-first-name">Nombre</Label>
              <Input
                id="config-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Tu nombre"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="config-last-name">Apellido</Label>
              <Input
                id="config-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Tu apellido"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="config-phone">Telefono</Label>
              <Input
                id="config-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+54 11 1234-5678"
              />
            </div>

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Guardar cambios
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Logout */}
      <Card>
        <CardContent>
          <Button
            variant="destructive"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full"
          >
            {loggingOut ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            Cerrar sesion
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
