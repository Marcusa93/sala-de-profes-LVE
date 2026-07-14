'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isManagerOrAbove } from '@/lib/roles'
import {
  Package,
  Loader2,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  History,
  User,
  Clock,
  AlertTriangle,
  Settings2,
  Save,
  ClipboardCheck,
  ShieldCheck,
  Activity,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  Trash2,
  TrendingDown,
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logAuditClient } from '@/lib/audit'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { useStockItems, type StockItem } from '@/lib/hooks/use-stock'
import { STOCK_CATEGORIES, STOCK_CATEGORY_OPTIONS } from '@/lib/constants'
import type { StockCategoryValue } from '@/types/database'
import { EmptyState } from '@/components/ui/EmptyState'
import { FadeIn } from '@/components/ui/motion'
import {
  type StockIntelligenceResponse,
  type StockPriority,
} from '@/lib/stock/intelligence'
import type {
  StockAnomaliesResponse,
  StockAnomalyItem,
} from '@/lib/contracts/stock-anomalies'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockLog = {
  id: number
  old_qty: number | null
  new_qty: number | null
  created_at: string
  profiles?: { first_name: string; last_name: string } | null
}

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

type SemaphoreColor = 'red' | 'yellow' | 'green'
type FudoConnectionState = 'checking' | 'ok' | 'warning' | 'error'
type StockSourceFilter = 'all' | 'fudo' | 'local' | 'unmapped'
type StockView = 'radar' | 'conteo' | 'inventario'
type WasteReason = 'vencido' | 'roto' | 'consumo_interno' | 'otro'

type ReconciliationRow = {
  stock_item_id: string
  name: string
  unit: string
  expected_closing: number
  actual_closing: number
  variance: number
}

