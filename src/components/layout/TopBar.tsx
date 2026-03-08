'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { RoleBadge } from '@/components/ui/RoleBadge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Coffee, User, Settings, LogOut } from 'lucide-react'
import { toast } from 'sonner'

export function TopBar() {
  const router = useRouter()
  const { profile } = useProfileContext()

  const firstName = profile?.first_name ?? ''
  const fullName = profile ? `${profile.first_name} ${profile.last_name}` : ''
  const initials = profile
    ? `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.toUpperCase()
    : '?'

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('Sesion cerrada')
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      {/* Brand */}
      <div className="flex items-center gap-2">
        <Coffee className="size-5 text-primary" />
        <span className="text-sm font-semibold text-foreground">
          La Vieja Escuela
        </span>
      </div>

      {/* User Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar size="sm">
            {profile?.avatar_url && (
              <AvatarImage src={profile.avatar_url} alt={fullName} />
            )}
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {firstName}
          </span>
          {profile?.role && <RoleBadge role={profile.role} />}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={8} className="w-48">
          {/* User info inside menu */}
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium text-foreground">
              {fullName}
            </p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => router.push('/configuracion')}
          >
            <User className="size-4" />
            Mi Perfil
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => router.push('/configuracion')}
          >
            <Settings className="size-4" />
            Configuracion
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={handleLogout}
          >
            <LogOut className="size-4" />
            Cerrar Sesion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
