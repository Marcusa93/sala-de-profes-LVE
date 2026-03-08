'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Check, Clock, User } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PriorityBadge } from '@/components/ui/PriorityBadge'
import { ANNOUNCEMENT_TYPES, type AnnouncementType } from '@/lib/constants'
import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationCardData = {
  id: string
  title: string
  body: string
  type: string
  priority: string
  author_id: string
  scope: 'all' | 'role' | 'user'
  target_role: string | null
  expires_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  author?: {
    first_name: string
    last_name: string
  } | null
  is_read?: boolean
}

type NotificationCardProps = {
  notification: NotificationCardData
  currentUserId: string
  onMarkedRead?: (id: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationCard({
  notification,
  currentUserId,
  onMarkedRead,
}: NotificationCardProps) {
  const [markingRead, setMarkingRead] = useState(false)
  const [isRead, setIsRead] = useState(notification.is_read ?? false)

  const typeConfig =
    ANNOUNCEMENT_TYPES[notification.type as AnnouncementType] ?? null

  const timeAgo = formatDistanceToNow(new Date(notification.created_at), {
    addSuffix: true,
    locale: es,
  })

  const isExpired =
    notification.expires_at && new Date(notification.expires_at) < new Date()

  const expiresLabel = notification.expires_at
    ? isExpired
      ? 'Expirado'
      : `Expira ${formatDistanceToNow(new Date(notification.expires_at), {
          addSuffix: true,
          locale: es,
        })}`
    : null

  // ------------------------------------------
  // Mark as read
  // ------------------------------------------
  const handleMarkRead = async () => {
    setMarkingRead(true)
    try {
      const supabase = createClient()

      const { error } = await supabase.from('announcement_reads').insert({
        announcement_id: notification.id,
        user_id: currentUserId,
      })

      if (error) throw error

      setIsRead(true)
      onMarkedRead?.(notification.id)
      toast.success('Notificacion marcada como leida')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al marcar como leida'
      toast.error('Error', { description: message })
    } finally {
      setMarkingRead(false)
    }
  }

  return (
    <Card
      className={`overflow-hidden transition-opacity ${isRead ? 'opacity-50' : ''}`}
    >
      <CardContent className="py-4 px-4">
        {/* Badges row */}
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={notification.priority} />
          {typeConfig && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {typeConfig.icon} {typeConfig.label}
            </span>
          )}
          {isExpired && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Expirado
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="mt-2 text-sm font-semibold text-foreground">
          {notification.title}
        </h3>

        {/* Body truncated */}
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {notification.body}
        </p>

        {/* Footer: author + time + expiration + mark as read */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {/* Author */}
            {notification.author && (
              <span className="flex items-center gap-1">
                <User className="size-3" />
                {notification.author.first_name} {notification.author.last_name}
              </span>
            )}
            {/* Time ago */}
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {timeAgo}
            </span>
            {/* Expiration */}
            {expiresLabel && !isExpired && (
              <span className="text-xs text-amber-600">{expiresLabel}</span>
            )}
          </div>

          {/* Mark as read button */}
          {!isRead && (
            <Button
              variant="ghost"
              size="xs"
              disabled={markingRead}
              onClick={handleMarkRead}
            >
              <Check className="size-3" />
              Marcar leido
            </Button>
          )}
          {isRead && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Check className="size-3" />
              Leido
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
