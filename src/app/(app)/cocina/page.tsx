'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  UtensilsCrossed,
  ClipboardCheck,
  ChefHat,
  Package,
  AlertTriangle,
  ArrowRight,
  Play,
  CheckCircle,
  Clock,
  MessageSquare,
  Coffee,
  CalendarClock,
  ChevronDown,
  Flame,
  Check,
  Circle,
  AlertCircle,
  ShoppingCart,
} from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { DashboardSkeleton } from '@/components/ui/skeleton'
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
} from '@/lib/constants'
import { cn } from '@/lib/utils'
import type {
  KitchenShiftTypeValue,
  KitchenShiftStatusValue,
  ChecklistTimingValue,
  KitchenFamilyValue,
} from '@/types/database'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentShiftType(): KitchenShiftTypeValue | null {
  const h = new Date().getHours()
  if (h >= 7 && h < 16) return 'morning'
  if (h >= 16 && h < 23) return 'night'
  return null
}

type ChecklistRow = {
  id: number
  title: string
  status: string
  timing: ChecklistTimingValue
  scheduled_time: string | null
  family: KitchenFamilyValue
  is_critical: boolean
  sort_order: number
}

// Derive shift phase from checklist progress
function derivePhase(
  shiftStatus: KitchenShiftStatusValue | undefined,
  items: ChecklistRow[],
): { label: string; color: string; bg: string; icon: string } {
  if (!shiftStatus || shiftStatus === 'pending') {
    return { label: 'Pendiente', color: '#a39e97', bg: '#f3efe9', icon: '⏸' }
  }
  if (shiftStatus === 'completed') {
    return { label: 'Cerrado', color: '#006d5a', bg: '#e8f5f1', icon: '✓' }
  }

  const opening = items.filter((i) => i.timing === 'on_arrival')
  const openingDone = opening.filter((i) => i.status === 'done' || i.status === 'skipped').length
  const allDone = items.every((i) => i.status === 'done' || i.status === 'skipped')
  const hasOverdue = items.some((i) => i.status === 'overdue')
  const criticalPending = items.filter((i) => i.is_critical && i.status === 'pending')

  if (hasOverdue || criticalPending.length > 0) {
    return { label: 'Con alertas', color: '#ea504c', bg: '#fef2f2', icon: '⚠️' }
  }
  if (allDone) {
    return { label: 'Listo para servicio', color: '#006d5a', bg: '#e8f5f1', icon: '✅' }
  }
  if (openingDone < opening.length) {
    return { label: 'En apertura', color: '#d4943a', bg: '#fdf6ec', icon: '🔓' }
  }
  return { label: 'En preparación', color: '#8b5e34', bg: '#faf0e4', icon: '🔥' }
}

// Check if a scheduled item is overdue based on current time
function isTimePast(scheduledTime: string | null): boolean {
  if (!scheduledTime) return false
  const [h, m] = scheduledTime.split(':').map(Number)
  const now = new Date()
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)
}

// Group items by timing section
type TimingGroup = {
  timing: ChecklistTimingValue
  label: string
  icon: string
  items: ChecklistRow[]
  done: number
  total: number
  hasCriticalPending: boolean
}

