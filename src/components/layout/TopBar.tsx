'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Settings, LogOut, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { ROLES } from '@/lib/constants'
import { useState, useEffect, useId } from 'react'

export function TopBar() {
  const router = useRouter()
  const { profile } = useProfileContext()
  const [scrolled, setScrolled] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    const handler = () => setScrolled(main.scrollTop > 20)
    main.addEventListener('scroll', handler, { passive: true })
    return () => main.removeEventListener('scroll', handler)
  }, [])

  const fullName = profile ? `${profile.first_name} ${profile.last_name}` : ''
  const initials = profile
    ? `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.toUpperCase()
    : '?'

  async function handleLogout() {
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error('Error al cerrar sesion')
      return
    }
    toast.success('Sesion cerrada')
    router.push('/login')
  }

  const roleConfig = profile?.role ? ROLES[profile.role] : null

  return (
    <header className={`sticky top-0 z-40 shrink-0 bg-[#006d5a] transition-all duration-200 ${scrolled ? 'shadow-md' : ''}`}>
      <div className={`flex items-center justify-between px-5 transition-all duration-200 ${scrolled ? 'h-[2.75rem]' : 'h-[3.75rem]'}`}>
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/Logos/logo negativo.png"
            alt="La Vieja Escuela"
            width={36}
            height={36}
            className="size-9 object-contain"
          />
          <div className="flex flex-col">
            <span className="font-display text-[15px] font-semibold leading-tight tracking-tight text-white">
              Sala de Profes
            </span>
            <span className={`text-[9px] font-medium tracking-[0.12em] text-white/40 transition-all duration-200 ${scrolled ? 'h-0 overflow-hidden opacity-0' : 'opacity-100'}`}>
              LA VIEJA ESCUELA
            </span>
          </div>
        </Link>

        {/* User dropdown — only render after mount to avoid base-ui ID hydration mismatch */}
        {mounted ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30">
              <Avatar size="sm">
                {profile?.avatar_url && (
                  <AvatarImage src={profile.avatar_url} alt={fullName} />
                )}
                <AvatarFallback className="bg-white/15 text-[10px] font-bold text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="size-3 text-white/40" />
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-xl">
              <div className="px-3 py-2.5">
                <p className="text-sm font-semibold text-foreground">{fullName}</p>
                {roleConfig && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {roleConfig.emoji} {roleConfig.label}
                  </p>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push('/configuracion')}>
                <Settings className="size-4" />
                Configuración
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
                <LogOut className="size-4" />
                Cerrar Sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2 rounded-xl px-2.5 py-2" suppressHydrationWarning>
            <Avatar size="sm">
              <AvatarFallback className="bg-white/15 text-[10px] font-bold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <ChevronDown className="size-3 text-white/40" />
          </div>
        )}
      </div>
    </header>
  )
}
