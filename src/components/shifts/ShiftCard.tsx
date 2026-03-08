'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Clock, StickyNote, User } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShiftCardData = {
  id: string
  shift_date: string
  start_time: string
  end_time: string
  shift_role: AppRole
  notes: string | null
  user_id: string
  profile?: {
    first_name: string
    last_name: string
  } | null
}

type ShiftCardProps = {
  shift: ShiftCardData
  showPerson?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShiftDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return format(date, "EEEE d 'de' MMMM", { locale: es })
}

function formatTime(timeStr: string): string {
  // time comes as "HH:mm:ss" or "HH:mm"
  return timeStr.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShiftCard({ shift, showPerson = false }: ShiftCardProps) {
  const roleConfig = ROLES[shift.shift_role]

  return (
    <Card className="overflow-hidden">
      <div className="flex">
        {/* Left color border matching role */}
        <div
          className="w-1.5 shrink-0"
          style={{ backgroundColor: roleConfig.color }}
        />

        <CardContent className="flex-1 py-3 px-4">
          {/* Date */}
          <p className="text-sm font-medium capitalize text-foreground">
            {formatShiftDate(shift.shift_date)}
          </p>

          {/* Time range */}
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5" />
            <span>
              {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
            </span>
          </div>

          {/* Role badge */}
          <div className="mt-2 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: roleConfig.color + '1A',
                color: roleConfig.color,
              }}
            >
              {roleConfig.emoji} {roleConfig.label}
            </span>
          </div>

          {/* Person name (encargado view) */}
          {showPerson && shift.profile && (
            <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="size-3.5" />
              <span>{shift.profile.first_name} {shift.profile.last_name}</span>
            </div>
          )}

          {/* Notes */}
          {shift.notes && (
            <div className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
              <StickyNote className="mt-0.5 size-3.5 shrink-0" />
              <span>{shift.notes}</span>
            </div>
          )}
        </CardContent>
      </div>
    </Card>
  )
}
