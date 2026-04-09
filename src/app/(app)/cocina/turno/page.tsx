'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ChevronDown,
  Check,
  SkipForward,
  AlertTriangle,
  Clock,
  Play,
  Lock,
  ArrowLeft,
  MessageSquare,
  Loader2,
  ChefHat,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  FadeIn,
  StaggerList,
  StaggerItem,
  ScalePress,
  AnimatedNumber,
  PulseRing,
  motion,
  AnimatePresence,
} from '@/components/ui/motion'
import {
  KITCHEN_SHIFT_TYPES,
  KITCHEN_FAMILIES,
  CHECKLIST_TIMINGS,
  CHECKLIST_ITEM_STATUSES,
} from '@/lib/constants'
import type {
  KitchenShiftTypeValue,
  ChecklistItemStatusValue,
  ChecklistTimingValue,
  KitchenFamilyValue,
} from '@/types/database'
import Link from 'next/link'
import { logAuditClient } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentShiftType(): KitchenShiftTypeValue {
  const h = new Date().getHours()
  if (h >= 7 && h < 16) return 'morning'
  // Night shift or outside hours — default to night (or morning if very early)
  if (h < 7) return 'morning' // early morning = prep for morning shift
  return 'night'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShiftRow = {
  id: number
  status: 'pending' | 'in_progress' | 'completed'
  shift_type: KitchenShiftTypeValue
  handover_note: string | null
}

type ItemRow = {
  id: number
  title: string
  type: string
  timing: ChecklistTimingValue
  scheduled_time: string | null
  family: KitchenFamilyValue
  is_critical: boolean
  sort_order: number
  status: ChecklistItemStatusValue
  note: string | null
  completed_by_name: string | null
}

type TimingSection = {
  timing: ChecklistTimingValue
  label: string
  icon: string
  items: ItemRow[]
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TurnoPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const router = useRouter()
  const autoShiftType = useMemo(() => getCurrentShiftType(), [])
  const [shiftType, setShiftType] = useState<KitchenShiftTypeValue>(autoShiftType)
  const [now] = useState(() => new Date())
  const today = format(now, 'yyyy-MM-dd')

  const [clock, setClock] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [shift, setShift] = useState<ShiftRow | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])

  // Clock tick for countdown
  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 30_000) // update every 30s
    return () => clearInterval(interval)
  }, [])
  const [handoverNote, setHandoverNote] = useState('')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [showHandover, setShowHandover] = useState(false)

  const shiftConfig = shiftType ? KITCHEN_SHIFT_TYPES[shiftType] : null

  // ---------------------------------------------------------------------------
  // Fetch or create shift + items
  // ---------------------------------------------------------------------------

  const fetchShift = useCallback(async () => {
    if (!profile || !shiftType) return
    setLoading(true)
    const supabase = createClient()

    try {
      // Get or create shift
      let { data: shiftData, error: fetchErr } = await supabase
        .from('kitchen_shifts')
        .select('id, status, shift_type, handover_note')
        .eq('date', today)
        .eq('shift_type', shiftType)
        .maybeSingle()

      // Handle case where table doesn't exist yet (migration not run)
      if (fetchErr) {
        console.warn('kitchen_shifts table may not exist yet:', fetchErr.message)
        setLoading(false)
        return
      }

      if (!shiftData) {
        // Create shift + populate checklist items from templates
        const { data: newShift, error: shiftErr } = await supabase
          .from('kitchen_shifts')
          .insert({ date: today, shift_type: shiftType, status: 'pending' })
          .select('id, status, shift_type, handover_note')
          .single()

        if (shiftErr) {
          console.warn('Could not create shift:', shiftErr.message)
          setLoading(false)
          return
        }
        shiftData = newShift
        logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'create_kitchen_shift', module: 'cocina', entityType: 'kitchen_shift', description: `User abrió turno de cocina: ${shiftType}` })

        // Get templates for this shift
        const { data: templates } = await supabase
          .from('checklist_templates')
          .select('*')
          .eq('is_active', true)
          .or(`shift.eq.${shiftType},shift.eq.both`)
          .order('sort_order')

        if (templates && templates.length > 0) {
          const checklistItems = templates.map((t) => ({
            kitchen_shift_id: newShift.id,
            template_id: t.id,
            title: t.title,
            type: t.type,
            timing: t.timing,
            scheduled_time: t.scheduled_time,
            family: t.family,
            is_critical: t.is_critical,
            sort_order: t.sort_order,
            status: 'pending' as const,
          }))

          await supabase.from('checklist_items').insert(checklistItems)
        }
      }

      setShift(shiftData)
      setHandoverNote(shiftData.handover_note ?? '')

      // Fetch checklist items with who completed them
      const { data: itemsData } = await supabase
        .from('checklist_items')
        .select('id, title, type, timing, scheduled_time, family, is_critical, sort_order, status, note, completed_by')
        .eq('kitchen_shift_id', shiftData.id)
        .order('sort_order')

      // Fetch profile names for completed items
      const completedByIds = [...new Set((itemsData ?? []).map((i) => i.completed_by).filter((id): id is string => id != null))]
      let namesMap = new Map<string, string>()
      if (completedByIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name')
          .in('id', completedByIds)
        for (const p of profiles ?? []) namesMap.set(p.id, p.first_name)
      }

      setItems((itemsData ?? []).map((i) => ({
        ...i,
        completed_by_name: i.completed_by ? namesMap.get(i.completed_by) ?? null : null,
      })) as ItemRow[])

      // Auto-expand first incomplete section
      if (itemsData) {
        const firstPending = itemsData.find((i) => i.status === 'pending' || i.status === 'overdue')
        if (firstPending) {
          setExpandedSections(new Set([firstPending.timing]))
        } else {
          // All done — show closing
          setExpandedSections(new Set(['closing']))
        }
      }
    } catch (err) {
      console.error('Error loading shift:', err)
      toast.error('Error al cargar el turno')
    } finally {
      setLoading(false)
    }
  }, [profile, shiftType, today])

  useEffect(() => { fetchShift() }, [fetchShift])

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function startShift() {
    if (!shift || !profile) return
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('kitchen_shifts')
      .update({ status: 'in_progress', opened_by: profile.id })
      .eq('id', shift.id)

    if (error) {
      toast.error('Error al abrir turno')
    } else {
      setShift({ ...shift, status: 'in_progress' })
      toast.success('Turno iniciado')
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'start_kitchen_shift', module: 'cocina', entityType: 'kitchen_shift', description: 'User inició turno de cocina' })
    }
    setSaving(false)
  }

  async function closeShift() {
    if (!shift || !profile) return
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('kitchen_shifts')
      .update({
        status: 'completed',
        closed_by: profile.id,
        handover_note: handoverNote.trim() || null,
      })
      .eq('id', shift.id)

    if (error) {
      toast.error('Error al cerrar turno')
    } else {
      toast.success('Turno cerrado')
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'close_kitchen_shift', module: 'cocina', entityType: 'kitchen_shift', description: 'User cerró turno de cocina' })
      router.push('/cocina')
    }
    setSaving(false)
  }

  async function toggleItem(itemId: number, newStatus: ChecklistItemStatusValue, note?: string) {
    const supabase = createClient()
    const updates: Record<string, unknown> = { status: newStatus }
    if (note !== undefined) updates.note = note
    if (newStatus === 'done' || newStatus === 'skipped') {
      updates.completed_by = profile?.id
      updates.completed_at = new Date().toISOString()
    } else {
      updates.completed_by = null
      updates.completed_at = null
    }

    const { error } = await supabase
      .from('checklist_items')
      .update(updates)
      .eq('id', itemId)

    if (!error) {
      const item = items.find((i) => i.id === itemId)
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'update_checklist_item', module: 'cocina', entityType: 'checklist_item', description: `User actualizó checklist: ${item?.title ?? itemId} -> ${newStatus}` })
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? {
          ...i,
          status: newStatus,
          note: note !== undefined ? (note || null) : i.note,
          completed_by_name: (newStatus === 'done' || newStatus === 'skipped') ? profile?.first_name ?? null : null,
        } : i)),
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const sections: TimingSection[] = useMemo(() => {
    const timingOrder: ChecklistTimingValue[] = ['on_arrival', 'scheduled', 'pre_service', 'during_service', 'closing']
    const grouped = new Map<ChecklistTimingValue, ItemRow[]>()

    for (const item of items) {
      const list = grouped.get(item.timing) ?? []
      list.push(item)
      grouped.set(item.timing, list)
    }

    return timingOrder
      .filter((t) => grouped.has(t))
      .map((t) => ({
        timing: t,
        label: CHECKLIST_TIMINGS[t].label,
        icon: CHECKLIST_TIMINGS[t].icon,
        items: grouped.get(t)!,
      }))
  }, [items])

  const totalItems = items.length
  const doneItems = items.filter((i) => i.status === 'done' || i.status === 'skipped').length
  const overdueItems = items.filter((i) => i.status === 'overdue').length
  const progress = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0

  function toggleSection(timing: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(timing)) next.delete(timing)
      else next.add(timing)
      return next
    })
  }

  function sectionProgress(section: TimingSection) {
    const done = section.items.filter((i) => i.status === 'done' || i.status === 'skipped').length
    return { done, total: section.items.length }
  }

  // ---------------------------------------------------------------------------
  // Loading / no shift
  // ---------------------------------------------------------------------------

  if (profileLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[#006d5a]" />
      </div>
    )
  }

  if (!shiftType) {
    return (
      <div className="mx-auto max-w-lg px-1 pb-28 pt-4">
        <p className="text-center text-sm text-[#a39e97]">Fuera de horario de turno</p>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-lg pb-28">
      {/* Header */}
      <FadeIn className="sticky top-0 z-20 -mx-4 bg-[#faf8f5]/95 px-4 pb-3 pt-2 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/cocina" className="rounded-lg p-1.5 text-[#a39e97] active:scale-90">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="flex-1">
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">
              {shiftConfig?.icon} {shiftConfig?.label}
            </h1>
            <p className="section-label mt-0.5 capitalize">
              {format(now, "EEEE d MMM", { locale: es })}
            </p>
          </div>
          {shift?.status === 'in_progress' && <PulseRing color="#d4943a" />}
          {/* Shift toggle — only when no shift started yet */}
          {(!shift || shift.status === 'pending') && (
            <div className="flex rounded-full bg-secondary p-0.5">
              <button
                onClick={() => { setShiftType('morning'); setLoading(true) }}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${shiftType === 'morning' ? 'bg-[#d4943a] text-white' : 'text-muted-foreground'}`}
              >
                ☀️ Mañana
              </button>
              <button
                onClick={() => { setShiftType('night'); setLoading(true) }}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${shiftType === 'night' ? 'bg-[#5a6b52] text-white' : 'text-muted-foreground'}`}
              >
                🌙 Noche
              </button>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {shift?.status === 'in_progress' && totalItems > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-[#a39e97]">
              <span>
                <AnimatedNumber value={doneItems} /> / {totalItems} tareas
              </span>
              <span className="font-semibold tabular-nums text-[#3d2c24]">{progress}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#ebe6df]">
              <motion.div
                className="h-full rounded-full bg-[#006d5a]"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}
      </FadeIn>

      {/* ================================================================ */}
      {/* Not started — start button                                       */}
      {/* ================================================================ */}
      {(!shift || shift.status === 'pending') && (
        <FadeIn delay={0.1} className="mt-6">
          <div className="card-elevated-lg rounded-2xl p-6 text-center">
            <ChefHat className="mx-auto size-12 text-[#006d5a]/30" />
            <p className="mt-4 font-display text-lg font-semibold text-[#3d2c24]">
              Turno listo para empezar
            </p>
            <p className="mt-1 text-sm text-[#a39e97]">
              {totalItems} tareas cargadas del checklist
            </p>
            <Button
              onClick={startShift}
              disabled={saving}
              className="mt-5 gap-2"
              size="lg"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Empezar turno
            </Button>
          </div>
        </FadeIn>
      )}

      {/* ================================================================ */}
      {/* In progress — checklist sections                                 */}
      {/* ================================================================ */}
      {shift?.status === 'in_progress' && (
        <StaggerList className="mt-4 space-y-2.5" staggerDelay={0.04}>
          {sections.map((section) => {
            const { done, total } = sectionProgress(section)
            const isComplete = done === total
            const isOpen = expandedSections.has(section.timing)

            return (
              <StaggerItem key={section.timing}>
                {/* Section header — tappable */}
                <button
                  onClick={() => toggleSection(section.timing)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-all active:scale-[0.99]',
                    isComplete
                      ? 'bg-[#e8f5f1] ring-1 ring-[#006d5a]/10'
                      : 'bg-white ring-1 ring-[#ebe6df]',
                  )}
                >
                  <span className="text-lg">{section.icon}</span>
                  <div className="flex-1">
                    <p className={cn(
                      'text-sm font-semibold',
                      isComplete ? 'text-[#006d5a]' : 'text-[#3d2c24]',
                    )}>
                      {section.label}
                    </p>
                    <p className="text-xs text-[#a39e97]">
                      {done}/{total}
                      {isComplete && ' ✓'}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn(
                      'size-4 text-[#a39e97] transition-transform',
                      isOpen && 'rotate-180',
                    )}
                  />
                </button>

                {/* Section items */}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1 pt-1.5">
                        {section.items.map((item) => (
                          <ChecklistItemCard
                            key={item.id}
                            item={item}
                            onToggle={toggleItem}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </StaggerItem>
            )
          })}

          {/* Handover note section */}
          <StaggerItem>
            <button
              onClick={() => setShowHandover(!showHandover)}
              className="flex w-full items-center gap-3 rounded-xl bg-white px-4 py-3.5 text-left ring-1 ring-[#ebe6df] transition-all active:scale-[0.99]"
            >
              <MessageSquare className="size-4 text-[#b8906e]" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-[#3d2c24]">Nota de handover</p>
                <p className="text-xs text-[#a39e97]">Para el turno siguiente</p>
              </div>
              <ChevronDown className={cn('size-4 text-[#a39e97] transition-transform', showHandover && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {showHandover && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-1 pt-2">
                    <Textarea
                      placeholder="Qué falta, qué está listo, novedades..."
                      value={handoverNote}
                      onChange={(e) => setHandoverNote(e.target.value)}
                      className="min-h-[80px] resize-none rounded-xl border-[#ebe6df] text-sm"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </StaggerItem>
        </StaggerList>
      )}

      {/* ================================================================ */}
      {/* Completed                                                        */}
      {/* ================================================================ */}
      {shift?.status === 'completed' && (
        <FadeIn className="mt-6 text-center">
          <div className="card-elevated-lg rounded-2xl p-6">
            <Check className="mx-auto size-12 text-[#006d5a]" />
            <p className="mt-3 font-display text-xl font-bold text-[#006d5a]">Turno cerrado</p>
            <p className="mt-1 text-sm text-[#a39e97]">{doneItems}/{totalItems} tareas completadas</p>
          </div>
        </FadeIn>
      )}

      {/* ================================================================ */}
      {/* Fixed bottom bar — close shift                                   */}
      {/* ================================================================ */}
      {shift?.status === 'in_progress' && (
        <div className="fixed bottom-16 left-0 right-0 z-30 border-t border-[#ebe6df]/60 bg-[#fefcf9] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <div className="flex-1 text-xs text-[#a39e97]">
              {doneItems === totalItems ? (
                <span className="font-semibold text-[#006d5a]">✓ Todo completo</span>
              ) : (
                <span>{totalItems - doneItems} pendiente{totalItems - doneItems > 1 ? 's' : ''}</span>
              )}
            </div>
            <ConfirmDialog
              title="¿Cerrar este turno?"
              description={doneItems < totalItems ? `Hay ${totalItems - doneItems} tarea${totalItems - doneItems > 1 ? 's' : ''} pendiente${totalItems - doneItems > 1 ? 's' : ''}` : undefined}
              confirmLabel="Cerrar turno"
              variant={doneItems < totalItems ? 'warning' : 'default'}
              onConfirm={closeShift}
              trigger={
                <Button
                  variant={doneItems === totalItems ? 'default' : 'outline'}
                  size="sm"
                  className="gap-2"
                >
                  <Lock className="size-3.5" />
                  Cerrar turno
                </Button>
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChecklistItemCard — Single tappable item
// ---------------------------------------------------------------------------

function ChecklistItemCard({
  item,
  onToggle,
}: {
  item: ItemRow
  onToggle: (id: number, status: ChecklistItemStatusValue, note?: string) => void
}) {
  const [showNote, setShowNote] = useState(false)
  const [noteText, setNoteText] = useState(item.note ?? '')
  const isDone = item.status === 'done'
  const isSkipped = item.status === 'skipped'
  const isOverdue = item.status === 'overdue'
  const familyConfig = KITCHEN_FAMILIES[item.family]

  function handleTap() {
    if (isDone) {
      onToggle(item.id, 'pending')
    } else {
      onToggle(item.id, 'done')
    }
  }

  function handleSkip(e: React.MouseEvent) {
    e.stopPropagation()
    onToggle(item.id, isSkipped ? 'pending' : 'skipped')
  }

  function handleSaveNote(e: React.MouseEvent) {
    e.stopPropagation()
    onToggle(item.id, item.status, noteText.trim())
    setShowNote(false)
  }

  return (
    <div className={cn(
      'rounded-xl px-3.5 py-3 transition-all',
      isDone && 'bg-[#e8f5f1]/50',
      isSkipped && 'bg-[#f3efe9]/50 opacity-60',
      isOverdue && 'bg-[#fef2f2]/50',
      !isDone && !isSkipped && !isOverdue && 'bg-white',
    )}>
      <div
        onClick={handleTap}
        className="flex cursor-pointer items-center gap-3 active:scale-[0.98]"
      >
        {/* Status indicator */}
        <div className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg transition-all',
          isDone && 'bg-[#006d5a] text-white',
          isSkipped && 'bg-[#a39e97] text-white',
          isOverdue && 'bg-[#ea504c] text-white',
          !isDone && !isSkipped && !isOverdue && 'ring-2 ring-[#ebe6df]',
        )}>
          {isDone && <Check className="size-4" />}
          {isSkipped && <SkipForward className="size-3.5" />}
          {isOverdue && <AlertTriangle className="size-3.5" />}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className={cn(
            'text-sm font-medium',
            isDone && 'text-[#006d5a] line-through decoration-[#006d5a]/30',
            isSkipped && 'text-[#a39e97] line-through',
            isOverdue && 'text-[#ea504c]',
            !isDone && !isSkipped && !isOverdue && 'text-[#3d2c24]',
          )}>
            {item.title}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {item.scheduled_time && (
              <span className="flex items-center gap-0.5 text-[10px] font-medium text-[#d4943a]">
                <Clock className="size-2.5" /> {item.scheduled_time}
              </span>
            )}
            <span className="text-[10px]" style={{ color: familyConfig?.color }}>
              {familyConfig?.icon} {familyConfig?.label}
            </span>
            {item.completed_by_name && (isDone || isSkipped) && (
              <span className="text-[10px] text-[#a39e97]">✓ {item.completed_by_name}</span>
            )}
            {item.note && (
              <span className="text-[10px] italic text-[#b8906e]">📝 {item.note}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-0.5">
          {item.is_critical && !isDone && !isSkipped && (
            <span className="text-[10px] font-bold text-[#ea504c]">!</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setShowNote(!showNote) }}
            className="rounded-md p-1.5 text-[#a39e97] active:scale-90"
          >
            <MessageSquare className="size-3.5" />
          </button>
          {!isDone && (
            <button
              onClick={handleSkip}
              className={cn('rounded-md p-1.5 text-[#a39e97] active:scale-90', isSkipped && 'text-[#d4943a]')}
            >
              <SkipForward className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Inline note editor */}
      <AnimatePresence>
        {showNote && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex gap-2 pl-10">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Agregar nota..."
                className="h-7 flex-1 rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-2.5 text-xs text-[#3d2c24] outline-none focus:border-[#006d5a]"
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
              <button
                onClick={handleSaveNote}
                className="flex size-7 items-center justify-center rounded-lg bg-[#006d5a] text-white active:scale-90"
              >
                <Check className="size-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
