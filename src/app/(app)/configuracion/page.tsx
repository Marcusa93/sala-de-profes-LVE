'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { ROLES } from '@/lib/constants'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleBadge } from '@/components/ui/RoleBadge'

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
        <div className="flex flex-col items-center gap-3 text-[#a39e97]">
          <Loader2 className="size-8 animate-spin text-[#006d5a]" />
          <p className="text-sm font-medium">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#a39e97]">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  const roleConfig = ROLES[profile.role]
  const initials =
    (profile.first_name?.[0] ?? '').toUpperCase() +
    (profile.last_name?.[0] ?? '').toUpperCase()

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-md space-y-6 px-1 pb-8">
      {/* Page title */}
      <h1 className="font-display text-2xl font-semibold tracking-tight text-[#3d2c24]">
        Mi Perfil
      </h1>

      {/* Profile header */}
      <div className="flex flex-col items-center gap-4 py-4">
        {/* Avatar */}
        <div className="flex size-20 sm:size-24 items-center justify-center rounded-full bg-[#f0f7f5]">
          <span className="font-display text-2xl font-bold text-[#006d5a]">
            {initials || '?'}
          </span>
        </div>

        {/* Name */}
        <p className="font-display text-xl font-semibold text-[#3d2c24]">
          {profile.first_name} {profile.last_name}
        </p>

        {/* Role badge */}
        <RoleBadge role={profile.role} size="md" />
      </div>

      {/* Form card */}
      <div className="card-elevated-lg p-4 sm:p-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="config-first-name" className="text-sm font-medium text-[#3d2c24]">
              Nombre
            </Label>
            <Input
              id="config-first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Tu nombre"
              autoComplete="given-name"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5] focus-visible:ring-[#006d5a]/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="config-last-name" className="text-sm font-medium text-[#3d2c24]">
              Apellido
            </Label>
            <Input
              id="config-last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Tu apellido"
              autoComplete="family-name"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5] focus-visible:ring-[#006d5a]/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="config-phone" className="text-sm font-medium text-[#3d2c24]">
              Telefono
            </Label>
            <Input
              id="config-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+54 11 1234-5678"
              autoComplete="tel"
              inputMode="tel"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5] focus-visible:ring-[#006d5a]/20"
            />
          </div>

          {/* Role display (read-only) */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#3d2c24]">Rol</Label>
            <div className="flex items-center rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-4 py-3">
              <RoleBadge role={profile.role} size="md" />
            </div>
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[#006d5a] py-3 text-white shadow-sm hover:bg-[#005a4a]"
          >
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Guardar cambios
          </Button>
        </form>
      </div>

      {/* Logout */}
      <div className="card-elevated-lg p-4 sm:p-6">
        <Button
          variant="outline"
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full rounded-xl border-[#ea504c]/40 bg-[#ea504c] py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#d43d39]"
        >
          {loggingOut ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 size-4" />
          )}
          Cerrar Sesión
        </Button>
      </div>
    </div>
  )
}
