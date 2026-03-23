'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  Calendar,
  Package,
  Bell,
  Store,
} from 'lucide-react'

const NAV_ITEMS = [
  { label: 'Control', href: '/admin', icon: LayoutDashboard },
  { label: 'Fudo', href: '/admin/fudo', icon: Store },
  { label: 'Asistencia', href: '/admin/reportes/asistencia', icon: Users },
  { label: 'Turnos', href: '/admin/reportes/turnos', icon: Calendar },
  { label: 'Stock', href: '/admin/reportes/stock', icon: Package },
  { label: 'Avisos', href: '/admin/reportes/notificaciones', icon: Bell },
]

export function AdminSubNav() {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pt-3 pb-4 sm:-mx-6 sm:px-6">
      <div className="flex gap-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition-all active:scale-95',
                active
                  ? 'bg-[#006d5a] text-white shadow-sm'
                  : 'bg-white text-[#a39e97] ring-1 ring-[#ebe6df] hover:text-[#3d2c24]',
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