// Áreas operativas: cocina maneja proteínas/verduras/etc; pastelería lo horneado.
const AREA_FILTERS = [
  { value: 'all', label: 'Todo' },
  { value: 'cocina', label: 'Cocina' },
  { value: 'pasteleria', label: 'Pastelería' },
] as const
type AreaFilter = (typeof AREA_FILTERS)[number]['value']
const AREA_CATEGORIES: Record<Exclude<AreaFilter, 'all'>, string[]> = {
  cocina: ['carnes', 'verduras', 'frutas', 'lacteos', 'condimentos', 'elaborados'],
  pasteleria: ['panaderia'],
}
type FudoIncidentSample = {
  id: string
  severity: string
  code: string
  title: string
  entity_type: string | null
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

type StockReviewCard = {
  id: string
  item: StockItem | null
  priority: 'critico' | 'revisar' | 'accion'
  title: string
  detail: string
  primaryAction: 'sync' | 'count' | 'configure' | 'map' | 'watch'
  actionLabel?: string
  actionHref?: string | null
}

function getSemaphore(item: StockItem): SemaphoreColor {
  if (item.current_qty === 0) return 'red'
  if (item.current_qty <= item.min_qty) return 'red'
  if (item.current_qty <= item.min_qty * 1.5) return 'yellow'
  return 'green'
}

const COLORS: Record<SemaphoreColor, { text: string; bg: string; border: string; dot: string }> = {
  red: { text: 'text-[#ea504c]', bg: 'bg-[#fef2f2]', border: 'border-[#ea504c]', dot: 'bg-[#ea504c]' },
  yellow: { text: 'text-[#d4943a]', bg: 'bg-[#fdf6ec]', border: 'border-[#d4943a]', dot: 'bg-[#d4943a]' },
  green: { text: 'text-[#006d5a]', bg: 'bg-[#e8f5f1]', border: 'border-[#006d5a]', dot: 'bg-[#006d5a]' },
}

const PERISHABLE_CATEGORIES = new Set<StockCategoryValue>([
  'bebidas',
  'lacteos',
  'carnes',
  'verduras',
  'frutas',
  'panaderia',
])

const PRIORITY_STYLES: Record<StockPriority, string> = {
  high: 'bg-[#fef2f2] text-[#ea504c]',
  medium: 'bg-[#fdf6ec] text-[#d4943a]',
  low: 'bg-[#f3efe9] text-[#7d6c64]',
}

function isPerishableForUi(item: StockItem) {
  return Boolean(item.fudo_product_id) || PERISHABLE_CATEGORIES.has(item.category)
}

function getStockSource(item: StockItem) {
  if (item.fudo_product_id) {
    return { label: 'Fudo producto', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true, kind: 'fudo' as const }
  }
  if (item.fudo_ingredient_id) {
    return { label: 'Fudo insumo', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true, kind: 'fudo' as const }
  }
  if (item.fudo_skip === true) {
    return { label: 'Local LVE', tone: 'bg-[#f3efe9] text-[#7d6c64]', actionable: true, kind: 'local' as const }
  }
  return { label: 'Sin mapeo Fudo', tone: 'bg-[#fef2f2] text-[#ea504c]', actionable: false, kind: 'unmapped' as const }
}

function formatPriority(priority: StockPriority) {
  if (priority === 'high') return 'Alta'
  if (priority === 'medium') return 'Media'
  return 'Baja'
}

function lotTone(expiresInDays: number) {
  if (expiresInDays < 0) return {
    pill: 'bg-[#fef2f2] text-[#ea504c]',
    panel: 'border-[#ea504c]/20 bg-[#fff7f7]',
  }
  if (expiresInDays <= 2) return {
    pill: 'bg-[#fdf6ec] text-[#d4943a]',
    panel: 'border-[#d4943a]/20 bg-[#fffaf2]',
  }
  return {
    pill: 'bg-[#e8f5f1] text-[#006d5a]',
    panel: 'border-[#dcefe8] bg-[#f7fcfa]',
  }
}

function priorityFromAnomaly(anomaly: StockAnomalyItem): StockReviewCard['priority'] {
  if (anomaly.severity === 'critical') return 'critico'
  if (anomaly.severity === 'high') return 'accion'
  return 'revisar'
}

function formatLotCountdown(expiresInDays: number) {
  if (expiresInDays < 0) return `Vencido hace ${Math.abs(expiresInDays)}d`
  if (expiresInDays === 0) return 'Vence hoy'
  if (expiresInDays === 1) return 'Vence mañana'
  return `Vence en ${expiresInDays}d`
}

function formatQty(qty: number) {
  if (Number.isInteger(qty)) return String(qty)
  return qty.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

function getVariance(item: StockItem, countedQty: number) {
  const diff = countedQty - item.current_qty
  const abs = Math.abs(diff)
  const pct = item.current_qty > 0 ? abs / item.current_qty : abs > 0 ? 1 : 0
  return { diff, abs, pct }
}

function needsVarianceNote(item: StockItem, countedQty: number) {
  const { abs, pct } = getVariance(item, countedQty)
  const unit = item.unit.toLowerCase()
  const threshold = unit.includes('kg') || unit.includes('kilo')
    ? Math.max(0.5, item.current_qty * 0.12)
    : Math.max(2, item.current_qty * 0.15)
  return abs >= threshold || pct >= 0.25
}

function getQuantityReview(item: StockItem): StockReviewCard | null {
  const source = getStockSource(item)

  if (source.kind === 'unmapped') {
    return {
      id: `unmapped:${item.id}`,
      item,
      priority: 'critico',
      title: `${item.name}: falta vínculo Fudo`,
      detail: 'No se puede corregir stock hasta vincularlo a Fudo o marcarlo como Local LVE.',
      primaryAction: 'map',
    }
  }

  if (item.current_qty < 0) {
    return {
      id: `negative:${item.id}`,
      item,
      priority: 'critico',
      title: `${item.name}: stock negativo`,
      detail: `Figura ${formatQty(item.current_qty)} ${item.unit}. Contá físicamente y corregí contra Fudo.`,
      primaryAction: 'count',
    }
  }

  if (getSemaphore(item) === 'red') {
    return {
      id: `low:${item.id}`,
      item,
      priority: 'critico',
      title: `${item.name}: stock crítico`,
      detail: `Hay ${formatQty(item.current_qty)} ${item.unit}; mínimo operativo ${formatQty(item.min_qty)}.`,
      primaryAction: 'count',
    }
  }

  const unit = item.unit.toLowerCase()
  if (item.fudo_ingredient_id && unit.includes('unidad') && !Number.isInteger(item.current_qty)) {
    return {
      id: `unit:${item.id}`,
      item,
      priority: 'revisar',
      title: `${item.name}: unidad sospechosa`,
      detail: `Figura ${formatQty(item.current_qty)} unidad. Si es fiambre/carne/lácteo por peso debería estar en kg.`,
      primaryAction: 'configure',
    }
  }

  const highStockThreshold = Math.max(item.min_qty * 4, isPerishableForUi(item) ? 12 : 80)
  if (item.current_qty >= highStockThreshold && item.current_qty > 0) {
    return {
      id: `high:${item.id}`,
      item,
      priority: isPerishableForUi(item) ? 'accion' : 'revisar',
      title: `${item.name}: cantidad alta`,
      detail: `Hay ${formatQty(item.current_qty)} ${item.unit}. Confirmá si es normal o si hay que accionar.`,
      primaryAction: 'count',
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StockPage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useProfileContext()
  const { items, isLoading: loading, mutate } = useStockItems(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<StockView>('radar')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('all')
  const [semaphoreFilter, setSemaphoreFilter] = useState<SemaphoreColor | null>(null)
  const [sourceFilter, setSourceFilter] = useState<StockSourceFilter>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [countNote, setCountNote] = useState('')
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [historyItemId, setHistoryItemId] = useState<string | null>(null)
  const [historyLogs, setHistoryLogs] = useState<StockLog[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [intelligence, setIntelligence] = useState<StockIntelligenceResponse | null>(null)
  const [loadingIntelligence, setLoadingIntelligence] = useState(false)
  const [anomalies, setAnomalies] = useState<StockAnomaliesResponse | null>(null)
  const [loadingAnomalies, setLoadingAnomalies] = useState(false)
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null)
  const [editingMetaSource, setEditingMetaSource] = useState<'setup' | 'item' | null>(null)
  const [metaShelfLife, setMetaShelfLife] = useState('')
  const [metaCategory, setMetaCategory] = useState<StockCategoryValue | ''>('')
  const [metaNotes, setMetaNotes] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [lotsData, setLotsData] = useState<StockLotsResponse | null>(null)
  const [loadingLots, setLoadingLots] = useState(false)
  const [wastingId, setWastingId] = useState<string | null>(null)
  const [wasteQty, setWasteQty] = useState('')
  const [wasteReason, setWasteReason] = useState<WasteReason | ''>('')
  const [wasteNote, setWasteNote] = useState('')
  const [savingWaste, setSavingWaste] = useState(false)
  const [reconciliationRows, setReconciliationRows] = useState<ReconciliationRow[]>([])
  const [loadingReconciliation, setLoadingReconciliation] = useState(false)

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
    setMetaShelfLife(String(options?.shelfLife ?? item.shelf_life_days ?? ''))
    setMetaCategory(options?.category ?? item.category)
    setMetaNotes(item.notes ?? '')
  }, [editingMetaId, editingMetaSource, items])

  const handleMetadataSave = useCallback(async (itemId: string) => {
    setSavingMeta(true)
    try {
      const shelfLife = metaShelfLife.trim()
      const payload = {
        shelf_life_days: shelfLife ? Number(shelfLife) : null,
        category: metaCategory || undefined,
        notes: metaNotes.trim() || null,
      }

      const res = await fetch(`/api/stock/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la configuración')

      toast.success('Configuración de stock actualizada')
      setEditingMetaId(null)
      setEditingMetaSource(null)
      await Promise.all([mutate(), loadIntelligence(), loadAnomalies(), loadLots()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar configuración')
    } finally {
      setSavingMeta(false)
    }
  }, [loadAnomalies, loadIntelligence, loadLots, metaCategory, metaNotes, metaShelfLife, mutate])

  const handleWasteSave = async (itemId: string) => {
    const qty = parseFloat(wasteQty)
    if (isNaN(qty) || qty <= 0) { toast.error('Cantidad de merma inválida'); return }
    if (!wasteReason) { toast.error('Seleccioná un motivo de merma'); return }
    const currentItem = items.find(i => i.id === itemId)
    if (!currentItem) return
    if (qty > currentItem.current_qty + 0.001) {
      toast.error(`No podés dar de baja más de lo que hay (${formatQty(currentItem.current_qty)} ${currentItem.unit})`)
      return
    }
    setSavingWaste(true)
    try {
      const res = await fetch('/api/stock/waste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId: itemId, qty, wasteReason, note: wasteNote.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar la merma')
      logAuditClient({
        userId: profile?.id ?? null,
        userName: profile?.first_name ?? null,
        action: 'register_waste',
        module: 'stock',
        entityType: 'stock_item',
        entityId: itemId,
        description: `Merma ${formatQty(qty)} ${currentItem.unit} de ${currentItem.name} (${wasteReason})`,
      })
      toast.success(data.fudoSynced ? 'Merma registrada y sincronizada con Fudo ✓' : 'Merma registrada')
      setWastingId(null)
      setWasteQty('')
      setWasteReason('')
      setWasteNote('')
      await Promise.all([mutate(), loadReconciliation()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar merma')
    } finally {
      setSavingWaste(false)
    }
  }

  // Fudo sync on first load
  useEffect(() => {
    let cancelled = false
    async function doSync() {
      setSyncing(true)
      setFudoConnection((current) => ({ ...current, state: 'checking', message: null }))
      try {
        const syncRes = await fetch('/api/stock/sync')
        const syncData = await syncRes.json()
        if (cancelled) return

        if (syncRes.ok && syncData.success && syncData.fudoConnected !== false) {
          const issueCount = Array.isArray(syncData.read?.errors) ? syncData.read.errors.length : 0
          setLastFudoSync(syncData.timestamp)
          setFudoSyncCount(syncData.read?.synced ?? 0)
          setFudoConnection({
            state: 'ok',
            message: issueCount > 0 ? `${issueCount} inconsistencias de mapeo Fudo` : null,
            issueCount,
            pendingEvents: 0,
            failedEvents: 0,
            criticalIncidents: 0,
            highIncidents: 0,
          })
          mutate() // revalidate stock items with fresh Fudo data
          void loadFudoStatus().catch(() => null)
          void loadIntelligence()
          void loadAnomalies()
          void loadLots()
          void loadReconciliation()
        } else {
          setFudoConnection({
            state: 'error',
            message: syncData.error || 'No se pudo sincronizar con Fudo',
            issueCount: 0,
            pendingEvents: 0,
            failedEvents: 0,
            criticalIncidents: 0,
            highIncidents: 0,
          })
          void loadAnomalies()
        }
      } catch (err) {
        if (!cancelled) {
          setFudoConnection({
            state: 'error',
            message: err instanceof Error ? err.message : 'No se pudo sincronizar con Fudo',
            issueCount: 0,
            pendingEvents: 0,
            failedEvents: 0,
            criticalIncidents: 0,
            highIncidents: 0,
          })
          void loadAnomalies()
        }
      }
      if (!cancelled) setSyncing(false)
    }
    doSync()
    return () => { cancelled = true }
  }, [loadAnomalies, loadFudoStatus, loadIntelligence, loadLots, loadReconciliation, mutate])

  useEffect(() => {
    void loadIntelligence()
  }, [loadIntelligence])

  useEffect(() => {
    void loadAnomalies()
  }, [loadAnomalies])

  useEffect(() => {
    void loadLots()
  }, [loadLots])

  useEffect(() => {
    void loadReconciliation()
  }, [loadReconciliation])

  // Load history for an item
  const loadHistory = async (itemId: string) => {
    if (historyItemId === itemId) { setHistoryItemId(null); return }
    setHistoryItemId(itemId)
    setLoadingHistory(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('stock_logs')
      .select('id, old_qty, new_qty, created_at, profiles:user_id(first_name, last_name)')
      .eq('stock_item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(15)
    setHistoryLogs((data as unknown as StockLog[]) ?? [])
    setLoadingHistory(false)
  }

  // Filter
  const filtered = useMemo(() => {
    let result = items
    if (search.trim()) {
      const q = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      result = result.filter(i =>
        i.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)
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
    return result
  }, [items, search, areaFilter, categoryFilter, sourceFilter, semaphoreFilter])

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

    const priorityOrder = { critico: 0, accion: 1, revisar: 2 }
    return cards
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
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
      arr.sort((a, b) => {
        const sa = getSemaphore(a) === 'red' ? 0 : getSemaphore(a) === 'yellow' ? 1 : 2
        const sb = getSemaphore(b) === 'red' ? 0 : getSemaphore(b) === 'yellow' ? 1 : 2
        if (sa !== sb) return sa - sb
        return a.name.localeCompare(b.name)
      })
    }
    return map
  }, [filtered])

  // Update qty — writes to Supabase + Fudo (bidirectional)
  const handleSave = async (itemId: string) => {
    const newQty = parseFloat(editQty)
    if (isNaN(newQty) || newQty < 0) { toast.error('Cantidad inválida'); return }
    const currentItem = items.find(i => i.id === itemId)
    if (!currentItem) { toast.error('Item no encontrado'); return }
    if (Math.abs(newQty - currentItem.current_qty) < 0.001) {
      toast.info('Sin cambios de stock')
      setEditingId(null)
      setEditQty('')
      setCountNote('')
      return
    }
    const note = countNote.trim()
    if (needsVarianceNote(currentItem, newQty) && note.length < 6) {
      toast.error('La diferencia es relevante: agregá una nota corta del conteo')
      return
    }
    const source = getStockSource(currentItem)
    if (source.kind === 'fudo' && (fudoConnection.state === 'checking' || fudoConnection.state === 'error')) {
      toast.error('Stock bloqueado: primero hay que reconectar con Fudo')
      return
    }
    try {
      const res = await fetch('/api/stock/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId: itemId, newQty, reason: 'physical_count', note }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || data.message)

      const updatedItem = items.find(i => i.id === itemId)
      logAuditClient({
        userId: profile?.id ?? null,
        userName: profile?.first_name ?? null,
        action: 'update_stock_qty',
        module: 'stock',
        entityType: 'stock_item',
        entityId: itemId,
        description: `${profile?.first_name ?? 'User'} actualizó stock de ${updatedItem?.name ?? itemId}: ${updatedItem?.current_qty ?? '?'} -> ${newQty} ${updatedItem?.unit ?? 'unidad'}`,
      })

      if (data.fudoSynced) {
        toast.success('Stock actualizado — sincronizado con Fudo ✓')
      } else {
        toast.success('Stock actualizado')
      }
      setEditingId(null)
      setEditQty('')
      setCountNote('')
      await Promise.all([mutate(), loadIntelligence(), loadAnomalies(), loadLots()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }

  const handleFudoSync = async () => {
    setSyncing(true)
    setFudoConnection((current) => ({ ...current, state: 'checking', message: null }))
    try {
      const res = await fetch('/api/stock/sync')
      const json = await res.json()
      if (res.ok && json.success && json.fudoConnected !== false) {
        const issueCount = Array.isArray(json.read?.errors) ? json.read.errors.length : 0
        setLastFudoSync(json.timestamp)
        setFudoSyncCount(json.read?.synced ?? 0)
        setFudoConnection({
          state: 'ok',
          message: issueCount > 0 ? `${issueCount} inconsistencias de mapeo Fudo` : null,
          issueCount,
          pendingEvents: 0,
          failedEvents: 0,
          criticalIncidents: 0,
          highIncidents: 0,
        })
        void loadFudoStatus().catch(() => null)
        toast.success(`Sincronizado con Fudo — ${json.read?.synced ?? 0} items`)
        await Promise.all([mutate(), loadIntelligence(), loadAnomalies(), loadLots()])
      } else {
        const message = json.error || 'Error al sincronizar con Fudo'
        setFudoConnection({
          state: 'error',
          message,
          issueCount: 0,
          pendingEvents: 0,
          failedEvents: 0,
          criticalIncidents: 0,
          highIncidents: 0,
        })
        toast.error(message)
        void loadAnomalies()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error de conexión con Fudo'
      setFudoConnection({
        state: 'error',
        message,
        issueCount: 0,
        pendingEvents: 0,
        failedEvents: 0,
        criticalIncidents: 0,
        highIncidents: 0,
      })
      toast.error(message)
      void loadAnomalies()
    } finally {
      setSyncing(false)
    }
  }

  const toggleCat = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
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
    setEditQty('')
    setCountNote('')
  }

  const renderMetadataEditor = (itemId: string, source: 'setup' | 'item') => {
    if (editingMetaId !== itemId || editingMetaSource !== source) return null

    return (
      <div className="border-t bg-[#faf8f5] px-3 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
              Vida util (dias)
            </span>
            <input
              value={metaShelfLife}
              onChange={(e) => setMetaShelfLife(e.target.value)}
              inputMode="numeric"
              placeholder="Ej. 7"
              className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
              Categoria
            </span>
            <select
              value={metaCategory}
              onChange={(e) => setMetaCategory(e.target.value as StockCategoryValue)}
              className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
            >
              <option value="" disabled>Elegir</option>
              {STOCK_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
            Nota operativa
          </span>
          <textarea
            value={metaNotes}
            onChange={(e) => setMetaNotes(e.target.value)}
            rows={2}
            placeholder="Ej. Sale mejor por porcion o promo en merienda"
            className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none"
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-[#a39e97]">
            Esto alimenta alertas, sugerencias por sector y decisiones de stock.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setEditingMetaId(null)
                setEditingMetaSource(null)
              }}
              className="rounded-lg px-2.5 py-2 text-[11px] font-semibold text-[#7d6c64] hover:bg-[#f3efe9]"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleMetadataSave(itemId)}
              disabled={savingMeta}
              className="flex items-center gap-1 rounded-lg bg-[#3d2c24] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {savingMeta ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Guardar
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderPhysicalCountEditor = (item: StockItem) => {
    if (editingId !== item.id) return null

    const countedQty = parseFloat(editQty)
    const hasCount = !Number.isNaN(countedQty) && countedQty >= 0
    const variance = hasCount ? getVariance(item, countedQty) : null
    const noteRequired = hasCount ? needsVarianceNote(item, countedQty) : false
    const source = getStockSource(item)

    return (
      <div className="border-t border-[#ebe6df] bg-[#fbfaf8] px-3 py-3">
        <div className="flex items-start gap-2 rounded-xl bg-white p-3 ring-1 ring-[#ebe6df]">
          <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-[#006d5a]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#3d2c24]">Conteo físico de {item.name}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#7d6c64]">
              {source.kind === 'fudo'
                ? 'Primero se escribe en Fudo y solo después se actualiza LVE. Si Fudo no confirma, no se guarda.'
                : 'Este item es Local LVE: no toca Fudo. Usalo solo para descartables o controles internos.'}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#ebe6df]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Sistema</p>
            <p className="mt-0.5 text-base font-bold tabular-nums text-[#3d2c24]">
              {formatQty(item.current_qty)}
            </p>
            <p className="text-[10px] text-[#a39e97]">{item.unit}</p>
          </div>

          <label className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#006d5a]/25">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#006d5a]">Conteo real</span>
            <input
              value={editQty}
              onChange={(e) => setEditQty(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="mt-0.5 w-full bg-transparent text-base font-bold tabular-nums text-[#3d2c24] outline-none placeholder:text-[#c8bfb6]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave(item.id)
                if (e.key === 'Escape') {
                  setEditingId(null)
                  setEditQty('')
                  setCountNote('')
                }
              }}
            />
            <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
          </label>

          <div className={`rounded-xl px-3 py-2 ring-1 ${
            !variance || variance.abs < 0.001
              ? 'bg-[#faf8f5] ring-[#ebe6df]'
              : variance.diff < 0
                ? 'bg-[#fff7f7] ring-[#f3d0cf]'
                : 'bg-[#f6fcfa] ring-[#dcefe8]'
          }`}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Diferencia</p>
            <p className={`mt-0.5 text-base font-bold tabular-nums ${
              !variance || variance.abs < 0.001
                ? 'text-[#7d6c64]'
                : variance.diff < 0
                  ? 'text-[#ea504c]'
                  : 'text-[#006d5a]'
            }`}>
              {variance ? `${variance.diff > 0 ? '+' : ''}${formatQty(variance.diff)}` : '-'}
            </p>
            <p className="text-[10px] text-[#a39e97]">{item.unit}</p>
          </div>
        </div>

        <label className="mt-3 block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
            Nota del conteo {noteRequired ? '(obligatoria)' : '(opcional)'}
          </span>
          <textarea
            value={countNote}
            onChange={(e) => setCountNote(e.target.value)}
            rows={2}
            placeholder="Ej. conteo cierre, caja abierta, merma detectada, proveedor entregó..."
            className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none"
          />
        </label>

        {noteRequired && (
          <p className="mt-2 rounded-lg bg-[#fff8eb] px-3 py-2 text-[11px] font-semibold text-[#8b5e34]">
            La diferencia supera el margen normal. Dejamos nota para auditar si fue venta, merma, error de carga o diferencia física.
          </p>
        )}

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={() => {
              setEditingId(null)
              setEditQty('')
              setCountNote('')
            }}
            className="rounded-lg px-3 py-2 text-[11px] font-semibold text-[#7d6c64] hover:bg-[#f3efe9]"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSave(item.id)}
            disabled={!hasCount || (noteRequired && countNote.trim().length < 6)}
            className="rounded-lg bg-[#006d5a] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
          >
            Guardar conteo
          </button>
        </div>
      </div>
    )
  }

  const WASTE_REASON_OPTIONS: { value: WasteReason; label: string }[] = [
    { value: 'vencido', label: 'Venció' },
    { value: 'roto', label: 'Roto / dañado' },
    { value: 'consumo_interno', label: 'Consumo interno' },
    { value: 'otro', label: 'Otro' },
  ]

  const renderWasteEditor = (item: StockItem) => {
    if (wastingId !== item.id) return null
    const source = getStockSource(item)
    return (
      <div className="border-t border-[#ebe6df] bg-[#fffaf4] px-3 py-3">
        <div className="flex items-start gap-2 rounded-xl bg-white p-3 ring-1 ring-[#f1dfba]">
          <Trash2 className="mt-0.5 size-4 shrink-0 text-[#d4943a]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#3d2c24]">Registrar merma de {item.name}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#7d6c64]">
              {source.kind === 'fudo'
                ? 'Se descuenta del sistema y se sincroniza con Fudo.'
                : 'Se descuenta del sistema. Este item es Local LVE.'}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#ebe6df]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Stock actual</p>
            <p className="mt-0.5 text-base font-bold tabular-nums text-[#3d2c24]">{formatQty(item.current_qty)}</p>
            <p className="text-[10px] text-[#a39e97]">{item.unit}</p>
          </div>
          <label className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#f1dfba]">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#d4943a]">Cantidad a dar de baja</span>
            <input
              value={wasteQty}
              onChange={(e) => setWasteQty(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="mt-0.5 w-full bg-transparent text-base font-bold tabular-nums text-[#3d2c24] outline-none placeholder:text-[#c8bfb6]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setWastingId(null)
                  setWasteQty('')
                  setWasteReason('')
                  setWasteNote('')
                }
              }}
            />
            <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
          </label>
        </div>

        <div className="mt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Motivo</span>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {WASTE_REASON_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setWasteReason(value)}
                className={`rounded-xl px-2.5 py-2 text-left text-[11px] font-semibold transition-all ${
                  wasteReason === value
                    ? 'bg-[#3d2c24] text-white'
                    : 'bg-[#faf8f5] text-[#7d6c64] hover:bg-[#f3efe9]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-3 block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Nota (opcional)</span>
          <textarea
            value={wasteNote}
            onChange={(e) => setWasteNote(e.target.value)}
            rows={2}
            placeholder="Ej. encontrado vencido al abrir, se rompió el frasco, degustación..."
            className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none"
          />
        </label>

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={() => {
              setWastingId(null)
              setWasteQty('')
              setWasteReason('')
              setWasteNote('')
            }}
            className="rounded-lg px-3 py-2 text-[11px] font-semibold text-[#7d6c64] hover:bg-[#f3efe9]"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleWasteSave(item.id)}
            disabled={savingWaste || !wasteQty || !wasteReason}
            className="flex items-center gap-1.5 rounded-lg bg-[#d4943a] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
          >
            {savingWaste ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Registrar merma
          </button>
        </div>
      </div>
    )
  }

  const renderReviewCard = (card: StockReviewCard, options?: { featured?: boolean }) => {
    const featured = Boolean(options?.featured)
    const tone = card.priority === 'critico'
      ? 'border-[#f3d0cf] bg-[#fff7f7]'
      : card.priority === 'accion'
        ? 'border-[#f1dfba] bg-[#fffaf2]'
        : 'border-[#ebe6df] bg-white'
    const pill = card.priority === 'critico'
      ? 'bg-[#fef2f2] text-[#ea504c]'
      : card.priority === 'accion'
        ? 'bg-[#fdf6ec] text-[#d4943a]'
        : 'bg-[#f3efe9] text-[#7d6c64]'

    const onPrimaryAction = () => {
      if (card.actionHref) {
        router.push(card.actionHref)
        return
      }
      if (card.primaryAction === 'sync') {
        setView('radar')
        void handleFudoSync()
        return
      }
      if (card.primaryAction === 'count' && card.item) {
        startPhysicalCount(card.item)
        return
      }
      if (card.primaryAction === 'configure' && card.item) {
        openMetadataEditor(card.item.id, 'item')
        return
      }
      if (card.primaryAction === 'map') {
        setSourceFilter('unmapped')
        setView('inventario')
        return
      }
      if (card.primaryAction === 'watch') {
        setView('conteo')
        return
      }
      setView('radar')
    }

    const actionLabel: Record<StockReviewCard['primaryAction'], string> = {
      sync: 'Traer Fudo',
      count: 'Contar',
      configure: 'Configurar',
      map: 'Ver sin mapeo',
      watch: 'Ver detalle',
    }

    const source = card.item ? getStockSource(card.item) : null

    return (
      <div
        key={card.id}
        className={`group overflow-hidden rounded-[1.4rem] border ${featured ? 'p-4 shadow-sm' : 'p-3'} ${tone}`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${pill}`}>
                {card.priority === 'critico' ? 'Crítico' : card.priority === 'accion' ? 'Acción' : 'Revisar'}
              </span>
              {source && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${source.tone}`}>
                  {source.label}
                </span>
              )}
            </div>
            <h3 className={`${featured ? 'mt-3 text-lg' : 'mt-2 text-sm'} font-bold leading-snug text-[#3d2c24]`}>
              {card.title}
            </h3>
            <p className={`${featured ? 'mt-2 text-sm' : 'mt-1 text-[12px]'} leading-relaxed text-[#6f665f]`}>
              {card.detail}
            </p>
            {featured && card.item && (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-black/5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Sistema</p>
                  <p className="mt-0.5 text-base font-bold tabular-nums text-[#3d2c24]">
                    {formatQty(card.item.current_qty)}
                  </p>
                  <p className="text-[10px] text-[#7d6c64]">{card.item.unit}</p>
                </div>
                <div className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-black/5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Mínimo</p>
                  <p className="mt-0.5 text-base font-bold tabular-nums text-[#3d2c24]">
                    {formatQty(card.item.min_qty)}
                  </p>
                  <p className="text-[10px] text-[#7d6c64]">{card.item.unit}</p>
                </div>
                <div className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-black/5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Origen</p>
                  <p className="mt-0.5 truncate text-xs font-bold text-[#3d2c24]">
                    {source?.kind === 'fudo' ? 'Fudo' : source?.kind === 'local' ? 'Local' : 'Sin mapeo'}
                  </p>
                  <p className="text-[10px] text-[#7d6c64]">control</p>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onPrimaryAction}
            className={`${featured ? 'rounded-2xl px-4 py-3 text-sm' : 'rounded-xl px-3 py-2 text-[11px]'} flex w-full shrink-0 items-center justify-center gap-1.5 bg-[#3d2c24] font-bold text-white transition-transform group-active:scale-[0.98] sm:w-auto`}
          >
            {card.actionLabel ?? actionLabel[card.primaryAction]}
            <ArrowRight className={featured ? 'size-4' : 'size-3.5'} />
          </button>
        </div>
      </div>
    )
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
              <h1 className="mt-3 font-display text-2xl tracking-tight text-[#3d2c24] sm:text-3xl">
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
                  onClick={() => void handleFudoSync()}
                  disabled={syncing}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-[#006d5a] px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#005447] disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Traer datos de Fudo
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <button
              onClick={() => { setView('inventario'); setSourceFilter('all'); setSemaphoreFilter(null) }}
              className="rounded-2xl bg-white/80 px-3 py-3 text-left ring-1 ring-[#ebe6df] transition hover:bg-white"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Items activos</p>
              <p className="mt-1 text-2xl font-bold text-[#3d2c24]">{stockOverview.total}</p>
              <p className="text-[11px] text-[#7d6c64]">{stockOverview.fudoLinked} vinculados a Fudo</p>
            </button>
            <button
              onClick={() => { setView('conteo'); setSemaphoreFilter('red') }}
              className="rounded-2xl bg-[#fff7f7] px-3 py-3 text-left ring-1 ring-[#f3d0cf] transition hover:bg-white"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#ea504c]">Críticos</p>
              <p className="mt-1 text-2xl font-bold text-[#3d2c24]">{stockOverview.red}</p>
              <p className="text-[11px] text-[#7d6c64]">requieren conteo o reposición</p>
            </button>
            <button
              onClick={() => { setView('inventario'); setSourceFilter('unmapped') }}
              className="rounded-2xl bg-[#fffaf2] px-3 py-3 text-left ring-1 ring-[#f1dfba] transition hover:bg-white"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#d4943a]">Sin mapeo</p>
              <p className="mt-1 text-2xl font-bold text-[#3d2c24]">{stockOverview.unmapped}</p>
              <p className="text-[11px] text-[#7d6c64]">bloqueados para escritura</p>
            </button>
            <button
              onClick={() => setView('radar')}
              className="rounded-2xl bg-[#f6fcfa] px-3 py-3 text-left ring-1 ring-[#dcefe8] transition hover:bg-white"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#006d5a]">Anomalías</p>
              <p className="mt-1 text-2xl font-bold text-[#3d2c24]">
                {loadingAnomalies ? '…' : anomalies?.summary.total ?? reviewCards.length}
              </p>
              <p className="text-[11px] text-[#7d6c64]">
                {anomalies?.summary.pending_recipe_links
                  ? `${anomalies.summary.pending_recipe_links} vínculos de receta pendientes`
                  : `${fudoSyncCount} leídos de Fudo`}
              </p>
            </button>
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

            return (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                className={`rounded-2xl px-2 py-2.5 text-left transition-all ${
                  view === tab.key
                    ? 'bg-[#3d2c24] text-white shadow-sm'
                    : 'text-[#8d847b] hover:bg-[#faf8f5]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-4" />
                  <span className="text-sm font-bold">{tab.label}</span>
                </span>
                <span className={`mt-0.5 block pl-6 text-[10px] font-semibold uppercase tracking-wide ${
                  view === tab.key ? 'text-white/70' : 'text-[#a39e97]'
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
                  <button
                    onClick={() => { setSemaphoreFilter('red'); setView('conteo') }}
                    className="flex w-full items-center justify-between rounded-2xl bg-[#fff7f7] px-3 py-3 text-left ring-1 ring-[#f3d0cf]"
                  >
                    <span>
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-[#ea504c]">Stock crítico</span>
                      <span className="text-[12px] text-[#7d6c64]">contar o reponer</span>
                    </span>
                    <span className="text-2xl font-bold text-[#3d2c24]">{stockOverview.red}</span>
                  </button>
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
              <p className="mt-0.5 text-[11px]">Las escrituras de stock quedan bloqueadas hasta sincronizar.</p>
            )}
            {fudoConnection.incidentSample.length > 0 && (fudoConnection.state === 'error' || fudoConnection.state === 'warning') && (
              <div className="mt-2 space-y-1">
                {fudoConnection.incidentSample.slice(0, 8).map(inc => (
                  <div key={inc.id} className={`rounded px-2 py-1 text-[10px] leading-snug ${inc.severity === 'critical' ? 'bg-[#fef2f2] text-[#3d2c24]' : 'bg-[#fffaf2] text-[#3d2c24]'}`}>
                    <span className={`font-bold mr-1 ${inc.severity === 'critical' ? 'text-[#ea504c]' : 'text-[#d4943a]'}`}>
                      {inc.severity === 'critical' ? '● CRIT' : '● ALTO'}
                    </span>
                    {inc.title}
                    <span className="ml-1 text-[9px] opacity-50">{inc.code}</span>
                  </div>
                ))}
                {fudoConnection.incidentSample.length > 8 && (
                  <p className="text-[10px] text-[#7d6c64]">…y {fudoConnection.incidentSample.length - 8} incidentes más</p>
                )}
              </div>
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

            {setupIssues.map((issue) => (
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

                {renderMetadataEditor(issue.stock_item_id, 'setup')}
              </div>
            ))}
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
      </div>

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
                  {catItems.map(item => {
                    const s = getSemaphore(item)
                    const c = COLORS[s]
                    const isEditing = editingId === item.id
                    const showHistory = historyItemId === item.id
                    const source = getStockSource(item)

                    return (
                      <div
                        key={item.id}
                        className="overflow-hidden rounded-[1.15rem] border border-[#ebe6df] bg-white transition hover:border-[#d8cfc6] hover:shadow-sm"
                        style={{ borderLeftWidth: 3, borderLeftColor: c.border.replace('border-[', '').replace(']', '') }}
                      >
                        <div className="flex items-center px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-[#3d2c24]">{item.name}</p>
                            {item.suppliers?.name && (
                              <p className="truncate text-[10px] text-[#a39e97]">{item.suppliers.name}</p>
                            )}
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${source.tone}`}>
                                {source.label}
                              </span>
                              {item.shelf_life_days != null ? (
                                <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[9px] font-bold text-[#d4943a]">
                                  Vida util {item.shelf_life_days}d
                                </span>
                              ) : isPerishableForUi(item) ? (
                                <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[9px] font-bold text-[#ea504c]">
                                  Sin vida util
                                </span>
                              ) : null}
                              {item.current_qty < 0 && (
                                <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[9px] font-bold text-[#ea504c]">
                                  {getStockSource(item).kind === 'fudo' ? 'Negativo en Fudo — contar' : 'Negativo — contar'}
                                </span>
                              )}
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="ml-2 flex items-center gap-1">
                              <span className="rounded-lg bg-[#e8f5f1] px-2 py-1 text-[10px] font-bold text-[#006d5a]">
                                Contando
                              </span>
                              <button
                                onClick={() => {
                                  setEditingId(null)
                                  setEditQty('')
                                  setCountNote('')
                                }}
                                className="rounded-lg px-1.5 py-1.5 text-[#a39e97]"
                              >
                                <X className="size-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="ml-2 flex items-center gap-1">
                              <button
                                onClick={() => {
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
                                  setEditingId(item.id)
                                  setEditQty('')
                                  setCountNote('')
                                }}
                                title={source.actionable ? `Editar ${source.label}` : 'Bloqueado: falta mapear a Fudo o marcar Local LVE'}
                                className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 ${isEncargado && source.actionable ? 'cursor-pointer bg-[#faf8f5] hover:bg-[#f3efe9] active:scale-95' : ''} ${((source.kind === 'fudo' && (fudoConnection.state === 'checking' || fudoConnection.state === 'error')) || !source.actionable) ? 'opacity-60' : ''}`}
                              >
                                <span className={`text-base font-bold tabular-nums ${c.text}`}>{formatQty(item.current_qty)}</span>
                                <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
                                <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-[#7d6c64] ring-1 ring-[#ebe6df]">
                                  Contar
                                </span>
                              </button>
                              <button
                                onClick={() => loadHistory(item.id)}
                                className="rounded-lg p-1.5 text-[#a39e97] hover:bg-[#f3efe9]"
                                title="Ver historial"
                              >
                                <History className="size-3.5" />
                              </button>
                              {isEncargado && (
                                <button
                                  onClick={() => {
                                    setEditingId(null)
                                    setEditQty('')
                                    setCountNote('')
                                    if (wastingId === item.id) {
                                      setWastingId(null)
                                    } else {
                                      setWastingId(item.id)
                                      setWasteQty('')
                                      setWasteReason('')
                                      setWasteNote('')
                                    }
                                  }}
                                  className={`rounded-lg p-1.5 ${wastingId === item.id ? 'bg-[#fff7f7] text-[#d4943a]' : 'text-[#a39e97] hover:bg-[#f3efe9]'}`}
                                  title="Registrar merma"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => openMetadataEditor(item.id, 'item')}
                                className={`rounded-lg p-1.5 ${editingMetaId === item.id && editingMetaSource === 'item' ? 'bg-[#f3efe9] text-[#3d2c24]' : 'text-[#a39e97] hover:bg-[#f3efe9]'}`}
                                title="Editar configuración"
                              >
                                <Settings2 className="size-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {renderPhysicalCountEditor(item)}
                        {renderWasteEditor(item)}
                        {renderMetadataEditor(item.id, 'item')}

                        {showHistory && (
                          <div className="border-t bg-[#faf8f5] px-3 py-2.5">
                            {loadingHistory ? (
                              <Loader2 className="size-4 animate-spin text-[#a39e97] mx-auto" />
                            ) : historyLogs.length === 0 ? (
                              <p className="text-[11px] text-[#a39e97] text-center">Sin movimientos registrados</p>
                            ) : (
                              <div className="space-y-1.5">
                                {historyLogs.map(log => (
                                  <div key={log.id} className="flex items-center justify-between text-[11px]">
                                    <div className="flex items-center gap-1.5">
                                      <User className="size-2.5 text-[#a39e97]" />
                                      <span className="font-medium text-[#3d2c24]">
                                        {log.profiles?.first_name ?? '?'}
                                      </span>
                                      <span className="text-[#a39e97]">
                                        {log.old_qty} → {log.new_qty}
                                      </span>
                                    </div>
                                    <span className="flex items-center gap-1 text-[#a39e97]">
                                      <Clock className="size-2.5" />
                                      {format(new Date(log.created_at), 'd MMM HH:mm', { locale: es })}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
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
