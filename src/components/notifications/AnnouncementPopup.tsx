'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { PRIORITIES } from '@/lib/constants'
import type { PriorityValue } from '@/types/database'

type Announcement = {
  id: string
  title: string
  body: string
  priority: PriorityValue
  author_id: string
  created_at: string
  author?: { first_name: string; last_name: string } | null
}

export function AnnouncementPopup() {
  const { profile } = useProfileContext()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (!profile) return

    async function fetchUnread() {
      const supabase = createClient()

      // Get all active general announcements
      const { data: allAnnouncements } = await supabase
        .from('announcements')
        .select('id, title, body, priority, author_id, created_at, profiles!announcements_author_id_fkey(first_name, last_name)')
        .eq('is_active', true)
        .eq('type', 'general')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(10)

      if (!allAnnouncements?.length) return

      // Get read announcements
      const { data: reads } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('user_id', profile!.id)

      const readIds = new Set((reads ?? []).map(r => r.announcement_id))

      // Filter unread
      const unread = allAnnouncements
        .filter(a => !readIds.has(a.id))
        .map(a => ({
          id: a.id,
          title: a.title,
          body: a.body,
          priority: a.priority as PriorityValue,
          author_id: a.author_id,
          created_at: a.created_at,
          author: (a as any).profiles ?? null,
        }))

      if (unread.length > 0) {
        setAnnouncements(unread)
        setCurrentIndex(0)
      }
    }

    // Small delay so it doesn't block initial render
    const timer = setTimeout(fetchUnread, 1500)
    return () => clearTimeout(timer)
  }, [profile])

  const current = announcements[currentIndex]
  if (!current) return null

  const markReadAndNext = async () => {
    const supabase = createClient()
    if (profile) {
      await supabase.from('announcement_reads').upsert(
        { announcement_id: current.id, user_id: profile.id },
        { onConflict: 'announcement_id,user_id' },
      )
    }

    if (currentIndex < announcements.length - 1) {
      setCurrentIndex(i => i + 1)
    } else {
      setAnnouncements([])
    }
  }

  const priorityConfig = PRIORITIES[current.priority]
  const borderColor = priorityConfig?.color ?? '#006d5a'
  const isUrgent = current.priority === 'critica' || current.priority === 'alta'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <div
        className="relative z-10 mx-4 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
        style={{ borderTopWidth: '4px', borderTopColor: borderColor }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: priorityConfig?.bg ?? '#e8f5f1' }}
          >
            <Bell className="size-5" style={{ color: borderColor }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
              {isUrgent ? 'Aviso importante' : 'Aviso general'}
            </p>
            {announcements.length > 1 && (
              <p className="text-[10px] text-[#a39e97]">
                {currentIndex + 1} de {announcements.length}
              </p>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pt-4 pb-2">
          <h3 className="text-base font-semibold leading-snug text-[#3d2c24]">
            {current.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-[#6b6560]">
            {current.body}
          </p>
          {current.author && (
            <p className="mt-3 text-[11px] text-[#a39e97]">
              — {current.author.first_name} {current.author.last_name}
            </p>
          )}
        </div>

        {/* Action */}
        <div className="px-5 pb-5 pt-3">
          <button
            onClick={markReadAndNext}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-colors active:scale-[0.98]"
            style={{ backgroundColor: borderColor }}
          >
            {currentIndex < announcements.length - 1 ? 'Siguiente' : 'Entendido'}
          </button>
        </div>
      </div>
    </div>
  )
}
