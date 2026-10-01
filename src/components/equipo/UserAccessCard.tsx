'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// "Acceso a la app" en la ficha: email y contraseña con los que la persona
// entra. Cambia la misma cuenta, así no se pierde su historial.
// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]'

export function UserAccessCard({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/admin/user-access?userId=${encodeURIComponent(userId)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) setBlocked(d.error ?? 'No se pudo cargar el acceso')
        else {
          setBlocked(null)
          setCurrentEmail(d.email ?? null)
          setEmail(d.email ?? '')
        }
      })
      .catch(() => { if (!cancelled) setBlocked('No se pudo cargar el acceso') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  const nuevoEmail = email.trim().toLowerCase()
  const cambiaEmail = !!nuevoEmail && nuevoEmail !== (currentEmail ?? '')
  const hayCambios = cambiaEmail || password.length > 0

  async function handleSave() {
    if (!hayCambios) return
    if (password && password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/user-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          ...(cambiaEmail ? { email: nuevoEmail } : {}),
          ...(password ? { password } : {}),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'No se pudo cambiar el acceso')
        return
      }
      setCurrentEmail(d.email ?? nuevoEmail)
      setEmail(d.email ?? nuevoEmail)
      setPassword('')
      setShowPassword(false)
      toast.success(
        cambiaEmail && password ? 'Email y contraseña actualizados'
          : cambiaEmail ? 'Email actualizado'
          : 'Contraseña actualizada',
      )
    } catch {
      toast.error('Error de conexión: no se guardó el acceso')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl bg-white px-5 py-5 shadow-sm ring-1 ring-[#ebe6df] space-y-4">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-[#a39e97]">
        <KeyRound className="size-3.5" /> Acceso a la app
      </h2>

      {loading ? (
        <div className="flex justify-center py-2">
          <Loader2 className="size-5 animate-spin text-[#006d5a]" />
        </div>
      ) : blocked ? (
        <p className="text-sm text-[#a39e97]">{blocked}</p>
      ) : (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">Email para entrar</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              placeholder="nombre@gmail.com"
              className={inputCls}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">Contraseña nueva</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Dejar vacío para no cambiarla"
                className={`${inputCls} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[#a39e97]"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-[11px] text-[#a39e97]">Mínimo 6 caracteres. Pasásela a la persona para que entre.</p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !hayCambios}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#006d5a] px-4 py-2.5 text-sm font-semibold text-[#006d5a] transition hover:bg-[#f0f7f5] disabled:border-[#ebe6df] disabled:text-[#a39e97] disabled:hover:bg-transparent"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? 'Guardando…' : 'Guardar acceso'}
          </button>
        </>
      )}
    </div>
  )
}
