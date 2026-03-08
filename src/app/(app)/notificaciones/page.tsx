'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Bell, Plus, Loader2 } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  NotificationCard,
  type NotificationCardData,
} from '@/components/notifications/NotificationCard'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// Filter configuration
// ---------------------------------------------------------------------------

const FILTER_TABS = [
  { value: 'todos', label: 'Todos' },
  { value: 'urgent', label: 'Urgente' },
  { value: 'maintenance', label: 'Recordatorio' },
  { value: 'event', label: 'Operativo' },
  { value: 'general', label: 'General' },
] as const

type FilterTab = (typeof FILTER_TABS)[number]['value']

// ---------------------------------------------------------------------------
// Notifications Page
// ---------------------------------------------------------------------------

export default function NotificacionesPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = createClient()

  const [notifications, setNotifications] = useState<NotificationCardData[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterTab>('todos')

  const canCreate =
    profile?.role === 'encargado' || profile?.role === 'chef'

  // ------------------------------------------
  // Fetch notifications
  // ------------------------------------------
  const fetchNotifications = useCallback(async () => {
    if (!profile) return
    setLoading(true)

    try {
      // Fetch announcements using RPC
      const { data: announcements, error: annError } = await supabase
        .rpc('get_my_announcements')

      if (annError) throw annError

      // Fetch read statuses for current user
      const { data: reads, error: readsError } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('user_id', profile.id)

      if (readsError) throw readsError

      const readSet = new Set((reads ?? []).map((r) => r.announcement_id))
      setReadIds(readSet)

      // Fetch author names for announcements
      const authorIds = [...new Set((announcements ?? []).map((a: any) => a.author_id))]
      const { data: authors } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', authorIds)

      const authorMap = new Map((authors ?? []).map((a: any) => [a.id, a]))

      const mapped: NotificationCardData[] = (announcements ?? []).map(
        (a: any) => {
          const author = authorMap.get(a.author_id)
          return {
            id: a.id,
            title: a.title,
            body: a.body,
            type: a.type,
            priority: a.priority,
            author_id: a.author_id,
            scope: a.scope,
            target_role: a.target_role,
            expires_at: a.expires_at,
            is_active: a.is_active,
            created_at: a.created_at,
            updated_at: a.updated_at,
            author: author
              ? { first_name: author.first_name, last_name: author.last_name }
              : null,
            is_read: readSet.has(a.id),
          }
        },
      )

      setNotifications(mapped)
    } catch (err) {
      console.error('Error al cargar notificaciones:', err)
    } finally {
      setLoading(false)
    }
  }, [profile, supabase])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // ------------------------------------------
  // Handle mark as read callback
  // ------------------------------------------
  const handleMarkedRead = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    )
  }

  // ------------------------------------------
  // Filter notifications by active tab
  // ------------------------------------------
  const filteredNotifications =
    activeTab === 'todos'
      ? notifications
      : notifications.filter((n) => n.type === activeTab)

  const sortedNotifications = filteredNotifications

  // ------------------------------------------
  // Loading
  // ------------------------------------------
  if (profileLoading || loading) {
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

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <Bell className="mb-1 mr-1.5 inline-block size-6 text-primary" />
            Notificaciones
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Avisos y comunicados del equipo
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <Tabs
        defaultValue="todos"
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as FilterTab)}
      >
        <TabsList className="w-full">
          {FILTER_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Content for all tabs (we filter outside) */}
        {FILTER_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {/* (content rendered below outside of TabsContent) */}
          </TabsContent>
        ))}
      </Tabs>

      {/* Notification feed */}
      {sortedNotifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Sin notificaciones"
          description="No hay notificaciones para esta categoria. Vuelve mas tarde."
        />
      ) : (
        <div className="space-y-3">
          {sortedNotifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              currentUserId={profile.id}
              onMarkedRead={handleMarkedRead}
            />
          ))}
        </div>
      )}

      {/* Floating create button (encargado / chef only) */}
      {canCreate && (
        <Link href="/notificaciones/nueva">
          <Button
            className="fixed bottom-6 right-6 z-40 size-14 rounded-full shadow-lg"
            size="icon-lg"
          >
            <Plus className="size-6" />
          </Button>
        </Link>
      )}
    </div>
  )
}
