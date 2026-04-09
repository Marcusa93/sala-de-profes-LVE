'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  ChefHat,
  Minus,
  Plus,
  MessageSquare,
  Loader2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  FadeIn,
  StaggerList,
  StaggerItem,
  AnimatedNumber,
  PulseRing,
  motion,
  AnimatePresence,
} from '@/components/ui/motion'
import { KITCHEN_SHIFT_TYPES, KITCHEN_FAMILIES, MISE_RECORD_STATUSES } from '@/lib/constants'
import type { KitchenShiftTypeValue, KitchenFamilyValue, MiseRecordStatusValue } from '@/types/database'
import { logAuditClient } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentShiftType(): KitchenShiftTypeValue | null {
  const h = new Date().getHours()
  if (h >= 7 && h < 16) return 'morning'
  if (h >= 16 && h < 23) return 'night'
  return null
}

type MiseItem = {
  id: number
  name: string
  family: KitchenFamilyValue
  unit: string
  target_quantity: number
  alert_threshold: number
}

type MiseRecord = {
  id: number
  mise_en_place_item_id: number
  status: MiseRecordStatusValue
  quantity_produced: number | null
  note: string | null
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MisePage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [now] = useState(() => new Date())
  const today = format(now, 'yyyy-MM-dd')
  const shiftType = useMemo(() => getCurrentShiftType(), [])
  const shiftConfig = shiftType ? KITCHEN_SHIFT_TYPES[shiftType] : null

  const [loading, setLoading] = useState(true)
  const [shiftId, setShiftId] = useState<number | null>(null)
  const [items, setItems] = useState<MiseItem[]>([])
  const [records, setRecords] = useState<Map<number, MiseRecord>>(new Map())
  const [editingNote, setEditingNote] = useState<number | null>(null)
  const [noteText, setNoteText] = useState('')

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    if (!profile || !shiftType) { setLoading(false); return }
    const supabase = createClient()

    try {
      // Get shift
      const { data: shift } = await supabase
        .from('kitchen_shifts')
        .select('id')
        .eq('date', today)
        .eq('shift_type', shiftType)
        .maybeSingle()

      if (!shift) { setLoading(false); return }
      setShiftId(shift.id)

      // Get mise items for this shift
      const { data: miseItems } = await supabase
        .from('mise_en_place_items')
        .select('id, name, family, unit, target_quantity, alert_threshold')
        .eq('is_active', true)
        .or(`shift.eq.${shiftType},shift.eq.both`)
        .order('sort_order')

      setItems(miseItems ?? [])

      // Get existing records
      const { data: miseRecords } = await supabase
        .from('mise_en_place_records')
        .select('id, mise_en_place_item_id, status, quantity_produced, note')
        .eq('kitchen_shift_id', shift.id)

      const recordMap = new Map<number, MiseRecord>()
      for (const r of miseRecords ?? []) {
        recordMap.set(r.mise_en_place_item_id, r)
      }
      setRecords(recordMap)
    } catch (err) {
      console.error('Error loading mise en place:', err)
    } finally {
      setLoading(false)
    }
  }, [profile, shiftType, today])

  useEffect(() => { fetchData() }, [fetchData])

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function updateStatus(itemId: number, status: MiseRecordStatusValue, qty?: number) {
    if (!shiftId) return
    const supabase = createClient()
    const existing = records.get(itemId)

    const itemName = items.find((i) => i.id === itemId)?.name ?? String(itemId)
    if (existing) {
      await supabase.from('mise_en_place_records')
        .update({ status, quantity_produced: qty ?? existing.quantity_produced, produced_by: profile?.id })
        .eq('id', existing.id)
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'update_mise_status', module: 'cocina', entityType: 'mise_en_place', description: `User actualizó mise: ${itemName} -> ${status}` })
      setRecords((prev) => {
        const next = new Map(prev)
        next.set(itemId, { ...existing, status, quantity_produced: qty ?? existing.quantity_produced })
        return next
      })
    } else {
      const { data } = await supabase.from('mise_en_place_records')
        .insert({ kitchen_shift_id: shiftId, mise_en_place_item_id: itemId, status, quantity_produced: qty ?? null, produced_by: profile?.id })
        .select('id, mise_en_place_item_id, status, quantity_produced, note')
        .single()
      if (data) {
        logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'update_mise_status', module: 'cocina', entityType: 'mise_en_place', description: `User actualizó mise: ${itemName} -> ${status}` })
        setRecords((prev) => {
          const next = new Map(prev)
          next.set(itemId, data)
          return next
        })
      }
    }
  }

  async function saveNote(itemId: number) {
    if (!shiftId) return
    const supabase = createClient()
    const existing = records.get(itemId)

    if (existing) {
      await supabase.from('mise_en_place_records')
        .update({ note: noteText.trim() || null })
        .eq('id', existing.id)
      setRecords((prev) => {
        const next = new Map(prev)
        next.set(itemId, { ...existing, note: noteText.trim() || null })
        return next
      })
    }
    setEditingNote(null)
    setNoteText('')
    toast.success('Nota guardada')
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const grouped = useMemo(() => {
    const map = new Map<KitchenFamilyValue, MiseItem[]>()
    for (const item of items) {
      const list = map.get(item.family) ?? []
      list.push(item)
      map.set(item.family, list)
    }
    return Array.from(map.entries()).map(([family, famItems]) => ({
      family,
      config: KITCHEN_FAMILIES[family],
      items: famItems,
      done: famItems.filter((i) => records.get(i.id)?.status === 'done').length,
      total: famItems.length,
    }))
  }, [items, records])

  const totalDone = items.filter((i) => records.get(i.id)?.status === 'done').length
  const totalItems = items.length
  const progress = totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  if (profileLoading || loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-[#006d5a]" /></div>
  }

  if (!shiftType || !shiftId) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-4 text-center">
        <p className="text-sm text-[#a39e97]">Abrí el turno primero desde la pantalla de Cocina</p>
        <Link href="/cocina" className="mt-3 inline-block"><Button variant="outline" size="sm">Ir a Cocina</Button></Link>
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
              🔪 Mise en Place
            </h1>
            <p className="section-label mt-0.5 capitalize">
              {format(now, "EEE d MMM", { locale: es })} · {shiftConfig?.icon} {shiftConfig?.label}
            </p>
          </div>
        </div>
        {/* Progress */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-[#a39e97]">
            <span><AnimatedNumber value={totalDone} />/{totalItems} listos</span>
            <span className="font-bold tabular-nums text-[#3d2c24]">{progress}%</span>
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
      </FadeIn>

      {/* Groups */}
      <StaggerList className="mt-4 space-y-4" staggerDelay={0.04}>
        {grouped.map((group) => (
          <StaggerItem key={group.family}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="text-base">{group.config.icon}</span>
              <span className="section-label" style={{ color: group.config.color }}>
                {group.config.label}
              </span>
              <span className="ml-auto text-xs font-semibold tabular-nums text-[#a39e97]">
                {group.done}/{group.total}
              </span>
            </div>

            <div className="space-y-1.5">
              {group.items.map((item) => {
                const record = records.get(item.id)
                const status = record?.status ?? 'pending'
                const isDone = status === 'done'
                const isLow = status === 'low'
                const isMissing = status === 'missing'
                const statusCfg = MISE_RECORD_STATUSES[status]

                return (
                  <div key={item.id} className={cn(
                    'rounded-xl px-3.5 py-3 transition-all',
                    isDone ? 'bg-[#e8f5f1]/50' : isMissing ? 'bg-[#fef2f2]/50' : isLow ? 'bg-[#fdf6ec]/30' : 'bg-white',
                    'ring-1 ring-[#ebe6df]/50',
                  )}>
                    <div className="flex items-center gap-3">
                      {/* Status quick-tap */}
                      <button
                        onClick={() => updateStatus(item.id, isDone ? 'pending' : 'done')}
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-lg transition-all active:scale-90',
                          isDone ? 'bg-[#006d5a] text-white' : 'ring-2 ring-[#ebe6df]',
                        )}
                      >
                        {isDone && <Check className="size-4" />}
                      </button>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          'text-sm font-medium',
                          isDone ? 'text-[#006d5a] line-through decoration-[#006d5a]/30' : 'text-[#3d2c24]',
                        )}>
                          {item.name}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#a39e97]">
                          <span>Meta: {item.target_quantity} {item.unit}</span>
                          {record?.quantity_produced != null && (
                            <span className="font-semibold text-[#3d2c24]">
                              → {record.quantity_produced} {item.unit}
                            </span>
                          )}
                          {record?.note && (
                            <span className="flex items-center gap-0.5 text-[#b8906e]">
                              <MessageSquare className="size-2.5" /> nota
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status badges + actions */}
                      <div className="flex shrink-0 items-center gap-1">
                        {!isDone && (
                          <>
                            <button
                              onClick={() => updateStatus(item.id, 'low')}
                              className={cn(
                                'rounded-md px-2 py-1 text-[10px] font-bold transition-all active:scale-90',
                                isLow ? 'bg-[#d4943a] text-white' : 'text-[#d4943a]',
                              )}
                            >
                              Bajo
                            </button>
                            <button
                              onClick={() => updateStatus(item.id, 'missing')}
                              className={cn(
                                'rounded-md px-2 py-1 text-[10px] font-bold transition-all active:scale-90',
                                isMissing ? 'bg-[#ea504c] text-white' : 'text-[#ea504c]',
                              )}
                            >
                              Falta
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { setEditingNote(item.id); setNoteText(record?.note ?? '') }}
                          className="rounded-md p-1.5 text-[#a39e97] active:scale-90"
                        >
                          <MessageSquare className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Note editor */}
                    <AnimatePresence>
                      {editingNote === item.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 flex gap-2">
                            <Input
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              placeholder="Agregar nota..."
                              className="h-8 flex-1 text-xs"
                              autoFocus
                            />
                            <Button size="xs" onClick={() => saveNote(item.id)}>
                              <Check className="size-3" />
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setEditingNote(null)}>
                              <X className="size-3" />
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </StaggerItem>
        ))}
      </StaggerList>
    </div>
  )
}
