'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Coffee, Lock, Mail, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!email || !password) {
      toast.error('Por favor, completa todos los campos')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        if (error.message === 'Invalid login credentials') {
          toast.error('Credenciales incorrectas. Revisa tu email y contrasena.')
        } else {
          toast.error(error.message)
        }
        return
      }

      toast.success('Bienvenido de vuelta!')
      router.push('/')
      router.refresh()
    } catch {
      toast.error('Error inesperado. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-gradient-to-br from-[#F5E6D3] via-[#FAF6F1] to-[#E6D5C3] px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo & Brand */}
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex items-center justify-center rounded-2xl bg-[#8B4513] p-3 shadow-lg">
            <Coffee className="size-8 text-[#FAF6F1]" />
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-[#3C2415]">
            La Vieja Escuela
          </h1>
          <p className="text-sm font-medium text-[#8C7161]">Sala de Profes</p>
        </div>

        {/* Login Card */}
        <Card className="border-0 shadow-xl ring-0">
          <CardContent className="pt-2">
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {/* Email */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-[#3C2415]">
                  <Mail className="size-3.5 text-[#8C7161]" />
                  Correo electronico
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  disabled={loading}
                  className="h-10"
                />
              </div>

              {/* Password */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-[#3C2415]">
                  <Lock className="size-3.5 text-[#8C7161]" />
                  Contrasena
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Tu contrasena"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading}
                  className="h-10"
                />
              </div>

              {/* Submit */}
              <Button
                type="submit"
                size="lg"
                disabled={loading}
                className="mt-1 h-10 w-full text-sm font-semibold"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    <Coffee className="size-4" />
                    Iniciar sesion
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-[#8C7161]">
          Acceso exclusivo para el equipo de La Vieja Escuela
        </p>
      </div>
    </div>
  )
}
