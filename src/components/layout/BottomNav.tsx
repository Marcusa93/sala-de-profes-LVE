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
  Menu,
  MessageCircle,
  Users,
  AlertTriangle,
  Truck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppRole } from '@/types/database'
import { cn } from '@/lib/utils'
import { useState } from 'react'

// ---------------------------------------------------------------------------
// Nav item types
// ---------------------------------------------------------------------------

type NavItem = {
  label: string
  href: string
  icon: LucideIcon
}

type ExpandableNavItem = {
  label: string
  icon: LucideIcon
  children: NavItem[]
}

// ---------------------------------------------------------------------------
// Nav config per role
// ---------------------------------------------------------------------------

const BASE_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Mi Turno', href: '/attendance', icon: Clock },
  { label: 'Horarios', href: '/shifts', icon: Calendar },
  { label: 'Avisos', href: '/announcements', icon: Bell },
]

const ENCARGADO_MORE: ExpandableNavItem = {
  label: 'Mas',
  icon: Menu,
  children: [
    { label: 'Proveedores', href: '/suppliers', icon: Truck },
    { label: 'Stock', href: '/stock', icon: Package },
    { label: 'Alertas', href: '/stock/alerts', icon: AlertTriangle },
    { label: 'Equipo', href: '/team', icon: Users },
    { label: 'Chatbot', href: '/chatbot', icon: MessageCircle },
  ],
}

function getNavItems(role?: AppRole): { items: NavItem[]; more?: ExpandableNavItem } {
  if (role === 'encargado') {
    return { items: BASE_NAV, more: ENCARGADO_MORE }
  }
  if (role === 'chef') {
    return {
      items: [...BASE_NAV, { label: 'Stock', href: '/stock', icon: Package }],
    }
  }
  return { items: BASE_NAV }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BottomNav() {
  const pathname = usePathname()
  const { profile } = useProfileContext()
  const [moreOpen, setMoreOpen] = useState(false)

  const { items, more } = getNavItems(profile?.role)

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  function isMoreActive() {
    if (!more) return false
    return more.children.some((child) => isActive(child.href))
  }

  return (
    <>
      {/* "More" overlay menu */}
      {moreOpen && more && (
        <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/20" />
          <div
            className="absolute bottom-16 left-0 right-0 mx-4 rounded-xl border border-border bg-card p-2 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 gap-1">
              {more.children.map((child) => {
                const Icon = child.icon
                const active = isActive(child.href)
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-xs font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                    {child.label}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom navigation bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="flex h-16 items-center justify-around px-2">
          {items.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium transition-colors',
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className={cn('size-5', active && 'text-primary')} />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}

          {/* "More" button for encargado */}
          {more && (
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium transition-colors',
                moreOpen || isMoreActive()
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Menu
                className={cn(
                  'size-5',
                  (moreOpen || isMoreActive()) && 'text-primary',
                )}
              />
              <span>Mas</span>
            </button>
          )}
        </div>
      </nav>
    </>
  )
}
