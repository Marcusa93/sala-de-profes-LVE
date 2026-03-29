'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useProfileContext } from '@/lib/hooks/use-profile'
import {
  Home,
  Clock,
  Calendar,
  Bell,
  Package,
  MoreHorizontal,
  MessageCircle,
  Users,
  AlertTriangle,
  Truck,
  ChefHat,
  UtensilsCrossed,
  Bot,
  BookOpen,
  LayoutDashboard,
  Coffee,
  ShoppingCart,
  FolderOpen,
  Lightbulb,
  Wine,
  BarChart3,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppRole } from '@/types/database'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, StaggerList, StaggerItem } from '@/components/ui/motion'
import { onNotificationRead } from '@/lib/sounds'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NavItem = {
  label: string
  href: string
  icon: LucideIcon
}

type NavGroup = {
  label: string
  items: NavItem[]
}

type ExpandableNavItem = {
  label: string
  icon: LucideIcon
  groups: NavGroup[]
}

// ---------------------------------------------------------------------------
// Nav config per role — grouped by section
// ---------------------------------------------------------------------------

const BASE_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Mi Turno', href: '/mi-turno', icon: Clock },
  { label: 'Horarios', href: '/mis-horarios', icon: Calendar },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

// SOCIO — todo accesible, 2 grupos limpios
const SOCIO_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'El local',
      items: [
        { label: 'Control', href: '/admin', icon: LayoutDashboard },
        { label: 'Equipo', href: '/equipo', icon: Users },
        { label: 'Turnos', href: '/equipo/turnos', icon: Calendar },
        { label: 'Cocina', href: '/cocina', icon: UtensilsCrossed },
        { label: 'Pedidos cocina', href: '/cocina/pedidos', icon: ShoppingCart },
        { label: 'Barra', href: '/cocina/barra', icon: Coffee },
        { label: 'Recetario', href: '/recetas', icon: BookOpen },
      ],
    },
    {
      label: 'Inventario y compras',
      items: [
        { label: 'Stock general', href: '/stock', icon: Package },
        { label: 'Vajilla', href: '/vajilla', icon: Wine },
        { label: 'Compras', href: '/pedidos', icon: ShoppingCart },
        { label: 'Proveedores', href: '/proveedores', icon: Truck },
        { label: 'La Vieja', href: '/asistente', icon: Bot },
      ],
    },
  ],
}

// ENCARGADO — gestiona todo lo operativo
const ENCARGADO_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'El local',
      items: [
        { label: 'Control', href: '/admin', icon: LayoutDashboard },
        { label: 'Equipo', href: '/equipo', icon: Users },
        { label: 'Cocina', href: '/cocina', icon: UtensilsCrossed },
        { label: 'Pedidos cocina', href: '/cocina/pedidos', icon: ShoppingCart },
        { label: 'Barra', href: '/cocina/barra', icon: Coffee },
        { label: 'Recetario', href: '/recetas', icon: BookOpen },
      ],
    },
    {
      label: 'Inventario y compras',
      items: [
        { label: 'Stock general', href: '/stock', icon: Package },
        { label: 'Vajilla', href: '/vajilla', icon: Wine },
        { label: 'Compras', href: '/pedidos', icon: ShoppingCart },
        { label: 'Proveedores', href: '/proveedores', icon: Truck },
        { label: 'La Vieja', href: '/asistente', icon: Bot },
      ],
    },
  ],
}

// CHEF — cocina y pedidos
const CHEF_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Cocina',
      items: [
        { label: 'Mi cocina', href: '/cocina', icon: UtensilsCrossed },
        { label: 'Pedir mercadería', href: '/cocina/pedidos', icon: ShoppingCart },
        { label: 'Recetario', href: '/recetas', icon: BookOpen },
        { label: 'La Vieja', href: '/asistente', icon: Bot },
      ],
    },
  ],
}

// COCINA — igual que chef
const COCINA_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Cocina',
      items: [
        { label: 'Mi cocina', href: '/cocina', icon: UtensilsCrossed },
        { label: 'Pedir mercadería', href: '/cocina/pedidos', icon: ShoppingCart },
        { label: 'Recetario', href: '/recetas', icon: BookOpen },
        { label: 'La Vieja', href: '/asistente', icon: Bot },
      ],
    },
  ],
}

// BARISTA — barra, vajilla y herramientas
const BARISTA_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Mi sector',
      items: [
        { label: 'Stock barra', href: '/cocina/barra', icon: Coffee },
        { label: 'Vajilla', href: '/vajilla', icon: Wine },
      ],
    },
    {
      label: 'Herramientas',
      items: [
        { label: 'La Vieja', href: '/asistente', icon: Bot },
      ],
    },
  ],
}

// RUNNER — mínimo
const RUNNER_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: '',
      items: [
        { label: 'La Vieja', href: '/asistente', icon: Bot },
      ],
    },
  ],
}

function getAllMoreItems(more?: ExpandableNavItem): NavItem[] {
  if (!more) return []
  return more.groups.flatMap((g) => g.items)
}

// Socios get Ventas + Expedientes in the main bar
const SOCIO_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Ventas', href: '/ventas', icon: BarChart3 },
  { label: 'Expedientes', href: '/expedientes', icon: FolderOpen },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