function groupByTiming(items: ChecklistRow[]): TimingGroup[] {
  const order: ChecklistTimingValue[] = ['on_arrival', 'scheduled', 'pre_service', 'during_service', 'closing']
  const map = new Map<ChecklistTimingValue, ChecklistRow[]>()
  for (const item of items) {
    const list = map.get(item.timing) ?? []
    list.push(item)
    map.set(item.timing, list)
  }
  return order.filter((t) => map.has(t)).map((t) => {
    const groupItems = map.get(t)!
    return {
      timing: t,
      label: CHECKLIST_TIMINGS[t].label,
      icon: CHECKLIST_TIMINGS[t].icon,
      items: groupItems,
      done: groupItems.filter((i) => i.status === 'done' || i.status === 'skipped').length,
      total: groupItems.length,
      hasCriticalPending: groupItems.some((i) => i.is_critical && i.status === 'pending'),
    }
  })
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CocinaHubPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = useMemo(() => createClient(), [])

  const [now] = useState(() => new Date())
  const today = format(now, 'yyyy-MM-dd')
  const currentShiftType = useMemo(() => getCurrentShiftType(), [])

  const [loading, setLoading] = useState(true)
  const [shift, setShift] = useState<{
    id: number
    status: KitchenShiftStatusValue
    shift_type: KitchenShiftTypeValue
    handover_note: string | null
  } | null>(null)
  const [items, setItems] = useState<ChecklistRow[]>([])
  const [criticalStock, setCriticalStock] = useState(0)
  const [previousHandover, setPreviousHandover] = useState<string | null>(null)
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null)
  const [barUrgent, setBarUrgent] = useState(0)
  const [barPending, setBarPending] = useState(0)

  const isEncargado = isManagerOrAbove(profile?.role)
  const canCreateOrders = ['chef', 'cocina', 'encargado'].includes(profile?.role ?? '')
  const shiftConfig = currentShiftType ? KITCHEN_SHIFT_TYPES[currentShiftType] : null

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    if (!profile || !currentShiftType) { setLoading(false); return }
    setLoading(true)

    try {
      // 1. Current shift
      const { data: shiftData, error: shiftErr } = await supabase
        .from('kitchen_shifts')
        .select('id, status, shift_type, handover_note')
        .eq('date', today)
        .eq('shift_type', currentShiftType)
        .maybeSingle()

      if (!shiftErr && shiftData) {
        setShift(shiftData)

        // 2. Checklist items
        const { data: checklistData } = await supabase
          .from('checklist_items')
          .select('id, title, status, timing, scheduled_time, family, is_critical, sort_order')
          .eq('kitchen_shift_id', shiftData.id)
          .order('sort_order')

        setItems((checklistData as ChecklistRow[]) ?? [])
      }

      // 3. Critical stock (solo encargado ve el card de stock)
      if (isEncargado) {
        const { data: stockData } = await supabase
          .from('stock_items')
          .select('id, current_qty, min_qty')
          .eq('is_active', true)
        if (stockData) setCriticalStock(stockData.filter((s) => s.current_qty <= s.min_qty).length)
      }

      // 4. Previous handover
      const prevType = currentShiftType === 'morning' ? 'night' : 'morning'
      const prevDate = currentShiftType === 'morning'
        ? format(new Date(Date.now() - 86400000), 'yyyy-MM-dd') : today
      const { data: prevShift } = await supabase
        .from('kitchen_shifts')
        .select('handover_note')
        .eq('date', prevDate).eq('shift_type', prevType)
        .maybeSingle()
      if (prevShift) setPreviousHandover(prevShift.handover_note ?? null)

      // 5. Bar data (solo encargado ve el card de barra)
      if (isEncargado) {
        try {
          const { data: barItems } = await supabase
            .from('bar_stock_items').select('current_qty, min_level, is_urgent').eq('is_active', true)
          if (barItems) {
            setBarUrgent(barItems.filter((b) => b.is_urgent || b.current_qty <= 0).length)
          }
          const { data: barOrders } = await supabase
            .from('bar_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending')
          if (barOrders !== null) setBarPending(barOrders as unknown as number)
        } catch { /* bar tables may not exist */ }
      }
    } catch (err) {
      console.error('Error loading kitchen hub:', err)
    } finally {
      setLoading(false)
    }
  }, [profile, currentShiftType, today, isEncargado, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  // ---------------------------------------------------------------------------
  // Quick toggle from hub
  // ---------------------------------------------------------------------------

  async function quickToggle(itemId: number) {
    // Optimistic update
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: 'done' } : i))

    const { error } = await supabase.from('checklist_items').update({
      status: 'done',
      completed_by: profile?.id,
      completed_at: new Date().toISOString(),
    }).eq('id', itemId)

    if (error) {
      // Revert on failure
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: 'pending' } : i))
      console.error('Error al completar tarea:', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const phase = derivePhase(shift?.status, items)
  const totalItems = items.length
  const doneItems = items.filter((i) => i.status === 'done' || i.status === 'skipped').length
  const progress = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0
  const timingGroups = useMemo(() => groupByTiming(items), [items])

  // "Atención ahora" — critical pending + overdue + time-past scheduled
  const attentionItems = useMemo(() => {
    return items
      .filter((i) => {
        if (i.status === 'done' || i.status === 'skipped') return false
        if (i.status === 'overdue') return true
        if (i.is_critical && i.status === 'pending') return true
        if (i.timing === 'scheduled' && isTimePast(i.scheduled_time)) return true
        return false
      })
      .sort((a, b) => {
        if (a.is_critical && !b.is_critical) return -1
        if (!a.is_critical && b.is_critical) return 1
        return a.sort_order - b.sort_order
      })
      .slice(0, 5)
  }, [items])

  // ---------------------------------------------------------------------------
  // Loading / no shift time
  // ---------------------------------------------------------------------------

  if (profileLoading || loading) return <DashboardSkeleton />

  // Solo socio, encargado, chef y cocina pueden acceder
  if (profile && !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-2">
        <FadeIn>
          <div className="card-elevated-lg rounded-2xl p-8 text-center">
            <UtensilsCrossed className="mx-auto size-10 text-[#a39e97]" />
            <p className="mt-4 text-sm font-medium text-[#3d2c24]">Acceso restringido</p>
            <p className="mt-1 text-xs text-[#a39e97]">Esta sección es solo para cocina, chef y encargados.</p>
          </div>
        </FadeIn>
      </div>
    )
  }

  if (!currentShiftType) {
    return (
      <div className="mx-auto max-w-lg space-y-6 pb-28">
        <FadeIn className="pt-2">
          <h1 className="font-display text-2xl tracking-tight text-[#3d2c24]">Cocina</h1>
          <p className="section-label mt-1">Fuera de horario de turno</p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="card-elevated-lg rounded-2xl p-6 text-center">
            <CalendarClock className="mx-auto size-10 text-[#a39e97]" />
            <p className="mt-4 text-sm font-medium text-[#3d2c24]">No hay turno activo</p>
            <p className="mt-1 text-xs text-[#a39e97]">Mañana: 07–16h · Noche: 16–23h</p>
          </div>
        </FadeIn>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      {/* ================================================================ */}
      {/* HEADER                                                           */}
      {/* ================================================================ */}
      <FadeIn className="flex items-center justify-between pt-2">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-[#3d2c24]">Cocina</h1>
          <p className="section-label mt-0.5 capitalize">
            {format(now, "EEE d MMM", { locale: es })} · {shiftConfig?.icon} {shiftConfig?.label}
          </p>
        </div>
        <div
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold"
          style={{ color: phase.color, backgroundColor: phase.bg }}
        >
          <span>{phase.icon}</span>
          {phase.label}
        </div>
      </FadeIn>

      {/* ================================================================ */}
      {/* HERO — Estado del turno + progreso                               */}
      {/* ================================================================ */}
      <FadeIn delay={0.05}>
        <Link href="/cocina/turno">
          <div className="card-elevated-lg overflow-hidden rounded-2xl press-scale">
            <div className="flex items-stretch">
              <div className="w-1.5 shrink-0" style={{ backgroundColor: phase.color }} />
              <div className="flex-1 p-5">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg" style={{ backgroundColor: shiftConfig?.bg }}>
                    <UtensilsCrossed className="size-4" style={{ color: shiftConfig?.color }} />
                  </div>
                  <span className="section-label">Estado del turno</span>
                  {shift?.status === 'in_progress' && <PulseRing color={phase.color} />}
                </div>

                {/* Status text */}
                <div className="mt-3">
                  {!shift || shift.status === 'pending' ? (
                    <p className="font-display text-xl font-semibold text-[#a39e97]">Turno pendiente</p>
                  ) : shift.status === 'completed' ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle className="size-5 text-[#006d5a]" />
                      <p className="font-display text-xl font-bold text-[#006d5a]">Turno cerrado</p>
                    </div>
                  ) : (
                    <p className="font-display text-xl font-bold" style={{ color: phase.color }}>
                      {phase.label}
                    </p>
                  )}
                </div>

                {/* Progress bar (only when in_progress) */}
                {shift?.status === 'in_progress' && totalItems > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-[#a39e97]">
                      <span><AnimatedNumber value={doneItems} />/{totalItems} tareas</span>
                      <span className="font-bold tabular-nums" style={{ color: phase.color }}>{progress}%</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#ebe6df]">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: phase.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                      />
                    </div>
                    {/* Mini timeline */}
                    <div className="mt-3 flex items-center gap-1 text-[10px]">
                      {timingGroups.map((g, i) => {
                        const complete = g.done === g.total
                        return (
                          <div key={g.timing} className="flex items-center gap-1">
                            {i > 0 && <div className="h-px w-3 bg-[#ebe6df]" />}
                            <span className={cn(
                              'flex items-center gap-0.5 rounded-full px-1.5 py-0.5',
                              complete ? 'bg-[#e8f5f1] text-[#006d5a]' : g.hasCriticalPending ? 'bg-[#fef2f2] text-[#ea504c]' : 'text-[#a39e97]',
                            )}>
                              {complete ? <Check className="size-2.5" /> : <Circle className="size-2.5" />}
                              {g.label}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* CTA */}
                <div className="mt-4">
                  {!shift || shift.status === 'pending' ? (
                    <Button size="sm" className="gap-2"><Play className="size-3.5" />Empezar apertura</Button>
                  ) : shift.status === 'in_progress' ? (
                    <Button size="sm" variant="outline" className="gap-2"><ClipboardCheck className="size-3.5" />Ver checklist completo</Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="gap-2 text-[#006d5a]">Ver resumen <ArrowRight className="size-3.5" /></Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Link>
      </FadeIn>

      {/* ================================================================ */}
      {/* HANDOVER NOTE                                                    */}
      {/* ================================================================ */}
      {previousHandover && (
        <FadeIn delay={0.08}>
          <div className="card-elevated rounded-xl p-4">
            <div className="mb-2 flex items-center gap-2">
              <MessageSquare className="size-3.5 text-[#b8906e]" />
              <span className="section-label">Nota del turno {currentShiftType === 'morning' ? 'noche' : 'mañana'}</span>
            </div>
            <p className="text-sm leading-relaxed text-[#3d2c24]">{previousHandover}</p>
          </div>
        </FadeIn>
      )}

      {/* ================================================================ */}
      {/* ATENCIÓN AHORA — critical + overdue items                        */}
      {/* ================================================================ */}
      {shift?.status === 'in_progress' && (
        <FadeIn delay={0.1}>
          {attentionItems.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Flame className="size-4 text-[#ea504c]" />
                <span className="section-label text-[#ea504c]">Atención ahora</span>
              </div>
              <div className="space-y-1.5">
                {attentionItems.map((item) => {
                  const familyCfg = KITCHEN_FAMILIES[item.family]
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-xl bg-[#fef2f2]/60 px-3.5 py-3 ring-1 ring-[#ea504c]/10"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#3d2c24]">{item.title}</p>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                          {item.scheduled_time && (
                            <span className="flex items-center gap-0.5 font-semibold text-[#ea504c]">
                              <Clock className="size-2.5" />{item.scheduled_time}
                            </span>
                          )}
                          <span style={{ color: familyCfg?.color }}>{familyCfg?.icon} {familyCfg?.label}</span>
                          {item.is_critical && <span className="font-bold text-[#ea504c]">CRÍTICO</span>}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.preventDefault(); quickToggle(item.id) }}
                        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#006d5a] text-white active:scale-90 transition-transform"
                      >
                        <Check className="size-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-[#e8f5f1] p-4">
              <CheckCircle className="size-5 text-[#006d5a]" />
              <div>
                <p className="text-sm font-semibold text-[#006d5a]">Todo al día</p>
                <p className="text-xs text-[#006d5a]/70">Sin tareas críticas pendientes</p>
              </div>
            </div>
          )}
        </FadeIn>
      )}

      {/* ================================================================ */}
      {/* SUMMARY GRID — Checklist + Stock                                 */}
      {/* ================================================================ */}
      <StaggerList className={cn('grid gap-2.5', isEncargado ? 'grid-cols-2' : canCreateOrders ? 'grid-cols-2' : 'grid-cols-1')} staggerDelay={0.04}>
        <StaggerItem>
          <ScalePress>
            <Link href="/cocina/turno">
              <div className="card-interactive rounded-xl p-3">
                <div className="flex items-center gap-1.5">
                  <ClipboardCheck className="size-3 text-[#006d5a]" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Checklist</span>
                </div>
                <div className="mt-2">
                  {totalItems > 0 ? (
                    <>
                      <p className="font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
                        <AnimatedNumber value={doneItems} />
                        <span className="text-base font-normal text-[#a39e97]">/{totalItems}</span>
                      </p>
                      <p className="text-xs text-[#a39e97]">completadas</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-[#a39e97]">—</p>
                      <p className="text-xs text-[#a39e97]">Abrí el turno</p>
                    </>
                  )}
                </div>
              </div>
            </Link>
          </ScalePress>
        </StaggerItem>
        {isEncargado && (
          <StaggerItem>
            <ScalePress>
              <Link href="/stock">
                <div className="card-interactive rounded-xl p-4">
                  <div className="flex items-center gap-2">
                    <Package className="size-3.5 text-[#ea504c]" />
                    <span className="section-label">Stock</span>
                  </div>
                  <div className="mt-2">
                    <p className={cn(
                      'font-display text-2xl font-bold tabular-nums',
                      criticalStock > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]',
                    )}>
                      <AnimatedNumber value={criticalStock} />
                    </p>
                    <p className="text-xs text-[#a39e97]">{criticalStock === 0 ? 'Todo en orden' : 'en riesgo'}</p>
                  </div>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        )}
        {isEncargado && (
          <StaggerItem>
            <ScalePress>
              <Link href="/cocina/barra">
                <div className="card-interactive rounded-xl p-3">
                  <div className="flex items-center gap-1.5">
                    <Coffee className="size-3 text-[#8b5e34]" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Barra</span>
                  </div>
                  <div className="mt-2">
                    {barUrgent > 0 ? (
                      <>
                        <p className="font-display text-2xl font-bold tabular-nums text-[#ea504c]">
                          <AnimatedNumber value={barUrgent} />
                        </p>
                        <p className="text-xs text-[#ea504c]">urgente{barUrgent > 1 ? 's' : ''}</p>
                      </>
                    ) : (
                      <>
                        <p className="font-display text-2xl font-bold tabular-nums text-[#006d5a]">✓</p>
                        <p className="text-xs text-[#a39e97]">En orden</p>
                      </>
                    )}
                  </div>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        )}
        {canCreateOrders && (
          <StaggerItem>
            <ScalePress>
              <Link href="/cocina/pedidos">
                <div className="card-interactive rounded-xl p-3">
                  <div className="flex items-center gap-1.5">
                    <Package className="size-3 text-[#d4943a]" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Pedidos</span>
                  </div>
                  <div className="mt-2">
                    <p className="font-display text-2xl font-bold tabular-nums text-[#006d5a]">
                      <ShoppingCart className="size-6 inline text-[#d4943a]" />
                    </p>
                    <p className="text-xs text-[#a39e97]">Mercadería</p>
                  </div>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        )}
      </StaggerList>

      {/* ================================================================ */}
      {/* BLOQUES OPERATIVOS — Collapsible timing sections                 */}
      {/* ================================================================ */}
      {shift?.status === 'in_progress' && timingGroups.length > 0 && (
        <FadeIn delay={0.2}>
          <h2 className="section-label mb-2 px-1">Bloques operativos</h2>
          <div className="space-y-1.5">
            {timingGroups.map((group) => {
              const isComplete = group.done === group.total
              const isOpen = expandedBlock === group.timing
              const pct = group.total > 0 ? Math.round((group.done / group.total) * 100) : 0

              return (
                <div key={group.timing}>
                  <button
                    onClick={() => setExpandedBlock(isOpen ? null : group.timing)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-all active:scale-[0.99]',
                      isComplete ? 'bg-[#e8f5f1]/70' : group.hasCriticalPending ? 'bg-[#fef2f2]/50' : 'bg-white',
                      'ring-1 ring-[#ebe6df]/60',
                    )}
                  >
                    <span className="text-base">{group.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className={cn('text-sm font-semibold', isComplete ? 'text-[#006d5a]' : 'text-[#3d2c24]')}>
                          {group.label}
                        </p>
                        <span className={cn(
                          'ml-2 text-xs font-bold tabular-nums',
                          isComplete ? 'text-[#006d5a]' : group.hasCriticalPending ? 'text-[#ea504c]' : 'text-[#a39e97]',
                        )}>
                          {pct}%
                        </span>
                      </div>
                      {/* Mini progress bar */}
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#ebe6df]">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: isComplete ? '#006d5a' : group.hasCriticalPending ? '#ea504c' : '#d4943a',
                          }}
                        />
                      </div>
                    </div>
                    <ChevronDown className={cn('size-4 shrink-0 text-[#a39e97] transition-transform', isOpen && 'rotate-180')} />
                  </button>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-0.5 pt-1 pb-1">
                          {group.items.map((item) => {
                            const isDone = item.status === 'done' || item.status === 'skipped'
                            const isPastDue = item.timing === 'scheduled' && isTimePast(item.scheduled_time) && !isDone
                            return (
                              <div
                                key={item.id}
                                onClick={() => !isDone && quickToggle(item.id)}
                                className={cn(
                                  'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 transition-all active:scale-[0.98]',
                                  isDone && 'opacity-50',
                                  isPastDue && 'bg-[#fef2f2]/40',
                                )}
                              >
                                <div className={cn(
                                  'flex size-6 shrink-0 items-center justify-center rounded-md text-white transition-all',
                                  isDone ? 'bg-[#006d5a]' : isPastDue ? 'bg-[#ea504c]' : 'ring-2 ring-[#ebe6df]',
                                )}>
                                  {isDone && <Check className="size-3.5" />}
                                  {isPastDue && !isDone && <AlertCircle className="size-3.5" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className={cn('text-[13px]', isDone ? 'text-[#a39e97] line-through' : 'text-[#3d2c24] font-medium')}>
                                    {item.title}
                                  </p>
                                  {item.scheduled_time && !isDone && (
                                    <span className={cn('text-[10px]', isPastDue ? 'font-bold text-[#ea504c]' : 'text-[#d4943a]')}>
                                      ⏰ {item.scheduled_time}{isPastDue ? ' — vencido' : ''}
                                    </span>
                                  )}
                                </div>
                                {item.is_critical && !isDone && (
                                  <span className="shrink-0 rounded bg-[#ea504c] px-1.5 py-0.5 text-[9px] font-bold text-white">!</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </FadeIn>
      )}

      {/* ================================================================ */}
      {/* CTA — Abrir turno                                                */}
      {/* ================================================================ */}
      {(!shift || shift.status === 'pending') && (
        <FadeIn delay={0.15}>
          <Link href="/cocina/turno">
            <ScalePress>
              <div className="card-interactive flex items-center overflow-hidden rounded-xl">
                <div className="w-1 self-stretch bg-[#006d5a]" />
                <div className="flex flex-1 items-center justify-between px-4 py-3.5">
                  <span className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-[#e8f5f1]">
                      <Play className="size-4 text-[#006d5a]" />
                    </div>
                    <span className="text-sm font-semibold text-[#006d5a]">Iniciar turno de cocina</span>
                  </span>
                  <ArrowRight className="size-4 text-[#006d5a]" />
                </div>
              </div>
            </ScalePress>
          </Link>
        </FadeIn>
      )}
    </div>
  )
}
