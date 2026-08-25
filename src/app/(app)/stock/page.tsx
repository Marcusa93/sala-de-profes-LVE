'use client'

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { isManagerOrAbove } from '@/lib/roles'
import {
  Package,
  Loader2,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Clock,
  AlertTriangle,
  ShieldCheck,
  Activity,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  TrendingDown,
  CalendarClock,
  Unlink,
  Trash2,
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { useStockItems, type StockItem } from '@/lib/hooks/use-stock'
import { STOCK_CATEGORIES, STOCK_CATEGORY_OPTIONS } from '@/lib/constants'
import type { StockCategoryValue } from '@/types/database'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { FadeIn, StaggerList, StaggerItem, motion } from '@/components/ui/motion'
import {
  type StockIntelligenceResponse,
} from '@/lib/stock/intelligence'
import type {
  StockAnomaliesResponse,
} from '@/lib/contracts/stock-anomalies'
import {
  AREA_FILTERS,
  AREA_CATEGORIES,
  COLORS,
  PRIORITY_STYLES,
  getSemaphore,
  getCriticalityRank,
  isPerishableForUi,
  getStockSource,
  formatPriority,
  lotTone,
  priorityFromAnomaly,
  formatLotCountdown,
  formatQty,
  getQuantityReview,
  type SemaphoreColor,
  type StockSourceFilter,
  type StockView,
  type AreaFilter,
  type StockReviewCard,
} from '@/lib/stock/helpers'
import { StockItemRow } from './_components/StockItemRow'
import { BackToHoy } from '@/components/layout/BackToHoy'
import { ReviewCard } from './_components/ReviewCard'
import { MetadataEditor } from './_components/MetadataEditor'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockLot = {
  id: number
  stock_item_id: string
  stock_item_name: string
  category: string | null
  production_order_id: number | null
  production_order_name: string | null
  production_output_id: number | null
  lot_code: string
  qty_original: number
  qty_remaining: number
  unit: string
  produced_at: string
  expires_at: string
  status: 'active' | 'expired' | 'depleted' | 'discarded'
  notes: string | null
  expires_in_days: number
}

type StockLotsResponse = {
  lots: StockLot[]
  summary: {
    total: number
    expired: number
    expiring_today: number
    expiring_window: number
    window_days: number
  }
  requires_migration?: boolean
}

type FudoConnectionState = 'checking' | 'ok' | 'warning' | 'error'

type ReconciliationRow = {
  stock_item_id: string
  name: string
  unit: string
  expected_closing: number
  actual_closing: number
  variance: number
}

type FudoIncidentSample = {
  id: string
  severity: string
  code: string
  title: string
  entity_type: string | null
  entity_id: string | null
  stock_item_id: string | null
  fudo_type: string | null
  fudo_id: string | null
  last_seen_at: string
}

type FudoStatusResponse = {
  state: 'ok' | 'warning' | 'error'
  last_sync_at: string | null
  incidents: { open: number; critical: number; high: number; sample: FudoIncidentSample[] }
  events: { pending: number; failed_last_24h: number }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StockPage() {
  // useSearchParams exige un límite de Suspense para el prerender de la página
  return (
    <Suspense fallback={<LoadingState message="Cargando stock..." />}>
      <StockPageContent />
    </Suspense>
  )
}

function StockPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { profile, loading: profileLoading } = useProfileContext()
  const { items, isLoading: loading, mutate } = useStockItems(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<StockView>('radar')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('all')
  const [semaphoreFilter, setSemaphoreFilter] = useState<SemaphoreColor | null>(null)
  const [sourceFilter, setSourceFilter] = useState<StockSourceFilter>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'ingredient' | 'product'>('all')
  const [negativesOnly, setNegativesOnly] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [intelligence, setIntelligence] = useState<StockIntelligenceResponse | null>(null)
  const [loadingIntelligence, setLoadingIntelligence] = useState(false)
  const [anomalies, setAnomalies] = useState<StockAnomaliesResponse | null>(null)
  const [loadingAnomalies, setLoadingAnomalies] = useState(false)
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null)
  const [editingMetaSource, setEditingMetaSource] = useState<'setup' | 'item' | null>(null)
  const [metaInitial, setMetaInitial] = useState<{ shelfLife?: number | null; category?: StockCategoryValue | null }>({})
  const [lotsData, setLotsData] = useState<StockLotsResponse | null>(null)
  const [loadingLots, setLoadingLots] = useState(false)
  const [wastingId, setWastingId] = useState<string | null>(null)
  const [reconciliationRows, setReconciliationRows] = useState<ReconciliationRow[]>([])
  const [loadingReconciliation, setLoadingReconciliation] = useState(false)
  const [resolvingIncidents, setResolvingIncidents] = useState(false)
  const [fixingLinkId, setFixingLinkId] = useState<string | null>(null)

  const isEncargado = isManagerOrAbove(profile?.role)
  const [lastFudoSync, setLastFudoSync] = useState<string | null>(null)
  const [fudoSyncCount, setFudoSyncCount] = useState(0)
  const [fudoConnection, setFudoConnection] = useState<{
    state: FudoConnectionState
    message: string | null
    issueCount: number
    pendingEvents: number
    failedEvents: number
    criticalIncidents: number
    highIncidents: number
    incidentSample: FudoIncidentSample[]
  }>({
    state: 'checking',
    message: null,
    issueCount: 0,
    pendingEvents: 0,
    failedEvents: 0,
    criticalIncidents: 0,
    highIncidents: 0,
    incidentSample: [],
  })

  const loadFudoStatus = useCallback(async () => {
    const res = await fetch('/api/fudo/status')
    const status = await res.json() as FudoStatusResponse | { error?: string }
    if (!res.ok) throw new Error('error' in status ? status.error : 'No se pudo leer estado Fudo')

    const data = status as FudoStatusResponse
    if (data.last_sync_at) setLastFudoSync(data.last_sync_at)
    setFudoConnection((current) => ({
      ...current,
      state: data.state,
      message: data.state === 'error'
        ? 'Hay incidentes críticos o escrituras Fudo fallidas'
        : data.state === 'warning'
          ? `${data.incidents.open} incidentes Fudo abiertos`
          : null,
      issueCount: data.incidents.open,
      pendingEvents: data.events.pending,
      failedEvents: data.events.failed_last_24h,
      criticalIncidents: data.incidents.critical,
      highIncidents: data.incidents.high,
      incidentSample: data.incidents.sample ?? [],
    }))
  }, [])

  const loadLots = useCallback(async () => {
    setLoadingLots(true)
    try {
      const res = await fetch('/api/stock/lots?window_days=7&limit=8')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar vencimientos')
      setLotsData(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar lotes')
    } finally {
      setLoadingLots(false)
    }
  }, [])

  const loadReconciliation = useCallback(async () => {
    setLoadingReconciliation(true)
    try {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const res = await fetch(`/api/stock/reconciliation?view=stock&from=${from}`)
      if (!res.ok) return
      const data = await res.json()
      const rows = ((data.items ?? []) as ReconciliationRow[])
        .filter(r => Math.abs(r.variance) > 0.1)
        .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
        .slice(0, 5)
      setReconciliationRows(rows)
    } catch {
      // silencioso — no bloquea el flujo principal
    } finally {
      setLoadingReconciliation(false)
    }
  }, [])

  const loadIntelligence = useCallback(async () => {
    setLoadingIntelligence(true)
    try {
      const res = await fetch('/api/stock/intelligence')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar control de stock')
      setIntelligence(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar control de stock')
    } finally {
      setLoadingIntelligence(false)
    }
  }, [])

  const loadAnomalies = useCallback(async () => {
    setLoadingAnomalies(true)
    try {
      const res = await fetch('/api/stock/anomalies')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar anomalías')
      setAnomalies(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar anomalías')
    } finally {
      setLoadingAnomalies(false)
    }
  }, [])

  const reloadAll = useCallback(() =>
    Promise.all([mutate(), loadIntelligence(), loadAnomalies(), loadLots(), loadReconciliation()])
  , [mutate, loadIntelligence, loadAnomalies, loadLots, loadReconciliation])

  const handleItemUpdated = reloadAll

  const openMetadataEditor = useCallback((itemId: string, source: 'setup' | 'item', options?: {
    shelfLife?: number | null
    category?: StockCategoryValue | null
  }) => {
    const item = items.find((entry) => entry.id === itemId)
    if (!item) return

    if (editingMetaId === itemId && editingMetaSource === source) {
      setEditingMetaId(null)
      setEditingMetaSource(null)
      return
    }

    setEditingMetaId(itemId)
    setEditingMetaSource(source)
    setMetaInitial({ shelfLife: options?.shelfLife, category: options?.category })
  }, [editingMetaId, editingMetaSource, items])

  // Deep-link ?meta=<stock_item_id>: abre el editor de metadata de ese item
  // directamente (ej. desde /control para completar la vida útil) y scrollea.
  const metaParam = searchParams.get('meta')
  const [metaParamHandled, setMetaParamHandled] = useState(false)

  useEffect(() => {
    if (!metaParam || metaParamHandled || loading || items.length === 0) return
    setMetaParamHandled(true)

    const item = items.find((entry) => entry.id === metaParam)
    if (!item) return

    setView('inventario')
    setEditingMetaId(item.id)
    setEditingMetaSource('item')
    setMetaInitial({})

    // Esperar a que la vista inventario monte el item antes de scrollear
    setTimeout(() => {
      document.getElementById(`stock-item-${item.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 400)
  }, [metaParam, metaParamHandled, loading, items])

  const fixBrokenLink = useCallback(async (stockItemId: string, action: 'unlink' | 'deactivate', name: string) => {
    setFixingLinkId(stockItemId)
    try {
      const res = await fetch('/api/admin/stock/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_item_id: stockItemId, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      toast.success(action === 'unlink'
        ? `"${name}" queda como local — ya no sincroniza con Fudo`
        : `"${name}" desactivado`)
      void loadFudoStatus()
      void reloadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar')
    } finally {
      setFixingLinkId(null)
    }
  }, [loadFudoStatus, reloadAll])

  const resolveIncidents = useCallback(async () => {
    setResolvingIncidents(true)
    try {
      const res = await fetch('/api/fudo/incidents/resolve', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message ?? 'Incidentes resueltos')
        void loadFudoStatus()
      } else {
        toast.error(data.error ?? 'No se pudieron resolver los incidentes')
      }
    } catch {
      toast.error('Error al resolver incidentes')
    } finally {
      setResolvingIncidents(false)
    }
  }, [loadFudoStatus])

  // Única función de sync — usada tanto en el mount inicial como en el botón manual
  const runSync = useCallback(async (opts?: { silent?: boolean }) => {
    setSyncing(true)
    setFudoConnection((c) => ({ ...c, state: 'checking', message: null }))
    const fudoError = (msg: string) => ({
      state: 'error' as const, message: msg,
      issueCount: 0, pendingEvents: 0, failedEvents: 0,
      criticalIncidents: 0, highIncidents: 0, incidentSample: [],
    })
    try {
      const res  = await fetch('/api/stock/sync')
      const data = await res.json()
      if (res.ok && data.success && data.fudoConnected !== false) {
        const issueCount = Array.isArray(data.read?.errors) ? data.read.errors.length : 0
        setLastFudoSync(data.timestamp)
        setFudoSyncCount(data.read?.synced ?? 0)
        setFudoConnection({
          state: 'ok',
          message: issueCount > 0 ? `${issueCount} inconsistencias de mapeo Fudo` : null,
          issueCount, pendingEvents: 0, failedEvents: 0,
          criticalIncidents: 0, highIncidents: 0, incidentSample: [],
        })
        mutate()
        void loadFudoStatus().catch(() => null)
        void reloadAll()
        if (!opts?.silent) toast.success(`Sincronizado con Fudo — ${data.read?.synced ?? 0} items`)
      } else {
        const msg = data.error || 'No se pudo sincronizar con Fudo'
        setFudoConnection(fudoError(msg))
        void reloadAll()
        if (!opts?.silent) toast.error(msg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error de conexión con Fudo'
      setFudoConnection(fudoError(msg))
      void reloadAll()
      if (!opts?.silent) toast.error(msg)
    } finally {
      setSyncing(false)
    }
  }, [loadFudoStatus, mutate, reloadAll])

  // Sync silencioso al montar
  useEffect(() => {
    void runSync({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Filter
  const filtered = useMemo(() => {
    let result = items
    if (search.trim()) {
      const q = search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      result = result.filter(i =>
        i.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)
      )
    }
    if (areaFilter !== 'all') {
      result = result.filter(i => AREA_CATEGORIES[areaFilter].includes(i.category))
    }
    if (categoryFilter !== 'all') {
      result = result.filter(i => i.category === categoryFilter)
    }
    if (sourceFilter !== 'all') {
      result = result.filter(i => getStockSource(i).kind === sourceFilter)
    }
    if (semaphoreFilter) {
      result = result.filter(i => getSemaphore(i) === semaphoreFilter)
    }
    if (typeFilter === 'ingredient') {
      result = result.filter(i => Boolean(i.fudo_ingredient_id))
    } else if (typeFilter === 'product') {
      result = result.filter(i => Boolean(i.fudo_product_id) || i.category === 'elaborados')
    }
    if (negativesOnly) {
      result = result.filter(i => Number(i.current_qty) < 0)
    }
    return result
  }, [items, search, areaFilter, categoryFilter, sourceFilter, semaphoreFilter, typeFilter, negativesOnly])

  // Counts
  const counts = useMemo(() => {
    let red = 0, yellow = 0, green = 0
    for (const i of filtered) {
      const s = getSemaphore(i)
      if (s === 'red') red++
      else if (s === 'yellow') yellow++
      else green++
    }
    return { red, yellow, green, total: filtered.length }
  }, [filtered])

  const stockOverview = useMemo(() => {
    let red = 0, yellow = 0, green = 0, fudoLinked = 0, localOnly = 0, unmapped = 0, missingShelfLife = 0

    for (const item of items) {
      const semaphore = getSemaphore(item)
      if (semaphore === 'red') red++
      else if (semaphore === 'yellow') yellow++
      else green++

      if (item.fudo_product_id || item.fudo_ingredient_id) fudoLinked++
      else if (item.fudo_skip === true) localOnly++
      else unmapped++
      if (isPerishableForUi(item) && item.current_qty > 0 && item.shelf_life_days == null) {
        missingShelfLife++
      }
    }

    return { red, yellow, green, fudoLinked, localOnly, unmapped, missingShelfLife, total: items.length }
  }, [items])

  const criticalBreakdown = useMemo(() => {
    const red = items.filter(i => getSemaphore(i) === 'red')
    const ingredientes = red.filter(i => ['carnes', 'verduras', 'frutas', 'lacteos', 'condimentos'].includes(i.category ?? '')).length
    const elaborados = red.filter(i => i.category === 'elaborados').length
    const pasteleria = red.filter(i => i.category === 'panaderia').length
    const bebidas = red.filter(i => i.category === 'bebidas').length
    const otros = Math.max(0, red.length - ingredientes - elaborados - pasteleria - bebidas)
    return { ingredientes, elaborados, pasteleria, bebidas, otros }
  }, [items])

  const expiringLotsCount = (lotsData?.summary.expired ?? 0)
    + (lotsData?.summary.expiring_today ?? 0)
    + (lotsData?.summary.expiring_window ?? 0)

  const setupIssues = useMemo(
    () => intelligence?.setup_issues.slice(0, 4) ?? [],
    [intelligence],
  )

  const anomalyCards = useMemo<StockReviewCard[]>(() => {
    return (anomalies?.items ?? []).map((anomaly) => {
      const item = anomaly.stock_item_id
        ? items.find((entry) => entry.id === anomaly.stock_item_id) ?? null
        : null

      return {
        id: `anomaly:${anomaly.id}`,
        item,
        priority: priorityFromAnomaly(anomaly),
        title: anomaly.title,
        detail: anomaly.detail,
        primaryAction: anomaly.primary_action === 'pending_links' ? 'watch' : anomaly.primary_action,
        actionLabel: anomaly.action_label,
        actionHref: anomaly.action_href,
      }
    })
  }, [anomalies?.items, items])

  const reviewCards = useMemo<StockReviewCard[]>(() => {
    const cards: StockReviewCard[] = []
    const anomalyItemIds = new Set(
      (anomalies?.items ?? [])
        .map((entry) => entry.stock_item_id)
        .filter((value): value is string => Boolean(value)),
    )

    cards.push(...anomalyCards)

    for (const item of items) {
      if (anomalyItemIds.has(item.id)) continue
      const card = getQuantityReview(item)
      if (card) cards.push(card)
    }

    for (const issue of setupIssues) {
      const item = items.find((entry) => entry.id === issue.stock_item_id) ?? null
      cards.push({
        id: `setup:${issue.id}`,
        item,
        priority: issue.severity === 'high' ? 'accion' : 'revisar',
        title: issue.title,
        detail: issue.detail,
        primaryAction: 'configure',
      })
    }

    // Cards individuales por lote vencido o que vence hoy
    const expiredLots = lotsData?.lots.filter(l => l.expires_in_days < 0) ?? []
    const todayLots = lotsData?.lots.filter(l => l.expires_in_days === 0) ?? []
    const windowLots = lotsData?.lots.filter(l => l.expires_in_days > 0) ?? []

    for (const lot of expiredLots.slice(0, 3)) {
      const lotItem = items.find(e => e.id === lot.stock_item_id) ?? null
      cards.push({
        id: `lot:expired:${lot.id}`,
        item: lotItem,
        priority: 'critico',
        title: `${lot.stock_item_name}: lote vencido`,
        detail: `Lote ${lot.lot_code} venció hace ${Math.abs(lot.expires_in_days)}d. Quedan ${formatQty(lot.qty_remaining)} ${lot.unit}. Descartar o verificar uso urgente.`,
        primaryAction: lotItem ? 'count' : 'watch',
      })
    }
    for (const lot of todayLots.slice(0, 2)) {
      const lotItem = items.find(e => e.id === lot.stock_item_id) ?? null
      cards.push({
        id: `lot:today:${lot.id}`,
        item: lotItem,
        priority: 'accion',
        title: `${lot.stock_item_name}: vence hoy`,
        detail: `Lote ${lot.lot_code}. Quedan ${formatQty(lot.qty_remaining)} ${lot.unit}. Usarlo hoy, armar promo o descartar.`,
        primaryAction: lotItem ? 'count' : 'watch',
      })
    }
    if (windowLots.length > 0) {
      cards.push({
        id: 'lots:window',
        item: windowLots[0] ? items.find(e => e.id === windowLots[0].stock_item_id) ?? null : null,
        priority: 'revisar',
        title: `${windowLots.length} lote${windowLots.length > 1 ? 's' : ''} vencen en los próximos ${lotsData?.summary.window_days ?? 7}d`,
        detail: windowLots[0]
          ? `${windowLots[0].stock_item_name}: vence en ${windowLots[0].expires_in_days}d (${formatQty(windowLots[0].qty_remaining)} ${windowLots[0].unit}).`
          : 'Revisá vencimientos para definir promoción o uso prioritario.',
        primaryAction: 'watch',
      })
    }

    // Orden: por prioridad y, dentro de la misma prioridad, por rank operativo
    // (0 negativos → 1 críticos reales → 2 resto: anomalías, mapeos, lotes).
    const priorityOrder = { critico: 0, accion: 1, revisar: 2 }
    return cards
      .sort((a, b) => {
        const tier = priorityOrder[a.priority] - priorityOrder[b.priority]
        if (tier !== 0) return tier
        return (a.rank ?? 2) - (b.rank ?? 2)
      })
      .slice(0, 12)
  }, [
    anomalies?.items,
    anomalyCards,
    items,
    lotsData?.lots,
    lotsData?.summary.window_days,
    setupIssues,
  ])

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, StockItem[]>()
    for (const item of filtered) {
      const cat = item.category || 'otros'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(item)
    }
    for (const [, arr] of map) {
      // Negativos → críticos reales → "definí mínimo" → atención → OK → inactivos
      arr.sort((a, b) => {
        const ra = getCriticalityRank(a)
        const rb = getCriticalityRank(b)
        if (ra !== rb) return ra - rb
        return a.name.localeCompare(b.name)
      })
    }
    return map
  }, [filtered])

  const toggleCat = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const goToCritical = (opts: { area?: AreaFilter; category?: string; type?: 'ingredient' | 'product' } = {}) => {
    setSemaphoreFilter('red')
    setAreaFilter(opts.area ?? 'all')
    setCategoryFilter(opts.category ?? 'all')
    setTypeFilter(opts.type ?? 'all')
    setSourceFilter('all')
    setNegativesOnly(false)
    setView('conteo')
  }

  const startPhysicalCount = (item: StockItem) => {
    const source = getStockSource(item)
    if (!isEncargado) return
    if (source.kind === 'fudo' && (fudoConnection.state === 'checking' || fudoConnection.state === 'error')) {
      toast.error('Stock bloqueado: primero hay que reconectar con Fudo')
      return
    }
    if (!source.actionable) {
      toast.error('Stock bloqueado: item sin mapeo Fudo ni Local LVE')
      return
    }
    setWastingId(null)
    setView('conteo')
    setEditingId(item.id)
  }

  const primaryReviewCard = reviewCards[0] ?? null
  const secondaryReviewCards = reviewCards.slice(1)
  const fudoStatusUi = fudoConnection.state === 'error'
    ? {
      label: 'Fudo bloqueado',
      detail: fudoConnection.message ?? 'Requiere sincronización',
      className: 'bg-[#fff7f7] text-[#ea504c] ring-[#f3d0cf]',
      Icon: AlertTriangle,
    }
    : fudoConnection.state === 'warning'
      ? {
        label: 'Fudo con alertas',
        detail: fudoConnection.message ?? 'Hay vínculos para revisar',
        className: 'bg-[#fffaf2] text-[#d4943a] ring-[#f1dfba]',
        Icon: AlertTriangle,
      }
    : fudoConnection.state === 'checking'
      ? {
        label: 'Verificando Fudo',
        detail: 'Sincronización en curso',
        className: 'bg-[#faf8f5] text-[#7d6c64] ring-[#ebe6df]',
        Icon: Loader2,
      }
      : {
        label: 'Fudo conectado',
        detail: lastFudoSync ? `Última sync ${format(new Date(lastFudoSync), 'HH:mm')}` : 'Listo para controlar',
        className: 'bg-[#e8f5f1] text-[#006d5a] ring-[#dcefe8]',
        Icon: CheckCircle2,
      }
  const FudoStatusIcon = fudoStatusUi.Icon

  const renderReviewCard = (card: StockReviewCard, options?: { featured?: boolean }) => (
    <ReviewCard
      key={card.id}
      card={card}
      featured={options?.featured}
      onSync={() => { setView('radar'); void runSync({}) }}
      onCount={(item) => startPhysicalCount(item)}
      onConfigure={(itemId) => openMetadataEditor(itemId, 'item')}
      onMap={() => { setSourceFilter('unmapped'); setView('inventario') }}
      onWatch={() => setView('conteo')}
    />
  )

  // Loading
  if (profileLoading || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[#a39e97]" />
      </div>
    )
  }

  if (profile && !isEncargado) {
    return <EmptyState icon={Package} title="Acceso restringido" description="Solo encargados y socios." />
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-28">
      <BackToHoy />
      {/* Header */}
      <FadeIn>
        <div className="overflow-hidden rounded-[2rem] border border-[#ebe6df] bg-[radial-gradient(circle_at_top_left,#e8f5f1_0,#fbfaf8_34%,#ffffff_72%)] p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#3d2c24] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                  Stock LVE
                </span>
                <button
                  onClick={() => { if (isEncargado) router.push('/admin/fudo') }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ring-1 transition-transform ${fudoStatusUi.className} ${isEncargado ? 'active:scale-95' : 'cursor-default'}`}
                >
                  <FudoStatusIcon className={`size-3.5 ${fudoConnection.state === 'checking' ? 'animate-spin' : ''}`} />
                  {fudoStatusUi.label}
                </button>
              </div>
              <h1 className="mt-3 font-display text-3xl font-bold leading-[1.05] tracking-tight text-[#3d2c24] sm:text-4xl">
                Control de mercadería
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#6f665f]">
                Primero Radar: detecta anomalías. Después Conteo: corregí el stock físico.
                Inventario queda como búsqueda completa, no como pantalla principal.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:min-w-[210px]">
              <div className={`rounded-2xl px-3 py-2 text-sm font-bold ring-1 ${fudoStatusUi.className}`}>
                <p>{fudoStatusUi.detail}</p>
                {fudoConnection.issueCount > 0 && (
                  <p className="mt-0.5 text-[11px] opacity-80">{fudoConnection.issueCount} incidentes abiertos</p>
                )}
              </div>
              {isEncargado && (
                <button
                  onClick={() => void runSync()}
                  disabled={syncing}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-[#006d5a] px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#005447] disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Traer datos de Fudo
                </button>
              )}
            </div>
          </div>

          <StaggerList className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" staggerDelay={0.06}>
            <StaggerItem>
              <button
                onClick={() => { setView('inventario'); setSourceFilter('all'); setSemaphoreFilter(null) }}
                className="group relative h-full w-full overflow-hidden rounded-2xl bg-white/80 px-3 py-3 text-left ring-1 ring-[#ebe6df] transition hover:bg-white hover:shadow-sm active:scale-[0.98]"
              >
                <span className="absolute inset-y-0 left-0 w-1 bg-[#a39e97]/40" />
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Items activos</p>
                <p className="mt-1 font-display text-3xl font-bold leading-none tabular-nums text-[#3d2c24]">{stockOverview.total}</p>
                <p className="mt-1 text-[11px] text-[#7d6c64]">{stockOverview.fudoLinked} vinculados a Fudo</p>
              </button>
            </StaggerItem>
            <StaggerItem>
              <button
                onClick={() => { setView('conteo'); setSemaphoreFilter('red') }}
                className="group relative h-full w-full overflow-hidden rounded-2xl bg-[#fff7f7] px-3 py-3 text-left ring-1 ring-[#f3d0cf] transition hover:bg-white hover:shadow-sm active:scale-[0.98]"
              >
                <span className="absolute inset-y-0 left-0 w-1 bg-[#ea504c]" />
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#ea504c]">Críticos</p>
                <p className="mt-1 font-display text-3xl font-bold leading-none tabular-nums text-[#3d2c24]">{stockOverview.red}</p>
                <p className="mt-1 text-[11px] text-[#7d6c64]">requieren conteo o reposición</p>
              </button>
            </StaggerItem>
            <StaggerItem>
              <button
                onClick={() => { setView('inventario'); setSourceFilter('unmapped') }}
                className="group relative h-full w-full overflow-hidden rounded-2xl bg-[#fffaf2] px-3 py-3 text-left ring-1 ring-[#f1dfba] transition hover:bg-white hover:shadow-sm active:scale-[0.98]"
              >
                <span className="absolute inset-y-0 left-0 w-1 bg-[#d4943a]" />
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#d4943a]">Sin mapeo</p>
                <p className="mt-1 font-display text-3xl font-bold leading-none tabular-nums text-[#3d2c24]">{stockOverview.unmapped}</p>
                <p className="mt-1 text-[11px] text-[#7d6c64]">bloqueados para escritura</p>
              </button>
            </StaggerItem>
            <StaggerItem>
              <button
                onClick={() => setView('radar')}
                className="group relative h-full w-full overflow-hidden rounded-2xl bg-[#f6fcfa] px-3 py-3 text-left ring-1 ring-[#dcefe8] transition hover:bg-white hover:shadow-sm active:scale-[0.98]"
              >
                <span className="absolute inset-y-0 left-0 w-1 bg-[#006d5a]" />
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#006d5a]">Anomalías</p>
                <p className="mt-1 font-display text-3xl font-bold leading-none tabular-nums text-[#3d2c24]">
                  {loadingAnomalies ? '…' : anomalies?.summary.total ?? reviewCards.length}
                </p>
                <p className="mt-1 text-[11px] text-[#7d6c64]">
                  {anomalies?.summary.pending_recipe_links
                    ? `${anomalies.summary.pending_recipe_links} vínculos de receta pendientes`
                    : `${fudoSyncCount} leídos de Fudo`}
                </p>
              </button>
            </StaggerItem>
          </StaggerList>

          <Link
            href="/stock/puesta-a-cero"
            className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-[#006d5a] px-4 py-3 text-white shadow-sm transition hover:bg-[#005a4a]"
          >
            <div className="flex items-center gap-2.5">
              <ListChecks className="size-5 shrink-0" />
              <div>
                <p className="text-[14px] font-bold leading-tight">Puesta a cero</p>
                <p className="text-[11px] text-white/80">Contá intermedios y negativos → corrige Fudo</p>
              </div>
            </div>
            <ArrowRight className="size-5 shrink-0" />
          </Link>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link
              href="/stock/rendimiento"
              className="flex items-center justify-between gap-2 rounded-2xl bg-white/80 px-3 py-2.5 ring-1 ring-[#ebe6df] transition hover:bg-white"
            >
              <div>
                <p className="text-[12px] font-bold text-[#3d2c24]">Rendimiento</p>
                <p className="text-[10px] text-[#7d6c64]">consumos y desvíos</p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-[#a39e97]" />
            </Link>
            <Link
              href="/stock/historial"
              className="flex items-center justify-between gap-2 rounded-2xl bg-white/80 px-3 py-2.5 ring-1 ring-[#ebe6df] transition hover:bg-white"
            >
              <div>
                <p className="text-[12px] font-bold text-[#3d2c24]">Historial</p>
                <p className="text-[10px] text-[#7d6c64]">movimientos de stock</p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-[#a39e97]" />
            </Link>
            <Link
              href="/ventas?m=precios"
              className="flex items-center justify-between gap-2 rounded-2xl bg-white/80 px-3 py-2.5 ring-1 ring-[#ebe6df] transition hover:bg-white"
            >
              <div>
                <p className="text-[12px] font-bold text-[#3d2c24]">Precios de compra</p>
                <p className="text-[10px] text-[#7d6c64]">histórico por insumo</p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-[#a39e97]" />
            </Link>
            <Link
              href="/stock/consumo"
              className="flex items-center justify-between gap-2 rounded-2xl bg-[#e8f5f1] px-3 py-2.5 ring-1 ring-[#006d5a]/20 transition hover:bg-[#d4ede7]"
            >
              <div>
                <p className="text-[12px] font-bold text-[#006d5a]">Consumo</p>
                <p className="text-[10px] text-[#006d5a]/70">ventas × receta por período</p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-[#006d5a]" />
            </Link>
          </div>
        </div>
      </FadeIn>

      <FadeIn>
        <div className="grid grid-cols-3 gap-2 rounded-[1.35rem] border border-[#ebe6df] bg-white p-1 shadow-sm">
          {[
            { key: 'radar' as const, label: 'Radar', detail: `${reviewCards.length} alertas`, Icon: Activity },
            { key: 'conteo' as const, label: 'Conteo', detail: 'stock físico', Icon: ClipboardList },
            { key: 'inventario' as const, label: 'Inventario', detail: `${stockOverview.total} items`, Icon: ListChecks },
          ].map((tab) => {
            const Icon = tab.Icon
            const active = view === tab.key

            return (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                className="relative rounded-2xl px-2 py-2.5 text-left transition-colors"
              >
                {active && (
                  <motion.span
                    layoutId="stock-view-pill"
                    className="absolute inset-0 rounded-2xl bg-[#3d2c24] shadow-sm"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className={`relative z-10 flex items-center gap-2 ${active ? 'text-white' : 'text-[#8d847b]'}`}>
                  <Icon className="size-4" />
                  <span className="text-sm font-bold">{tab.label}</span>
                </span>
                <span className={`relative z-10 mt-0.5 block pl-6 text-[10px] font-semibold uppercase tracking-wide ${
                  active ? 'text-white/70' : 'text-[#a39e97]'
                }`}>
                  {tab.detail}
                </span>
              </button>
            )
          })}
        </div>
      </FadeIn>

      {view === 'radar' && (
        <FadeIn>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="overflow-hidden rounded-[2rem] border border-[#ebe6df] bg-white shadow-sm">
              <div className="border-b border-[#ebe6df] bg-[#fbfaf8] px-4 py-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a39e97]">
                  Prioridad inmediata
                </p>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-[#3d2c24]">
                  Qué hay que mirar ahora
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-[#6f665f]">
                  Una sola decisión principal para evitar que el encargado tenga que interpretar toda la lista.
                </p>
              </div>

              <div className="p-4">
                {primaryReviewCard ? (
                  renderReviewCard(primaryReviewCard, { featured: true })
                ) : (
                  <div className="rounded-[1.4rem] bg-[#f6fcfa] px-4 py-5 ring-1 ring-[#dcefe8]">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#006d5a]" />
                      <div>
                        <p className="text-base font-bold text-[#3d2c24]">Sin anomalías relevantes</p>
                        <p className="mt-1 text-sm leading-relaxed text-[#6f665f]">
                          Fudo y LVE no muestran bloqueos críticos. Si querés auditar igual, entrá a Conteo.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setView('conteo')}
                      className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-[#006d5a] px-4 py-2.5 text-sm font-bold text-white"
                    >
                      Ir a conteo físico
                      <ArrowRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </section>

            <aside className="space-y-3">
              <div className="rounded-[2rem] border border-[#ebe6df] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a39e97]">
                      Mapa de riesgo
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-[#3d2c24]">Dónde puede fallar</h3>
                  </div>
                  <Activity className="size-5 text-[#006d5a]" />
                </div>

                <div className="mt-4 space-y-2">
                  <div className="rounded-2xl bg-[#fff7f7] ring-1 ring-[#f3d0cf]">
                    <button
                      onClick={() => goToCritical()}
                      className="flex w-full items-center justify-between px-3 py-3 text-left"
                    >
                      <span>
                        <span className="block text-[10px] font-bold uppercase tracking-wide text-[#ea504c]">Stock crítico</span>
                        <span className="text-[12px] text-[#7d6c64]">contar o reponer · tocá para ver todos</span>
                      </span>
                      <span className="text-2xl font-bold text-[#3d2c24]">{stockOverview.red}</span>
                    </button>
                    {stockOverview.red > 0 && (
                      <div className="flex flex-wrap gap-1.5 border-t border-[#f3d0cf] px-3 pb-3 pt-2">
                        {[
                          { label: 'Ingredientes', count: criticalBreakdown.ingredientes, action: () => goToCritical({ area: 'cocina', type: 'ingredient' }) },
                          { label: 'Elaborados', count: criticalBreakdown.elaborados, action: () => goToCritical({ category: 'elaborados' }) },
                          { label: 'Pastelería', count: criticalBreakdown.pasteleria, action: () => goToCritical({ area: 'pasteleria' }) },
                          { label: 'Bebidas', count: criticalBreakdown.bebidas, action: () => goToCritical({ category: 'bebidas' }) },
                          { label: 'Otros', count: criticalBreakdown.otros, action: () => goToCritical() },
                        ].filter(g => g.count > 0).map(g => (
                          <button
                            key={g.label}
                            onClick={g.action}
                            className="rounded-full bg-[#fef2f2] px-2.5 py-1 text-[10px] font-bold text-[#ea504c] ring-1 ring-[#f3d0cf] transition-colors hover:bg-[#fddcdb]"
                          >
                            {g.label} · {g.count}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => { setSourceFilter('unmapped'); setView('inventario') }}
                    className="flex w-full items-center justify-between rounded-2xl bg-[#fffaf2] px-3 py-3 text-left ring-1 ring-[#f1dfba]"
                  >
                    <span>
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-[#d4943a]">Sin mapeo Fudo</span>
                      <span className="text-[12px] text-[#7d6c64]">no se puede escribir</span>
                    </span>
                    <span className="text-2xl font-bold text-[#3d2c24]">{stockOverview.unmapped}</span>
                  </button>
                  <div className="flex items-center justify-between rounded-2xl bg-[#faf8f5] px-3 py-3 ring-1 ring-[#ebe6df]">
                    <span>
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-[#7d6c64]">Vencimientos</span>
                      <span className="text-[12px] text-[#7d6c64]">usar, promo o descarte</span>
                    </span>
                    <span className="text-2xl font-bold text-[#3d2c24]">{expiringLotsCount}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-[#ebe6df] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a39e97]">
                      Cola de control
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-[#3d2c24]">
                      {secondaryReviewCards.length} pendientes
                    </h3>
                  </div>
                  <ListChecks className="size-5 text-[#7d6c64]" />
                </div>

                {secondaryReviewCards.length === 0 ? (
                  <p className="mt-3 rounded-2xl bg-[#faf8f5] px-3 py-3 text-sm text-[#7d6c64]">
                    No hay cola adicional. El radar está limpio después de la prioridad principal.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {secondaryReviewCards.map((card) => renderReviewCard(card))}
                  </div>
                )}
              </div>
              {reconciliationRows.length > 0 && (
                <div className="rounded-[2rem] border border-[#ebe6df] bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a39e97]">
                        Diferencias (7 días)
                      </p>
                      <h3 className="mt-1 text-lg font-bold text-[#3d2c24]">Fudo vs físico</h3>
                    </div>
                    {loadingReconciliation
                      ? <Loader2 className="size-5 animate-spin text-[#a39e97]" />
                      : <TrendingDown className="size-5 text-[#d4943a]" />
                    }
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {reconciliationRows.map(row => {
                      const isDeficit = row.variance > 0
                      const absVariance = Math.abs(row.variance)
                      const pct = row.expected_closing > 0 ? absVariance / row.expected_closing : 1
                      const tone = pct > 0.2
                        ? isDeficit
                          ? 'bg-[#fff7f7] ring-[#f3d0cf]'
                          : 'bg-[#f6fcfa] ring-[#dcefe8]'
                        : 'bg-[#fffaf2] ring-[#f1dfba]'
                      const varColor = pct > 0.2
                        ? isDeficit ? 'text-[#ea504c]' : 'text-[#006d5a]'
                        : 'text-[#d4943a]'
                      return (
                        <div key={row.stock_item_id} className={`rounded-xl px-3 py-2 ring-1 ${tone}`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-[12px] font-semibold text-[#3d2c24]">{row.name}</p>
                            <span className={`shrink-0 text-[12px] font-bold tabular-nums ${varColor}`}>
                              {isDeficit ? '−' : '+'}{formatQty(absVariance)} {row.unit}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[10px] text-[#7d6c64]">
                            Esperado {formatQty(row.expected_closing)} · Real {formatQty(row.actual_closing)} {row.unit}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </FadeIn>
      )}

      {view !== 'radar' && (
      <FadeIn>
        <div className="rounded-xl border border-[#ebe6df] bg-white p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#3d2c24]">Qué necesita atención</h2>
            {(loadingIntelligence || loadingLots) && <Loader2 className="size-4 animate-spin text-[#a39e97]" />}
          </div>

          <div className={`mt-3 rounded-lg border px-3 py-2 text-[12px] ${
            fudoConnection.state === 'ok'
              ? fudoConnection.issueCount > 0
                ? 'border-[#f1dfba] bg-[#fffaf2] text-[#8b5e34]'
                : 'border-[#dcefe8] bg-[#f6fcfa] text-[#006d5a]'
              : fudoConnection.state === 'warning'
                ? 'border-[#f1dfba] bg-[#fffaf2] text-[#8b5e34]'
              : fudoConnection.state === 'checking'
                ? 'border-[#ebe6df] bg-[#faf8f5] text-[#7d6c64]'
                : 'border-[#f3d0cf] bg-[#fff7f7] text-[#ea504c]'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">
                {fudoConnection.state === 'ok'
                  ? 'Fudo conectado'
                  : fudoConnection.state === 'warning'
                    ? 'Fudo con alertas'
                  : fudoConnection.state === 'checking'
                    ? 'Verificando Fudo'
                    : 'Fudo sin conexión'}
              </span>
              {syncing && <Loader2 className="size-3.5 animate-spin" />}
            </div>
            {fudoConnection.message && (
              <p className="mt-0.5 text-[11px]">{fudoConnection.message}</p>
            )}
            {(fudoConnection.pendingEvents > 0 || fudoConnection.failedEvents > 0 || fudoConnection.criticalIncidents > 0 || fudoConnection.highIncidents > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fudoConnection.criticalIncidents > 0 && (
                  <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[10px] font-bold text-[#ea504c]">
                    {fudoConnection.criticalIncidents} críticos
                  </span>
                )}
                {fudoConnection.highIncidents > 0 && (
                  <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[10px] font-bold text-[#d4943a]">
                    {fudoConnection.highIncidents} altos
                  </span>
                )}
                {fudoConnection.failedEvents > 0 && (
                  <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[10px] font-bold text-[#ea504c]">
                    {fudoConnection.failedEvents} escrituras fallidas
                  </span>
                )}
                {fudoConnection.pendingEvents > 0 && (
                  <span className="rounded-full bg-[#f3efe9] px-2 py-0.5 text-[10px] font-bold text-[#7d6c64]">
                    {fudoConnection.pendingEvents} pendientes
                  </span>
                )}
              </div>
            )}
            {fudoConnection.state === 'error' && (
              <p className="mt-0.5 text-[11px]">Las escrituras de stock quedan bloqueadas hasta que Fudo vuelva a responder correctamente.</p>
            )}
            {fudoConnection.incidentSample.length > 0 && (fudoConnection.state === 'error' || fudoConnection.state === 'warning') && (() => {
              const brokenLinks = fudoConnection.incidentSample.filter(
                inc => (inc.code === 'fudo_product_missing' || inc.code === 'fudo_ingredient_missing') && inc.stock_item_id
              )
              const otherIncidents = fudoConnection.incidentSample.filter(
                inc => inc.code !== 'fudo_product_missing' && inc.code !== 'fudo_ingredient_missing'
              )
              return (
                <div className="mt-2 space-y-2">
                  {brokenLinks.length > 0 && isEncargado && (
                    <div className="rounded border border-[#f3d0cf] bg-[#fff7f7] p-2">
                      <p className="text-[10px] font-bold text-[#ea504c] mb-1.5">
                        {brokenLinks.length} vínculo{brokenLinks.length !== 1 ? 's' : ''} roto{brokenLinks.length !== 1 ? 's' : ''} — borrado{brokenLinks.length !== 1 ? 's' : ''} en Fudo
                      </p>
                      <div className="space-y-1.5">
                        {brokenLinks.map(inc => (
                          <div key={inc.id} className="rounded bg-white border border-[#f3d0cf] p-2">
                            <p className="text-[11px] font-semibold text-[#3d2c24] mb-1.5 leading-tight">{inc.title}</p>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => void fixBrokenLink(inc.stock_item_id!, 'unlink', inc.title)}
                                disabled={fixingLinkId === inc.stock_item_id}
                                className="flex flex-1 items-center justify-center gap-1 rounded bg-[#f5f0eb] px-2 py-1.5 text-[10px] font-semibold text-[#3d2c24] disabled:opacity-50"
                              >
                                {fixingLinkId === inc.stock_item_id ? <Loader2 className="size-3 animate-spin" /> : <Unlink className="size-3" />}
                                Usar sin Fudo
                              </button>
                              <button
                                onClick={() => void fixBrokenLink(inc.stock_item_id!, 'deactivate', inc.title)}
                                disabled={fixingLinkId === inc.stock_item_id}
                                className="flex flex-1 items-center justify-center gap-1 rounded bg-[#fef2f2] px-2 py-1.5 text-[10px] font-semibold text-[#ea504c] disabled:opacity-50"
                              >
                                {fixingLinkId === inc.stock_item_id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                                Desactivar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {otherIncidents.slice(0, 6).map(inc => (
                    <div key={inc.id} className={`rounded px-2 py-1 text-[10px] leading-snug ${inc.severity === 'critical' ? 'bg-[#fef2f2] text-[#3d2c24]' : 'bg-[#fffaf2] text-[#3d2c24]'}`}>
                      <span className={`font-bold mr-1 ${inc.severity === 'critical' ? 'text-[#ea504c]' : 'text-[#d4943a]'}`}>
                        {inc.severity === 'critical' ? '● CRIT' : '● ALTO'}
                      </span>
                      {inc.title}
                    </div>
                  ))}
                </div>
              )
            })()}
            {fudoConnection.state === 'error' && isEncargado && (
              <button
                onClick={() => void resolveIncidents()}
                disabled={resolvingIncidents}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded bg-[#ea504c] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                {resolvingIncidents
                  ? <><Loader2 className="size-3 animate-spin" /> Limpiando…</>
                  : 'Fudo está OK ahora → Limpiar bloqueo'}
              </button>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-3 py-3">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#006d5a]" />
              <div>
                <p className="text-[12px] font-bold text-[#3d2c24]">Flujo seguro de control</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#7d6c64]">
                  1. Traer Fudo. 2. Contar físicamente el item exacto. 3. Guardar conteo con diferencia visible.
                  Los items sin mapeo quedan bloqueados para evitar pisar stock incorrecto.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => setSemaphoreFilter(semaphoreFilter === 'red' ? null : 'red')}
              className="rounded-lg border border-[#f3d0cf] bg-[#fff7f7] px-3 py-2 text-left"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#ea504c]">Crítico</p>
              <p className="mt-0.5 text-xl font-bold text-[#3d2c24]">{stockOverview.red}</p>
            </button>

            <button
              onClick={() => setSemaphoreFilter(semaphoreFilter === 'yellow' ? null : 'yellow')}
              className="rounded-lg border border-[#f1dfba] bg-[#fffaf2] px-3 py-2 text-left"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#d4943a]">Atención</p>
              <p className="mt-0.5 text-xl font-bold text-[#3d2c24]">{stockOverview.yellow}</p>
            </button>

            <div className="rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7d6c64]">Vencen</p>
              <p className="mt-0.5 text-xl font-bold text-[#3d2c24]">{expiringLotsCount}</p>
            </div>

            <div className="rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7d6c64]">Sin vida útil</p>
              <p className="mt-0.5 text-xl font-bold text-[#3d2c24]">
                {intelligence?.summary.perishable_missing_shelf_life ?? stockOverview.missingShelfLife}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
            {[
              { key: 'all' as const, label: `${stockOverview.total} activos`, tone: 'text-[#7d6c64]' },
              { key: 'fudo' as const, label: `${stockOverview.fudoLinked} Fudo`, tone: 'text-[#006d5a]' },
              { key: 'local' as const, label: `${stockOverview.localOnly} Local LVE`, tone: 'text-[#7d6c64]' },
              { key: 'unmapped' as const, label: `${stockOverview.unmapped} sin mapeo`, tone: 'text-[#ea504c]' },
            ].map((filter) => (
              <button
                key={filter.key}
                onClick={() => setSourceFilter(filter.key)}
                className={`rounded-full px-2 py-0.5 ${sourceFilter === filter.key ? 'bg-[#3d2c24] text-white' : `bg-[#faf8f5] ${filter.tone}`}`}
              >
                {filter.label}
              </button>
            ))}
            {lastFudoSync && <span>Fudo {format(new Date(lastFudoSync), 'HH:mm')}</span>}
          </div>
          {stockOverview.unmapped > 0 && (
            <p className="mt-2 rounded-lg bg-[#fff7f7] px-3 py-2 text-[11px] font-semibold text-[#ea504c]">
              Los items sin mapeo quedan bloqueados para escritura: vinculalos a Fudo o marcalos como Local LVE.
            </p>
          )}
        </div>
      </FadeIn>
      )}

      {view !== 'radar' && (lotsData?.requires_migration || Boolean(lotsData?.lots.length)) && (
        <FadeIn>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-[#8b5e34]" />
              <h2 className="text-sm font-semibold text-[#3d2c24]">Vencimientos</h2>
            </div>

            {lotsData?.requires_migration ? (
              <div className="rounded-lg border border-[#f4dfb7] bg-[#fff8eb] px-3 py-3 text-[12px] text-[#8b5e34]">
                Falta aplicar la migración de lotes en la base.
              </div>
            ) : (
              <div className="space-y-1.5">
                {lotsData?.lots.slice(0, 4).map((lot) => {
                  const tone = lotTone(lot.expires_in_days)

                  return (
                    <div key={lot.id} className={`rounded-lg border px-3 py-2 ${tone.panel}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#3d2c24]">{lot.stock_item_name}</p>
                          <p className="truncate text-[11px] text-[#7d6c64]">
                            {lot.lot_code} · {format(new Date(lot.expires_at), 'd MMM', { locale: es })}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.pill}`}>
                            {formatLotCountdown(lot.expires_in_days)}
                          </span>
                          <p className="mt-0.5 text-[11px] font-bold text-[#3d2c24]">
                            {formatQty(lot.qty_remaining)} {lot.unit}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </FadeIn>
      )}

      {view !== 'radar' && setupIssues.length > 0 && (
        <FadeIn>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-[#d4943a]" />
              <h2 className="text-sm font-semibold text-[#3d2c24]">Configuración pendiente</h2>
              <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[10px] font-bold text-[#d4943a]">
                {intelligence?.setup_issues.length ?? 0}
              </span>
            </div>

            {setupIssues.map((issue) => {
              const issueItem = items.find((entry) => entry.id === issue.stock_item_id) ?? null
              const metaOpen = editingMetaId === issue.stock_item_id && editingMetaSource === 'setup'
              return (
                <div key={issue.id} className="overflow-hidden rounded-lg border border-[#ebe6df] bg-white">
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[#3d2c24]">{issue.stock_item_name}</p>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${PRIORITY_STYLES[issue.severity]}`}>
                          {formatPriority(issue.severity)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-[#7d6c64]">{issue.title}</p>
                    </div>

                    <button
                      onClick={() => openMetadataEditor(issue.stock_item_id, 'setup', {
                        shelfLife: issue.suggested_shelf_life_days,
                        category: issue.suggested_category,
                      })}
                      className="shrink-0 rounded-lg bg-[#3d2c24] px-2.5 py-2 text-[11px] font-semibold text-white"
                    >
                      Configurar
                    </button>
                  </div>

                  {metaOpen && issueItem && (
                    <MetadataEditor
                      item={issueItem}
                      initialShelfLife={metaInitial.shelfLife}
                      initialCategory={metaInitial.category}
                      onSaved={() => {
                        setEditingMetaId(null)
                        setEditingMetaSource(null)
                        void handleItemUpdated()
                      }}
                      onCancel={() => {
                        setEditingMetaId(null)
                        setEditingMetaSource(null)
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </FadeIn>
      )}

      {view !== 'radar' && (
      <>
      <div className="rounded-2xl border border-[#ebe6df] bg-white px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a39e97]">
          {view === 'conteo' ? 'Conteo físico' : 'Inventario completo'}
        </p>
        <h2 className="mt-1 text-lg font-bold text-[#3d2c24]">
          {view === 'conteo' ? 'Elegí el item exacto que estás contando' : 'Buscar y revisar todos los items'}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-[#7d6c64]">
          {view === 'conteo'
            ? 'El número que cargues es el conteo real. Si está vinculado a Fudo, primero se guarda en Fudo y después en LVE.'
            : 'Esta vista es solo para buscar, filtrar y entrar al detalle. Las anomalías importantes están en Radar.'}
        </p>
        {view === 'conteo' && (
          <button
            onClick={() => setShowHowItWorks(v => !v)}
            className="mt-2 text-[11px] font-semibold text-[#006d5a] underline"
          >
            {showHowItWorks ? 'Ocultar explicación' : '¿Cómo funciona el control? ¿Por qué hay negativos?'}
          </button>
        )}
        {view === 'conteo' && showHowItWorks && (
          <div className="mt-2 space-y-2 rounded-xl bg-[#faf8f5] p-3 text-xs leading-relaxed text-[#3d2c24]">
            <p>
              <span className="font-bold">El número digital es el espejo de Fudo.</span> Cada venta descuenta
              stock sola. Pero el sistema solo SUMA cuando alguien le avisa: al{' '}
              <span className="font-bold">recibir mercadería</span> (Pedidos → Recibido), al{' '}
              <span className="font-bold">registrar producción</span>, o al <span className="font-bold">contar</span> acá.
            </p>
            <p>
              <span className="font-bold text-[#ea504c]">Un negativo no es un error del sistema:</span> significa
              que se vendió más de lo que el sistema supo que entró — nunca se registró la compra, la producción
              o un conteo. Se arregla en 10 segundos: contás lo físico, cargás el número real, y de ahí en
              adelante se mantiene solo (si se registran las entradas).
            </p>
            <p className="text-[#7d6c64]">
              <span className="font-bold">Rutina sugerida:</span> al recibir mercadería → Recibido con cantidades ·
              al producir → registrarlo · conteo físico por área una vez por semana (rotando: lunes pastelería,
              martes heladera, etc.) · los negativos, contarlos apenas aparecen.
            </p>
          </div>
        )}
      </div>

      {/* Negativos: el atajo para sanearlos de una */}
      {view === 'conteo' && (() => {
        const negCount = items.filter(i => Number(i.current_qty) < 0).length
        if (negCount === 0 && !negativesOnly) return null
        return (
          <button
            onClick={() => setNegativesOnly(v => !v)}
            className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left ring-1 transition-all ${
              negativesOnly ? 'bg-[#ea504c] text-white ring-[#ea504c]' : 'bg-[#fff7f7] text-[#ea504c] ring-[#f3d0cf]'
            }`}
          >
            <span className="text-sm font-bold">
              {negativesOnly ? `Mostrando solo los ${negCount} negativos` : `${negCount} items en negativo — contarlos primero`}
            </span>
            <span className={`text-[11px] font-semibold ${negativesOnly ? 'text-white/80' : ''}`}>
              {negativesOnly ? 'ver todos' : 'ver solo estos'}
            </span>
          </button>
        )
      })()}

      {/* Conteo programado — items prioritarios según días sin contar */}
      {view === 'conteo' && !search && (() => {
        const now = Date.now()
        const priority = filtered
          .map(item => {
            const daysSince = item.last_counted_at
              ? Math.floor((now - new Date(item.last_counted_at).getTime()) / 86400000)
              : null
            return { item, daysSince, rank: getCriticalityRank(item) }
          })
          .filter(({ daysSince, rank }) => {
            if (rank === 0) return true   // negativos: contarlos siempre, aunque se hayan contado ayer
            if (rank === 5) return false  // 0 sin mínimo y sin movimiento: no gastan tiempo de conteo
            if (daysSince === null) return rank <= 3 // nunca contados: solo con señal real
            return daysSince >= 3
          })
          .sort((a, b) => {
            // Negativos → críticos reales → "definí mínimo" → resto; a igual
            // criticidad, primero los nunca contados y después por días desc
            if (a.rank !== b.rank) return a.rank - b.rank
            if (a.daysSince === null && b.daysSince !== null) return -1
            if (a.daysSince !== null && b.daysSince === null) return 1
            return (b.daysSince ?? 0) - (a.daysSince ?? 0)
          })
          .slice(0, 6)

        if (priority.length === 0) return null
        return (
          <div className="rounded-2xl border border-[#ebe6df] bg-white px-4 py-3">
            <div className="mb-3 flex items-center gap-2">
              <CalendarClock className="size-4 text-[#d4943a]" />
              <div>
                <p className="text-[11px] font-bold text-[#3d2c24]">Prioridad de conteo</p>
                <p className="text-[10px] text-[#a39e97]">Negativos y críticos primero; después, los que hace más tiempo no se cuentan</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {priority.map(({ item, daysSince }) => {
                const sem = getSemaphore(item)
                return (
                  <button
                    key={item.id}
                    onClick={() => startPhysicalCount(item)}
                    className="flex w-full items-center gap-3 rounded-xl bg-[#faf8f5] px-3 py-2.5 text-left transition-colors hover:bg-[#f3efe9] active:scale-[0.99]"
                  >
                    <span className={`size-2 shrink-0 rounded-full ${sem === 'red' ? 'bg-[#ea504c]' : sem === 'yellow' ? 'bg-[#d4943a]' : 'bg-[#006d5a]'}`} />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#3d2c24]">{item.name}</span>
                    <span className="shrink-0 text-[10px] font-bold text-[#a39e97]">
                      {daysSince === null ? 'Sin conteo' : `${daysSince}d`}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-[#a39e97]" />
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Search — sticky para que siempre esté a mano mientras se recorre la lista */}
      <div className="sticky top-2 z-20">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={view === 'conteo' ? 'Buscá el producto que estás contando...' : 'Buscar insumo o producto...'}
          className="w-full rounded-xl border border-[#ebe6df] bg-white py-2.5 pl-10 pr-3 text-sm text-[#3d2c24] shadow-sm placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
        />
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#a39e97] hover:bg-[#f3efe9]">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Área pills: Cocina vs Pastelería */}
      <div className="flex gap-2">
        {AREA_FILTERS.map((area) => (
          <button
            key={area.value}
            onClick={() => {
              setAreaFilter(area.value)
              setCategoryFilter('all')
            }}
            className={`flex-1 rounded-xl border py-2 text-xs font-bold transition-all ${
              areaFilter === area.value
                ? 'border-[#006d5a] bg-[#e8f5f1] text-[#006d5a]'
                : 'border-[#ebe6df] bg-white text-[#a39e97] hover:bg-[#faf8f5]'
            }`}
          >
            {area.label}
          </button>
        ))}
      </div>

      {/* Tipo: ingrediente vs producto terminado */}
      <div className="flex gap-2">
        {([
          { value: 'all', label: 'Todos los tipos' },
          { value: 'ingredient', label: '🥩 Ingredientes' },
          { value: 'product', label: '🥟 Prod. terminados' },
        ] as const).map(opt => (
          <button
            key={opt.value}
            onClick={() => setTypeFilter(opt.value)}
            className={`flex-1 rounded-xl border py-2 text-xs font-bold transition-all ${
              typeFilter === opt.value
                ? 'border-[#3d2c24] bg-[#3d2c24] text-white'
                : 'border-[#ebe6df] bg-white text-[#a39e97] hover:bg-[#faf8f5]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Semaphore pills */}
      <div className="flex gap-2">
        {(['red', 'yellow', 'green'] as const).map((color) => {
          const isActive = semaphoreFilter === color
          const c = COLORS[color]
          const labels: Record<SemaphoreColor, string> = { red: 'Crítico', yellow: 'Atención', green: 'OK' }
          return (
            <button
              key={color}
              onClick={() => setSemaphoreFilter(isActive ? null : color)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition-all ${
                isActive ? `${c.bg} ${c.border}` : 'border-[#ebe6df] bg-white text-[#a39e97] hover:bg-[#faf8f5]'
              }`}
            >
              <span className={`size-2 rounded-full ${c.dot}`} />
              <span className={isActive ? c.text.replace('text-', 'text-') : ''}>{counts[color]}</span>
              <span>{labels[color]}</span>
            </button>
          )
        })}
      </div>

      {/* Category pills */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none">
        <button
          onClick={() => setCategoryFilter('all')}
          className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all ${
            categoryFilter === 'all' ? 'bg-[#3d2c24] text-white' : 'bg-[#f3efe9] text-[#a39e97]'
          }`}
        >
          Todas
        </button>
        {STOCK_CATEGORY_OPTIONS.filter(opt =>
          areaFilter === 'all' || (AREA_CATEGORIES[areaFilter] as readonly string[]).includes(opt.value)
        ).map(opt => (
          <button
            key={opt.value}
            onClick={() => setCategoryFilter(opt.value)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all ${
              categoryFilter === opt.value ? 'bg-[#3d2c24] text-white' : 'bg-[#f3efe9] text-[#a39e97]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Items grouped by category */}
      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="Sin resultados" description="Probá con otra búsqueda o filtro." />
      ) : (
        Array.from(grouped.entries()).map(([cat, catItems]) => {
          const catConfig = STOCK_CATEGORIES[cat as keyof typeof STOCK_CATEGORIES]
          const isCollapsed = collapsedCats.has(cat)
          const catCritical = catItems.filter(i => getSemaphore(i) === 'red').length

          return (
            <section key={cat} className="overflow-hidden rounded-[1.5rem] border border-[#ebe6df] bg-white shadow-sm">
              <button
                onClick={() => toggleCat(cat)}
                className="flex w-full items-center justify-between bg-[#fbfaf8] px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{catConfig?.icon ?? '📦'}</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#3d2c24]">
                    {catConfig?.label ?? cat}
                  </span>
                  <span className="text-[10px] text-[#a39e97]">({catItems.length})</span>
                  {catCritical > 0 && (
                    <span className="rounded-full bg-[#fef2f2] px-1.5 py-0.5 text-[9px] font-bold text-[#ea504c]">
                      {catCritical} ⚠
                    </span>
                  )}
                </div>
                {isCollapsed ? <ChevronDown className="size-4 text-[#a39e97]" /> : <ChevronUp className="size-4 text-[#a39e97]" />}
              </button>

              {!isCollapsed && (
                <div className="space-y-2 p-2">
                  {catItems.map(item => (
                    <div key={item.id} id={`stock-item-${item.id}`}>
                    <StockItemRow
                      item={item}
                      isEncargado={isEncargado}
                      fudoState={fudoConnection.state}
                      profile={profile ? { id: profile.id, first_name: profile.first_name } : null}
                      countOpen={editingId === item.id}
                      wasteOpen={wastingId === item.id}
                      metaOpen={editingMetaId === item.id && editingMetaSource === 'item'}
                      onRequestCount={() => setEditingId(item.id)}
                      onCloseCount={() => setEditingId(null)}
                      onRequestWaste={() => setWastingId(item.id)}
                      onCloseWaste={() => setWastingId(null)}
                      onToggleMeta={() => openMetadataEditor(item.id, 'item')}
                      onUpdated={() => void handleItemUpdated()}
                    />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })
      )}
      </>
      )}
    </div>
  )
}