function getNavItems(role?: AppRole): { items: NavItem[]; more?: ExpandableNavItem } {
  if (role === 'socio') return { items: SOCIO_NAV, more: SOCIO_MORE }
  if (role === 'encargado') return { items: BASE_NAV, more: ENCARGADO_MORE }
  if (role === 'chef') return { items: BASE_NAV, more: CHEF_MORE }
  if (role === 'cocina') return { items: BASE_NAV, more: COCINA_MORE }
  if (role === 'barista') return { items: BASE_NAV, more: BARISTA_MORE }
  if (role === 'runner') return { items: BASE_NAV, more: RUNNER_MORE }
  return { items: BASE_NAV, more: RUNNER_MORE }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BottomNav() {
  const pathname = usePathname()
  const { profile } = useProfileContext()
  const [moreOpen, setMoreOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const { items, more } = getNavItems(profile?.role)

  // Fetch unread notification count
  const fetchUnread = useCallback(async () => {
    if (!profile) return
    try {
      const supabase = createClient()
      const [annResult, readsResult] = await Promise.all([
        supabase.rpc('get_my_announcements'),
        supabase
          .from('announcement_reads')
          .select('announcement_id')
          .eq('user_id', profile.id),
      ])
      if (annResult.error || !annResult.data) return
      const readSet = new Set((readsResult.data ?? []).map((r) => r.announcement_id))
      const unread = (annResult.data as { id: string }[]).filter((a) => !readSet.has(a.id)).length
      setUnreadCount(unread)
    } catch {
      // Silently fail — badge will show stale count
    }
  }, [profile])

  useEffect(() => {
    fetchUnread()
    const interval = setInterval(fetchUnread, 60_000)
    return () => clearInterval(interval)
  }, [fetchUnread])

  // Immediately decrement badge when a notification is marked as read
  useEffect(() => {
    return onNotificationRead(() => {
      setUnreadCount((prev) => Math.max(0, prev - 1))
    })
  }, [])

  useEffect(() => {
    if (pathname === '/notificaciones') {
      const timer = setTimeout(fetchUnread, 2000)
      return () => clearTimeout(timer)
    }
  }, [pathname, fetchUnread])

  // Close on Escape
  useEffect(() => {
    if (!moreOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [moreOpen])

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  function isMoreActive() {
    if (!more) return false
    return getAllMoreItems(more).some((child) => isActive(child.href))
  }

  return (
    <>
      {/* "More" overlay panel — animated */}
      <AnimatePresence>
        {moreOpen && more && (
          <motion.div
            className="fixed inset-0 z-40"
            onClick={() => setMoreOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="absolute inset-0 bg-black/20 backdrop-blur-[3px]" />
            <motion.div
              className="absolute bottom-[4.5rem] left-3 right-3 glass rounded-2xl p-4 ring-1 ring-[#ebe6df]/50 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="section-label">Más opciones</span>
                <motion.button
                  onClick={() => setMoreOpen(false)}
                  aria-label="Cerrar"
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
                  whileTap={{ scale: 0.85 }}
                >
                  <X className="size-4" />
                </motion.button>
              </div>
              <StaggerList className="space-y-3" staggerDelay={0.03}>
                {more.groups.map((group) => (
                  <StaggerItem key={group.label || 'default'}>
                    {group.label && (
                      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {group.label}
                      </p>
                    )}
                    <div className="grid grid-cols-3 gap-1.5">
                      {group.items.map((child) => {
                        const Icon = child.icon
                        const active = isActive(child.href)
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setMoreOpen(false)}
                            className={cn(
                              'flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-[11px] font-medium transition-all active:scale-95',
                              active
                                ? 'bg-[#006d5a] text-white'
                                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                            )}
                          >
                            <Icon className="size-5" strokeWidth={1.75} />
                            {child.label}
                          </Link>
                        )
                      })}
                    </div>
                  </StaggerItem>
                ))}
              </StaggerList>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation bar */}
      <nav
        aria-label="Navegacion principal"
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-[#fefcf9] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex h-[4.25rem] items-center justify-around px-1">
          {items.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            const showBadge = item.href === '/notificaciones' && unreadCount > 0
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-all active:scale-90',
                  active
                    ? 'text-[#006d5a]'
                    : 'text-[#a39e97] hover:text-foreground',
                )}
              >
                <div className="relative flex size-11 items-center justify-center rounded-xl transition-all">
                  {/* Animated active background */}
                  {active && (
                    <motion.div
                      layoutId="nav-active-bg"
                      className="absolute inset-0 rounded-xl bg-[#e8f5f1]"
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                  <Icon
                    className="relative size-[22px]"
                    strokeWidth={active ? 2.25 : 1.75}
                  />
                  {showBadge && (
                    <span className="absolute -right-1.5 -top-1 flex size-4.5 items-center justify-center rounded-full bg-[#ea504c] text-[9px] font-bold text-white shadow-sm">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </div>
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}

          {more && (
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              aria-expanded={moreOpen}
              aria-label="Mas opciones"
              className={cn(
                'relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-all active:scale-90',
                moreOpen || isMoreActive()
                  ? 'text-[#006d5a]'
                  : 'text-[#a39e97] hover:text-foreground',
              )}
            >
              <div className="relative flex size-11 items-center justify-center rounded-xl transition-all">
                {(moreOpen || isMoreActive()) && !items.some((i) => isActive(i.href)) && (
                  <motion.div
                    layoutId="nav-active-bg"
                    className="absolute inset-0 rounded-xl bg-[#e8f5f1]"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
                <MoreHorizontal
                  className="relative size-[22px]"
                  strokeWidth={moreOpen || isMoreActive() ? 2.25 : 1.75}
                />
              </div>
              <span>Más</span>
            </button>
          )}
        </div>
      </nav>
    </>
  )
}
