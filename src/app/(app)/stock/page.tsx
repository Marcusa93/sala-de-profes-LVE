'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
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
  CheckCircle2,
  Bell,
  Truck,
  CalendarClock,
  ClipboardList,
  ShieldCheck,
  SlidersHorizontal,
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
  type StockSetupIssue,
} from '@/lib/stock/intelligence'

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
type FudoConnectionState = 'checking' | 'ok' | 'error'
type MatrixFilter = 'reorder' | 'overstock' | 'no_supplier' | 'missing_notice' | null
type MatrixStateKind = 'reorder' | 'watch' | 'ok' | 'overstock'
type StockViewMode = 'work' | 'audit'

type SupplierOption = {
  id: number
  name: string
  contact_name: string | null
  phone: string | null
}

type StockMatrixState = {
  kind: MatrixStateKind
  label: string
  detail: string
  pill: string
  panel: string
  borderHex: string
}

type MatrixRow = {
  item: StockItem
  state: StockMatrixState
  noSupplier: boolean
  missingNotice: boolean
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

const ANOMALY_ISSUE_TYPES = new Set<StockSetupIssue['type']>([
  'unit_review',
  'quantity_anomaly',
  'negative_stock',
  'stale_stock',
  'missing_lot_control',
  'expired_lot_stock',
  'mapping_conflict',
  'missing_fudo_mapping',
  'sales_stock_mismatch',
])

function isPerishableForUi(item: StockItem) {
  return Boolean(item.fudo_product_id) || PERISHABLE_CATEGORIES.has(item.category)
}

function getStockSource(item: StockItem) {
  if (item.fudo_product_id) {
    return { label: 'Fudo producto', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true }
  }
  if (item.fudo_ingredient_id) {
    return { label: 'Fudo insumo', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true }
  }
  if (item.category === 'desechables' && item.fudo_skip === true) {
    return { label: 'Descartable LVE', tone: 'bg-[#f3efe9] text-[#7d6c64]', actionable: true }
  }
  if (item.fudo_skip === true) {
    return { label: 'Local LVE', tone: 'bg-[#f3efe9] text-[#7d6c64]', actionable: true }
  }
  return { label: 'Sin mapeo Fudo', tone: 'bg-[#fef2f2] text-[#ea504c]', actionable: false }
}

function formatPriority(priority: StockPriority) {
  if (priority === 'high') return 'Alta'
  if (priority === 'medium') return 'Media'
  return 'Baja'
}

function isAnomalyIssue(issue: StockSetupIssue) {
  return ANOMALY_ISSUE_TYPES.has(issue.type)
}

function formatIssueType(issue: StockSetupIssue) {
  if (isAnomalyIssue(issue)) return 'Anomalía'
  if (issue.type === 'missing_shelf_life') return 'Vida útil'
  if (issue.type === 'category_review') return 'Categoría'
  if (issue.type === 'missing_menu_mapping') return 'Carta'
  return 'Config'
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

function formatLotCountdown(expiresInDays: number) {
  if (expiresInDays < 0) return `Vencido hace ${Math.abs(expiresInDays)}d`
  if (expiresInDays === 0) return 'Vence hoy'
  if (expiresInDays === 1) return 'Vence mañana'
  return `Vence en ${expiresInDays}d`
}

function formatQty(value: number) {
  return new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 2,
  }).format(value)
}

function defaultRuleRange(qty: number) {
  const safeQty = Number.isFinite(qty) ? Math.max(qty, 0) : 0
  return {
    min: String(Math.max(0, Math.floor(safeQty * 0.5))),
    max: String(Math.ceil(safeQty * 1.5)),
  }
}

function normalizeDecimalInput(value: string) {
  return value.trim().replace(',', '.')
}

function getOverstockLimit(item: StockItem) {
  if (!Number.isFinite(item.min_qty) || item.min_qty <= 0) return null
  const categoryFactor: Partial<Record<StockCategoryValue, number>> = {
    desechables: 6,
    bebidas: 4,
    frutas: 3,
    verduras: 3,
    panaderia: 2.5,
    lacteos: 2.5,
    carnes: 2,
  }
  const factor = categoryFactor[item.category] ?? 4
  return Math.max(item.min_qty * factor, item.min_qty + 10)
}

function getMatrixState(item: StockItem): StockMatrixState {
  const overstockLimit = getOverstockLimit(item)

  if (item.current_qty <= 0 || item.current_qty <= item.min_qty) {
    return {
      kind: 'reorder',
      label: item.current_qty <= 0 ? 'Sin stock' : 'Pedir',
      detail: `Mínimo ${formatQty(item.min_qty)} ${item.unit}`,
      pill: 'bg-[#fef2f2] text-[#ea504c]',
      panel: 'border-[#f3d0cf] bg-[#fff7f7]',
      borderHex: '#ea504c',
    }
  }

  if (item.current_qty <= item.min_qty * 1.5) {
    return {
      kind: 'watch',
      label: 'Bajo',
      detail: `Cerca del mínimo ${formatQty(item.min_qty)} ${item.unit}`,
      pill: 'bg-[#fff1d6] text-[#b7791f]',
      panel: 'border-[#f1dfba] bg-[#fffaf2]',
      borderHex: '#d4943a',
    }
  }

  if (overstockLimit != null && item.current_qty >= overstockLimit) {
    return {
      kind: 'overstock',
      label: 'Mucho',
      detail: `Controlar: supera ${formatQty(overstockLimit)} ${item.unit}`,
      pill: 'bg-[#fdf6ec] text-[#d4943a]',
      panel: 'border-[#f1dfba] bg-[#fffaf2]',
      borderHex: '#d4943a',
    }
  }

  return {
    kind: 'ok',
    label: 'OK',
    detail: `Mínimo ${formatQty(item.min_qty)} ${item.unit}`,
    pill: 'bg-[#e8f5f1] text-[#006d5a]',
    panel: 'border-[#dcefe8] bg-[#f7fcfa]',
    borderHex: '#006d5a',
  }
}

function requiresSupplier(item: StockItem, state = getMatrixState(item)) {
  return !item.supplier_id && (
    state.kind === 'reorder'
    || state.kind === 'watch'
    || state.kind === 'overstock'
    || item.min_qty > 0
  )
}

function requiresPurchaseNotice(item: StockItem) {
  return item.min_qty > 0 && item.purchase_lead_time_days == null
}

function getPurchaseNoticeLabel(item: StockItem) {
  if (item.purchase_lead_time_days == null) return 'Sin aviso'
  if (item.purchase_lead_time_days === 0) return 'Pedir en el día'
  if (item.purchase_lead_time_days === 1) return 'Avisar 1 día antes'
  return `Avisar ${item.purchase_lead_time_days} días antes`
}

function matrixFilterLabel(filter: MatrixFilter) {
  if (filter === 'reorder') return 'Pedir hoy'
  if (filter === 'overstock') return 'Mucho stock'
  if (filter === 'no_supplier') return 'Sin proveedor'
  if (filter === 'missing_notice') return 'Sin aviso de pedido'
  return null
}

function getWorkAction(row: MatrixRow) {
  if (row.state.kind === 'reorder') {
    return {
      label: row.noSupplier ? 'Asignar proveedor' : 'Preparar pedido',
      detail: row.noSupplier
        ? 'Primero falta saber a quién pedirle.'
        : `Stock en zona de pedido: ${formatQty(row.item.current_qty)} ${row.item.unit}.`,
    }
  }

  if (row.state.kind === 'overstock') {
    return {
      label: 'Controlar exceso',
      detail: 'Validar si es compra normal, error de unidad o exceso real.',
    }
  }

  if (row.noSupplier) {
    return {
      label: 'Vincular proveedor',
      detail: 'Sin proveedor no se puede armar un pedido confiable.',
    }
  }

  if (row.missingNotice) {
    return {
      label: 'Definir aviso',
      detail: 'Configurar cuántos días antes hay que pedir.',
    }
  }

  return {
    label: 'Revisar',
    detail: row.state.detail,
  }
}

function fudoStatusCopy(state: FudoConnectionState) {
  if (state === 'ok') return 'Fudo conectado'
  if (state === 'checking') return 'Verificando Fudo'
  return 'Fudo bloqueado'
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StockPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const { items, isLoading: loading, mutate } = useStockItems(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [semaphoreFilter, setSemaphoreFilter] = useState<SemaphoreColor | null>(null)
  const [matrixFilter, setMatrixFilter] = useState<MatrixFilter>(null)
  const [viewMode, setViewMode] = useState<StockViewMode>('work')
  const [showAnomaliesOnly, setShowAnomaliesOnly] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [historyItemId, setHistoryItemId] = useState<string | null>(null)
  const [historyLogs, setHistoryLogs] = useState<StockLog[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [intelligence, setIntelligence] = useState<StockIntelligenceResponse | null>(null)
  const [loadingIntelligence, setLoadingIntelligence] = useState(false)
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null)
  const [editingMetaSource, setEditingMetaSource] = useState<'setup' | 'item' | 'matrix' | null>(null)
  const [metaShelfLife, setMetaShelfLife] = useState('')
  const [metaCategory, setMetaCategory] = useState<StockCategoryValue | ''>('')
  const [metaMinQty, setMetaMinQty] = useState('')
  const [metaSupplierId, setMetaSupplierId] = useState('')
  const [metaLeadDays, setMetaLeadDays] = useState('')
  const [metaNotes, setMetaNotes] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [loadingSuppliers, setLoadingSuppliers] = useState(false)
  const [lotsData, setLotsData] = useState<StockLotsResponse | null>(null)
  const [loadingLots, setLoadingLots] = useState(false)
  const [showAllAnomalies, setShowAllAnomalies] = useState(false)
  const [decidingIssueId, setDecidingIssueId] = useState<string | null>(null)
  const [ruleEditorIssueId, setRuleEditorIssueId] = useState<string | null>(null)
  const [ruleMinQty, setRuleMinQty] = useState('')
  const [ruleMaxQty, setRuleMaxQty] = useState('')
  const [ruleNotify, setRuleNotify] = useState(true)
  const [ruleNote, setRuleNote] = useState('')

  const isEncargado = isManagerOrAbove(profile?.role)
  const [lastFudoSync, setLastFudoSync] = useState<string | null>(null)
  const [fudoSyncCount, setFudoSyncCount] = useState(0)
  const [fudoConnection, setFudoConnection] = useState<{
    state: FudoConnectionState
    message: string | null
    issueCount: number
  }>({ state: 'checking', message: null, issueCount: 0 })

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

  const loadSuppliers = useCallback(async () => {
    setLoadingSuppliers(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name, contact_name, phone')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      setSuppliers((data ?? []) as SupplierOption[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar proveedores')
    } finally {
      setLoadingSuppliers(false)
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

  const openMetadataEditor = useCallback((itemId: string, source: 'setup' | 'item' | 'matrix', options?: {
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
    setMetaMinQty(String(item.min_qty ?? 0))
    setMetaSupplierId(item.supplier_id ? String(item.supplier_id) : '')
    setMetaLeadDays(item.purchase_lead_time_days == null ? '' : String(item.purchase_lead_time_days))
    setMetaNotes(item.notes ?? '')
  }, [editingMetaId, editingMetaSource, items])

  const handleMetadataSave = useCallback(async (itemId: string) => {
    setSavingMeta(true)
    try {
      const shelfLife = metaShelfLife.trim()
      const minQty = normalizeDecimalInput(metaMinQty)
      const leadDays = metaLeadDays.trim()
      const payload = {
        shelf_life_days: shelfLife ? Number(shelfLife) : null,
        category: metaCategory || undefined,
        min_qty: minQty ? Number(minQty) : 0,
        supplier_id: metaSupplierId ? Number(metaSupplierId) : null,
        purchase_lead_time_days: leadDays ? Number(leadDays) : null,
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
      await Promise.all([mutate(), loadIntelligence(), loadLots()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar configuración')
    } finally {
      setSavingMeta(false)
    }
  }, [loadIntelligence, loadLots, metaCategory, metaLeadDays, metaMinQty, metaNotes, metaShelfLife, metaSupplierId, mutate])

  const focusItemForStockEdit = useCallback((issue: StockSetupIssue) => {
    const item = items.find((entry) => String(entry.id) === String(issue.stock_item_id))
    if (!item) return

    setSearch(item.name)
    setCategoryFilter('all')
    setSemaphoreFilter(null)
    setMatrixFilter(null)
    setShowAnomaliesOnly(false)
    setEditingId(String(item.id))
    setEditQty(String(item.current_qty))
  }, [items])

  const openRuleEditor = useCallback((issue: StockSetupIssue) => {
    const range = defaultRuleRange(issue.current_qty)
    setRuleEditorIssueId(issue.id)
    setRuleMinQty(range.min)
    setRuleMaxQty(range.max)
    setRuleNotify(true)
    setRuleNote('')
  }, [])

  const handleAnomalyDecision = useCallback(async (
    issue: StockSetupIssue,
    action: 'confirm_ok' | 'snooze_30d' | 'create_rule',
  ) => {
    setDecidingIssueId(issue.id)
    try {
      const payload: Record<string, unknown> = {
        action,
        issue,
      }

      if (action === 'create_rule') {
        payload.min_qty = ruleMinQty.trim() ? Number(ruleMinQty) : null
        payload.max_qty = ruleMaxQty.trim() ? Number(ruleMaxQty) : null
        payload.notify_enabled = ruleNotify
        payload.note = ruleNote.trim() || null
      }

      const res = await fetch('/api/stock/anomalies/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la decisión')

      if (action === 'confirm_ok') toast.success('Anomalía confirmada como válida')
      if (action === 'snooze_30d') toast.success('Anomalía silenciada por 30 días')
      if (action === 'create_rule') {
        toast.success('Regla creada para futuras alertas')
        setRuleEditorIssueId(null)
      }

      await loadIntelligence()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar decisión')
    } finally {
      setDecidingIssueId(null)
    }
  }, [loadIntelligence, ruleMaxQty, ruleMinQty, ruleNote, ruleNotify])

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
          })
          mutate() // revalidate stock items with fresh Fudo data
          void loadIntelligence()
          void loadLots()
        } else {
          setFudoConnection({
            state: 'error',
            message: syncData.error || 'No se pudo sincronizar con Fudo',
            issueCount: 0,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setFudoConnection({
            state: 'error',
            message: err instanceof Error ? err.message : 'No se pudo sincronizar con Fudo',
            issueCount: 0,
          })
        }
      }
      if (!cancelled) setSyncing(false)
    }
    doSync()
    return () => { cancelled = true }
  }, [loadIntelligence, loadLots, mutate])

  useEffect(() => {
    void loadIntelligence()
  }, [loadIntelligence])

  useEffect(() => {
    void loadLots()
  }, [loadLots])

  useEffect(() => {
    void loadSuppliers()
  }, [loadSuppliers])

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

  const anomalyIssues = useMemo(
    () => (intelligence?.setup_issues ?? []).filter(isAnomalyIssue),
    [intelligence],
  )

  const anomalyItemIds = useMemo(
    () => new Set(anomalyIssues.map((issue) => issue.stock_item_id)),
    [anomalyIssues],
  )

  const anomalyCountByItemId = useMemo(() => {
    const countsByItem = new Map<string, number>()
    for (const issue of anomalyIssues) {
      countsByItem.set(issue.stock_item_id, (countsByItem.get(issue.stock_item_id) ?? 0) + 1)
    }
    return countsByItem
  }, [anomalyIssues])

  const matrixRows = useMemo<MatrixRow[]>(() => items.map((item) => {
    const state = getMatrixState(item)
    return {
      item,
      state,
      noSupplier: requiresSupplier(item, state),
      missingNotice: requiresPurchaseNotice(item),
    }
  }), [items])

  const stockMatrix = useMemo(() => {
    const reorder = matrixRows.filter((row) => row.state.kind === 'reorder')
    const watch = matrixRows.filter((row) => row.state.kind === 'watch')
    const overstock = matrixRows.filter((row) => row.state.kind === 'overstock')
    const noSupplier = matrixRows.filter((row) => row.noSupplier)
    const missingNotice = matrixRows.filter((row) => row.missingNotice)
    const priorityById = new Map<string, (typeof matrixRows)[number]>()

    for (const row of [...reorder, ...watch, ...overstock, ...noSupplier, ...missingNotice]) {
      priorityById.set(String(row.item.id), row)
    }

    const severityOrder: Record<MatrixStateKind, number> = {
      reorder: 0,
      watch: 1,
      overstock: 2,
      ok: 3,
    }

    const priority = Array.from(priorityById.values()).sort((a, b) => {
      const bySeverity = severityOrder[a.state.kind] - severityOrder[b.state.kind]
      if (bySeverity !== 0) return bySeverity
      if (a.noSupplier !== b.noSupplier) return a.noSupplier ? -1 : 1
      if (a.missingNotice !== b.missingNotice) return a.missingNotice ? -1 : 1
      return a.item.name.localeCompare(b.item.name)
    })

    return {
      reorder,
      watch,
      overstock,
      noSupplier,
      missingNotice,
      priority,
    }
  }, [matrixRows])

  const primaryWork = stockMatrix.priority[0] ?? null

  // Filter
  const filtered = useMemo(() => {
    let result = items
    if (search.trim()) {
      const q = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      result = result.filter((item) => {
        const state = getMatrixState(item)
        const categoryLabel = STOCK_CATEGORIES[item.category]?.label ?? item.category
        const haystack = [
          item.name,
          item.suppliers?.name,
          categoryLabel,
          item.unit,
          state.label,
          getPurchaseNoticeLabel(item),
          getStockSource(item).label,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')

        return haystack.includes(q)
      })
    }
    if (categoryFilter !== 'all') {
      result = result.filter(i => i.category === categoryFilter)
    }
    if (semaphoreFilter) {
      result = result.filter(i => getSemaphore(i) === semaphoreFilter)
    }
    if (showAnomaliesOnly) {
      result = result.filter(i => anomalyItemIds.has(String(i.id)))
    }
    if (matrixFilter) {
      result = result.filter((item) => {
        const state = getMatrixState(item)
        if (matrixFilter === 'reorder') return state.kind === 'reorder'
        if (matrixFilter === 'overstock') return state.kind === 'overstock'
        if (matrixFilter === 'no_supplier') return requiresSupplier(item, state)
        if (matrixFilter === 'missing_notice') return requiresPurchaseNotice(item)
        return true
      })
    }
    return result
  }, [anomalyItemIds, items, search, categoryFilter, semaphoreFilter, showAnomaliesOnly, matrixFilter])

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

  const configurationIssues = useMemo(
    () => (intelligence?.setup_issues ?? []).filter((issue) => !isAnomalyIssue(issue)),
    [intelligence],
  )
  const visibleAnomalyIssues = showAllAnomalies ? anomalyIssues : anomalyIssues.slice(0, 6)
  const setupIssues = configurationIssues.slice(0, 4)

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
    if (fudoConnection.state !== 'ok') {
      toast.error('Stock bloqueado: primero hay que reconectar con Fudo')
      return
    }
    try {
      const res = await fetch('/api/stock/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId: itemId, newQty }),
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
      await Promise.all([mutate(), loadIntelligence(), loadLots()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
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

  const renderMetadataEditor = (itemId: string, source: 'setup' | 'item' | 'matrix') => {
    if (editingMetaId !== itemId || editingMetaSource !== source) return null
    const item = items.find((entry) => entry.id === itemId)
    if (!item) return null
    const matrixState = getMatrixState(item)

    return (
      <div className="border-t bg-[#faf8f5] px-3 py-3 space-y-3">
        <div className={`rounded-lg border px-3 py-2 ${matrixState.panel}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-[#3d2c24]">Control operativo</p>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${matrixState.pill}`}>
              {matrixState.label}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-[#7d6c64]">
            {matrixState.detail} · {getPurchaseNoticeLabel(item)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
              Mínimo operativo
            </span>
            <input
              value={metaMinQty}
              onChange={(e) => setMetaMinQty(e.target.value)}
              inputMode="decimal"
              placeholder="Ej. 8"
              className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
              Avisar pedido
            </span>
            <input
              value={metaLeadDays}
              onChange={(e) => setMetaLeadDays(e.target.value)}
              inputMode="numeric"
              placeholder="Días"
              className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
            />
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
            Proveedor
          </span>
          <select
            value={metaSupplierId}
            onChange={(e) => setMetaSupplierId(e.target.value)}
            disabled={loadingSuppliers}
            className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none disabled:opacity-60"
          >
            <option value="">{loadingSuppliers ? 'Cargando proveedores...' : 'Sin proveedor asignado'}</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>

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
            Esto alimenta matriz, alertas y sugerencias. La cantidad sigue escribiendo en Fudo si el item está vinculado.
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
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      {viewMode === 'audit' && (
      <FadeIn>
        <div className="overflow-hidden rounded-[1.75rem] border border-[#e7ded3] bg-[#3d2c24] text-white shadow-sm">
          <div className="bg-[radial-gradient(circle_at_top_right,#0f8a72_0%,transparent_32%),linear-gradient(135deg,#3d2c24_0%,#604637_100%)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/55">Mercadería</p>
                <h1 className="mt-1 font-display text-2xl tracking-tight">Trabajo de stock</h1>
                <p className="mt-1 text-[12px] leading-snug text-white/72">
                  Resolver pedidos, excesos, proveedores y avisos sin perder control Fudo.
                </p>
              </div>
              {isEncargado && (
                <button
                  onClick={async () => {
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
                        })
                        toast.success(`Sincronizado con Fudo · ${json.read?.synced ?? 0} items`)
                        await Promise.all([mutate(), loadIntelligence(), loadLots()])
                      } else {
                        const message = json.error || 'Error al sincronizar con Fudo'
                        setFudoConnection({ state: 'error', message, issueCount: 0 })
                        toast.error(message)
                      }
                    } catch (err) {
                      const message = err instanceof Error ? err.message : 'Error de conexión con Fudo'
                      setFudoConnection({ state: 'error', message, issueCount: 0 })
                      toast.error(message)
                    }
                    setSyncing(false)
                  }}
                  disabled={syncing}
                  className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-white/12 px-3 py-2 text-[11px] font-bold text-white backdrop-blur transition-colors hover:bg-white/18 disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Fudo
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2">
              <div>
                <p className="text-[11px] font-bold">{fudoStatusCopy(fudoConnection.state)}</p>
                <p className="mt-0.5 text-[10px] text-white/62">
                  {lastFudoSync
                    ? `${format(new Date(lastFudoSync), 'HH:mm')} · ${fudoSyncCount} items`
                    : `${stockOverview.fudoLinked} vinculados a Fudo`}
                </p>
              </div>
              <span className={`size-2.5 rounded-full ${
                fudoConnection.state === 'ok'
                  ? 'bg-[#71d0b9]'
                  : fudoConnection.state === 'checking'
                    ? 'bg-[#f0c36b]'
                    : 'bg-[#ff8b86]'
              }`} />
            </div>
          </div>
        </div>
      </FadeIn>
      )}

      <FadeIn>
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#ebe6df] bg-white p-1">
          <button
            onClick={() => setViewMode('work')}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-bold transition-all ${
              viewMode === 'work' ? 'bg-[#006d5a] text-white shadow-sm' : 'text-[#7d6c64] hover:bg-[#faf8f5]'
            }`}
          >
            <ClipboardList className="size-4" />
            Trabajo
          </button>
          <button
            onClick={() => setViewMode('audit')}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-bold transition-all ${
              viewMode === 'audit' ? 'bg-[#3d2c24] text-white shadow-sm' : 'text-[#7d6c64] hover:bg-[#faf8f5]'
            }`}
          >
            <ShieldCheck className="size-4" />
            Auditoría
          </button>
        </div>
      </FadeIn>

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
              : fudoConnection.state === 'checking'
                ? 'border-[#ebe6df] bg-[#faf8f5] text-[#7d6c64]'
                : 'border-[#f3d0cf] bg-[#fff7f7] text-[#ea504c]'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">
                {fudoConnection.state === 'ok'
                  ? 'Fudo conectado'
                  : fudoConnection.state === 'checking'
                    ? 'Verificando Fudo'
                    : 'Fudo sin conexión'}
              </span>
              {syncing && <Loader2 className="size-3.5 animate-spin" />}
            </div>
            {fudoConnection.message && (
              <p className="mt-0.5 text-[11px]">{fudoConnection.message}</p>
            )}
            {fudoConnection.state === 'error' && (
              <p className="mt-0.5 text-[11px]">Las escrituras de stock quedan bloqueadas hasta sincronizar.</p>
            )}
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

            <button
              onClick={() => setShowAnomaliesOnly((current) => !current)}
              className={`rounded-lg border px-3 py-2 text-left ${
                showAnomaliesOnly
                  ? 'border-[#ea504c] bg-[#fff7f7]'
                  : 'border-[#f3d0cf] bg-[#fff7f7]'
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#ea504c]">Anomalías</p>
              <p className="mt-0.5 text-xl font-bold text-[#3d2c24]">
                {intelligence?.summary.anomalies ?? anomalyIssues.length}
              </p>
            </button>

            <div className="rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7d6c64]">Vencen</p>
              <p className="mt-0.5 text-xl font-bold text-[#3d2c24]">{expiringLotsCount}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[#7d6c64]">
            <span>{stockOverview.total} activos</span>
            <span>{stockOverview.fudoLinked} vinculados a Fudo</span>
            <span>{stockOverview.localOnly} descartables LVE</span>
            {stockOverview.unmapped > 0 && (
              <span className="text-[#ea504c]">{stockOverview.unmapped} sin mapeo</span>
            )}
            {lastFudoSync && <span>Fudo {format(new Date(lastFudoSync), 'HH:mm')}</span>}
            <span>
              {intelligence?.summary.perishable_missing_shelf_life ?? stockOverview.missingShelfLife} sin vida útil
            </span>
          </div>
          {stockOverview.unmapped > 0 && (
            <p className="mt-2 rounded-lg bg-[#fff7f7] px-3 py-2 text-[11px] font-semibold text-[#ea504c]">
              Los items sin mapeo quedan bloqueados para escritura: vinculalos a Fudo o marcalos como Local LVE.
            </p>
          )}
        </div>
      </FadeIn>

      <FadeIn>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[1.6rem] border border-[#ebe6df] bg-white shadow-sm">
            <div className="border-b border-[#f0ebe4] bg-[#fffdf9] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold tracking-tight text-[#3d2c24]">
                    {viewMode === 'work' ? 'Trabajo de hoy' : 'Matriz de control'}
                  </h2>
                  <p className="mt-0.5 text-[11px] leading-snug text-[#7d6c64]">
                    Primero se resuelve lo que impacta operación: pedir, controlar exceso, proveedor y aviso.
                  </p>
                </div>
                <span className="rounded-full bg-[#f3efe9] px-2 py-0.5 text-[10px] font-bold text-[#7d6c64]">
                  {stockMatrix.priority.length} revisar
                </span>
              </div>
            </div>

            {primaryWork ? (() => {
              const action = getWorkAction(primaryWork)

              return (
                <div className={`m-3 rounded-[1.25rem] border p-3 ${primaryWork.state.panel}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7d6c64]">
                        Acción principal
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-bold text-[#3d2c24]">{primaryWork.item.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${primaryWork.state.pill}`}>
                          {primaryWork.state.label}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] font-semibold text-[#3d2c24]">{action.label}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-[#7d6c64]">{action.detail}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-bold">
                        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[#3d2c24]">
                          {formatQty(primaryWork.item.current_qty)} {primaryWork.item.unit} · min {formatQty(primaryWork.item.min_qty)}
                        </span>
                        <span className={primaryWork.noSupplier ? 'rounded-full bg-[#fef2f2] px-2 py-0.5 text-[#ea504c]' : 'rounded-full bg-white/70 px-2 py-0.5 text-[#006d5a]'}>
                          {primaryWork.item.suppliers?.name ?? 'Sin proveedor'}
                        </span>
                        <span className={primaryWork.missingNotice ? 'rounded-full bg-[#fff1d6] px-2 py-0.5 text-[#b7791f]' : 'rounded-full bg-white/70 px-2 py-0.5 text-[#006d5a]'}>
                          {getPurchaseNoticeLabel(primaryWork.item)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => openMetadataEditor(primaryWork.item.id, 'matrix')}
                      className="shrink-0 rounded-xl bg-[#3d2c24] px-3 py-2 text-[11px] font-bold text-white"
                    >
                      Resolver
                    </button>
                  </div>
                  {renderMetadataEditor(primaryWork.item.id, 'matrix')}
                </div>
              )
            })() : (
              <div className="m-3 rounded-[1.25rem] border border-[#dcefe8] bg-[#f7fcfa] px-3 py-3">
                <p className="text-sm font-bold text-[#006d5a]">Sin acciones urgentes.</p>
                <p className="mt-0.5 text-[11px] text-[#7d6c64]">Podés usar la búsqueda para revisar un producto puntual.</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {([
              { filter: 'reorder' as const, label: 'Pedir hoy', count: stockMatrix.reorder.length, hint: 'Bajo mínimo', tone: 'border-[#f3d0cf] bg-[#fff7f7] text-[#ea504c]' },
              { filter: 'overstock' as const, label: 'Mucho stock', count: stockMatrix.overstock.length, hint: 'Control humano', tone: 'border-[#f1dfba] bg-[#fffaf2] text-[#d4943a]' },
              { filter: 'no_supplier' as const, label: 'Sin proveedor', count: stockMatrix.noSupplier.length, hint: 'Falta vínculo', tone: 'border-[#ebe6df] bg-white text-[#7d6c64]' },
              { filter: 'missing_notice' as const, label: 'Sin aviso', count: stockMatrix.missingNotice.length, hint: 'Falta plazo', tone: 'border-[#ebe6df] bg-white text-[#7d6c64]' },
            ]).map((card) => {
              const active = matrixFilter === card.filter
              return (
                <button
                  key={card.filter}
                  onClick={() => setMatrixFilter(active ? null : card.filter)}
                  className={`rounded-2xl border px-3 py-3 text-left shadow-sm transition-all ${card.tone} ${
                    active ? 'ring-2 ring-[#3d2c24]/15' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider">{card.label}</p>
                    {active && <SlidersHorizontal className="size-3.5" />}
                  </div>
                  <p className="mt-1 text-2xl font-bold text-[#3d2c24]">{card.count}</p>
                  <p className="mt-0.5 text-[10px] font-semibold opacity-75">{card.hint}</p>
                </button>
              )
            })}
          </div>

          {stockMatrix.priority.length > 1 && (
            <div className="rounded-[1.4rem] border border-[#ebe6df] bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7d6c64]">Siguientes controles</p>
                <span className="text-[10px] font-semibold text-[#a39e97]">Top {Math.min(stockMatrix.priority.length - 1, 4)}</span>
              </div>
              <div className="space-y-1.5">
                {stockMatrix.priority.slice(1, 5).map((row) => {
                  const action = getWorkAction(row)

                  return (
                    <div key={row.item.id} className={`rounded-xl border px-3 py-2 ${row.state.panel}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-sm font-semibold text-[#3d2c24]">{row.item.name}</p>
                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${row.state.pill}`}>
                              {row.state.label}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-[#7d6c64]">
                            {action.label} · {formatQty(row.item.current_qty)} {row.item.unit}
                          </p>
                        </div>
                        <button
                          onClick={() => openMetadataEditor(row.item.id, 'matrix')}
                          className="shrink-0 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-bold text-[#3d2c24]"
                        >
                          Resolver
                        </button>
                      </div>
                      {renderMetadataEditor(row.item.id, 'matrix')}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      {viewMode === 'audit' && (lotsData?.requires_migration || Boolean(lotsData?.lots.length)) && (
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

      {viewMode === 'audit' && anomalyIssues.length > 0 && (
        <FadeIn>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-[#ea504c]" />
                <h2 className="text-sm font-semibold text-[#3d2c24]">Bandeja de anomalías</h2>
              </div>
              <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[10px] font-bold text-[#ea504c]">
                {anomalyIssues.length}
              </span>
            </div>
            <p className="rounded-lg bg-[#faf8f5] px-3 py-2 text-[11px] leading-snug text-[#7d6c64]">
              El sistema marca lo raro; el encargado decide si está bien, si se corrige en Fudo/LVE o si se convierte en regla con aviso futuro.
            </p>

            {visibleAnomalyIssues.map((issue) => (
              <div key={issue.id} className="overflow-hidden rounded-xl border border-[#f3d0cf] bg-white">
                {(() => {
                  const item = items.find((entry) => String(entry.id) === String(issue.stock_item_id))
                  const source = item ? getStockSource(item) : null
                  const fudoWritable = Boolean(item?.fudo_product_id || item?.fudo_ingredient_id)
                  const isBusy = decidingIssueId === issue.id

                  return (
                    <div className="space-y-3 px-3 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[#3d2c24]">{issue.stock_item_name}</p>
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${PRIORITY_STYLES[issue.severity]}`}>
                            {formatPriority(issue.severity)}
                          </span>
                          {source && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${source.tone}`}>
                              {source.label}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] font-semibold text-[#3d2c24]">{issue.title}</p>
                        <p className="mt-1 text-[11px] leading-snug text-[#7d6c64]">
                          Por qué lo marco: {issue.detail}
                        </p>
                        <p className="mt-1 text-[11px] font-semibold text-[#3d2c24]">
                          Actual: {formatQty(issue.current_qty)} {issue.unit}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => void handleAnomalyDecision(issue, 'confirm_ok')}
                          disabled={isBusy}
                          className="flex items-center justify-center gap-1 rounded-lg bg-[#e8f5f1] px-2 py-2 text-[11px] font-bold text-[#006d5a] disabled:opacity-50"
                        >
                          {isBusy ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                          Confirmar OK
                        </button>
                        <button
                          onClick={() => openRuleEditor(issue)}
                          disabled={isBusy}
                          className="flex items-center justify-center gap-1 rounded-lg bg-[#f3efe9] px-2 py-2 text-[11px] font-bold text-[#3d2c24] disabled:opacity-50"
                        >
                          <Bell className="size-3.5" />
                          Crear regla
                        </button>
                        <button
                          onClick={() => void handleAnomalyDecision(issue, 'snooze_30d')}
                          disabled={isBusy}
                          className="rounded-lg bg-[#faf8f5] px-2 py-2 text-[11px] font-bold text-[#7d6c64] disabled:opacity-50"
                        >
                          Silenciar 30d
                        </button>
                        <button
                          onClick={() => {
                            if (fudoWritable && fudoConnection.state !== 'ok') {
                              toast.error('Primero reconectá Fudo para reescribir desde LVE')
                              return
                            }
                            focusItemForStockEdit(issue)
                        }}
                          className="rounded-lg bg-[#3d2c24] px-2 py-2 text-[11px] font-bold text-white"
                        >
                          {fudoWritable ? 'Editar Fudo' : 'Editar LVE'}
                        </button>
                      </div>

                      {ruleEditorIssueId === issue.id && (
                        <div className="rounded-lg border border-[#ebe6df] bg-[#faf8f5] p-3">
                          <p className="text-[11px] font-semibold text-[#3d2c24]">
                            Regla para no volver a marcarlo si está dentro del rango.
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="space-y-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Mínimo OK</span>
                              <input
                                value={ruleMinQty}
                                onChange={(e) => setRuleMinQty(e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Máximo OK</span>
                              <input
                                value={ruleMaxQty}
                                onChange={(e) => setRuleMaxQty(e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
                              />
                            </label>
                          </div>
                          <label className="mt-2 block space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Nota</span>
                            <input
                              value={ruleNote}
                              onChange={(e) => setRuleNote(e.target.value)}
                              placeholder="Ej. Edulcorante puede acumularse por cajas"
                              className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none"
                            />
                          </label>
                          <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-[#7d6c64]">
                            <input
                              type="checkbox"
                              checked={ruleNotify}
                              onChange={(e) => setRuleNotify(e.target.checked)}
                            />
                            Crear notificación si sale de este rango
                          </label>
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              onClick={() => setRuleEditorIssueId(null)}
                              className="rounded-lg px-2.5 py-2 text-[11px] font-bold text-[#7d6c64]"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => void handleAnomalyDecision(issue, 'create_rule')}
                              disabled={isBusy}
                              className="rounded-lg bg-[#006d5a] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
                            >
                              Guardar regla
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            ))}

            {anomalyIssues.length > 6 && (
              <button
                onClick={() => setShowAllAnomalies((current) => !current)}
                className="w-full rounded-lg border border-[#ebe6df] bg-white px-3 py-2 text-[12px] font-bold text-[#3d2c24]"
              >
                {showAllAnomalies ? 'Mostrar menos' : `Ver todas (${anomalyIssues.length})`}
              </button>
            )}
          </div>
        </FadeIn>
      )}

      {viewMode === 'audit' && setupIssues.length > 0 && (
        <FadeIn>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-[#d4943a]" />
              <h2 className="text-sm font-semibold text-[#3d2c24]">Configuración pendiente</h2>
              <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[10px] font-bold text-[#d4943a]">
                {configurationIssues.length}
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
                      <span className="rounded-full bg-[#f3efe9] px-1.5 py-0.5 text-[9px] font-bold text-[#7d6c64]">
                        {formatIssueType(issue)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-[#7d6c64]">{issue.title}</p>
                    <p className="mt-1 text-[11px] leading-snug text-[#a39e97]">{issue.detail}</p>
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

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[#3d2c24]">
            {matrixFilter ? `Items: ${matrixFilterLabel(matrixFilter)}` : 'Buscar producto'}
          </h2>
          <p className="mt-0.5 text-[11px] text-[#7d6c64]">
            Tocá la cantidad para corregir stock en Fudo. Tocá resolver para regla, proveedor o aviso.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[#f3efe9] px-2 py-0.5 text-[10px] font-bold text-[#7d6c64]">
          {counts.total}
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto, insumo, proveedor..."
          className="w-full rounded-2xl border border-[#ebe6df] bg-white py-3 pl-10 pr-3 text-sm text-[#3d2c24] shadow-sm placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
        />
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#a39e97] hover:bg-[#f3efe9]">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Semaphore pills */}
      <div className="flex gap-2">
        {(['red', 'yellow', 'green'] as const).map((color) => {
          const isActive = semaphoreFilter === color
          const c = COLORS[color]
          const labels: Record<SemaphoreColor, string> = { red: 'Pedir', yellow: 'Bajo', green: 'OK' }
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

      {showAnomaliesOnly && (
        <button
          onClick={() => setShowAnomaliesOnly(false)}
          className="flex w-full items-center justify-between rounded-xl border border-[#f3d0cf] bg-[#fff7f7] px-3 py-2 text-left text-xs font-semibold text-[#ea504c]"
        >
          Mostrando solo productos con anomalías
          <X className="size-3.5" />
        </button>
      )}

      {matrixFilter && (
        <button
          onClick={() => setMatrixFilter(null)}
          className="flex w-full items-center justify-between rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-left text-xs font-semibold text-[#3d2c24]"
        >
          Matriz: {matrixFilterLabel(matrixFilter)}
          <X className="size-3.5" />
        </button>
      )}

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
        {STOCK_CATEGORY_OPTIONS.map(opt => (
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
            <div key={cat}>
              <button
                onClick={() => toggleCat(cat)}
                className="flex w-full items-center justify-between py-2"
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
                <div className="space-y-1 mb-4">
	                  {catItems.map(item => {
	                    const s = getSemaphore(item)
	                    const c = COLORS[s]
	                    const isEditing = editingId === item.id
	                    const showHistory = historyItemId === item.id
	                    const source = getStockSource(item)
	                    const anomalyCount = anomalyCountByItemId.get(String(item.id)) ?? 0
	                    const matrixState = getMatrixState(item)
	                    const noSupplier = requiresSupplier(item, matrixState)
	                    const missingNotice = requiresPurchaseNotice(item)
	                    const action = getWorkAction({ item, state: matrixState, noSupplier, missingNotice })
	
	                    return (
	                      <div
	                        key={item.id}
	                        className="rounded-xl border bg-card overflow-hidden"
	                        style={{ borderLeftWidth: 3, borderLeftColor: matrixState.borderHex }}
	                      >
	                        <div className="flex items-center px-3 py-2.5">
	                          <div className="min-w-0 flex-1">
	                            <div className="flex min-w-0 items-center gap-2">
	                              <p className="truncate text-sm font-bold text-[#3d2c24]">{item.name}</p>
	                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${matrixState.pill}`}>
	                                {matrixState.label}
	                              </span>
	                            </div>
	                            <p className="mt-0.5 truncate text-[11px] font-semibold text-[#7d6c64]">
	                              {action.label} · min {formatQty(item.min_qty)} · {item.suppliers?.name ?? 'sin proveedor'}
	                            </p>
	                            <div className="mt-1 flex flex-wrap gap-1.5">
	                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${source.tone}`}>
	                                {source.label}
	                              </span>
	                              {missingNotice && (
	                                <span className="inline-flex items-center gap-1 rounded-full bg-[#fff1d6] px-2 py-0.5 text-[9px] font-bold text-[#b7791f]">
	                                  <CalendarClock className="size-2.5" />
	                                  Sin aviso
	                                </span>
	                              )}
	                              {noSupplier && (
	                                <span className="inline-flex items-center gap-1 rounded-full bg-[#fef2f2] px-2 py-0.5 text-[9px] font-bold text-[#ea504c]">
	                                  <Truck className="size-2.5" />
	                                  Sin proveedor
	                                </span>
	                              )}
	                              {isPerishableForUi(item) && item.shelf_life_days == null && (
	                                <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[9px] font-bold text-[#ea504c]">
	                                  Sin vida útil
	                                </span>
	                              )}
	                              {viewMode === 'audit' && anomalyCount > 0 && (
	                                <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[9px] font-bold text-[#ea504c]">
	                                  {anomalyCount} anomalía{anomalyCount > 1 ? 's' : ''}
	                                </span>
	                              )}
	                            </div>
	                          </div>

                          {isEditing ? (
                            <div className="flex items-center gap-1 ml-2">
                              <input
                                value={editQty}
                                onChange={(e) => setEditQty(e.target.value)}
                                className="w-16 rounded-lg border bg-white px-2 py-1.5 text-center text-sm font-bold tabular-nums focus:border-[#006d5a] focus:outline-none"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSave(item.id)
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                              />
                              <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
                              <button
                                onClick={() => handleSave(item.id)}
                                className="rounded-lg bg-[#006d5a] px-2 py-1.5 text-[10px] font-bold text-white"
                              >
                                OK
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="rounded-lg px-1.5 py-1.5 text-[#a39e97]"
                              >
                                <X className="size-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 ml-2">
                              <button
                                onClick={() => {
                                  if (!isEncargado) return
                                  if (fudoConnection.state !== 'ok') {
                                    toast.error('Stock bloqueado: primero hay que reconectar con Fudo')
                                    return
                                  }
                                  if (!source.actionable) {
                                    toast.error('Stock bloqueado: item sin mapeo Fudo ni Local LVE')
                                    return
                                  }
                                  setEditingId(item.id)
                                  setEditQty(String(item.current_qty))
                                }}
                                title={source.actionable ? `Editar ${source.label}` : 'Bloqueado: falta mapear a Fudo o marcar Local LVE'}
                                className={`flex items-baseline gap-0.5 rounded-lg px-2.5 py-1 ${isEncargado && source.actionable ? 'hover:bg-[#f3efe9] cursor-pointer active:scale-95' : ''} ${fudoConnection.state !== 'ok' || !source.actionable ? 'opacity-60' : ''}`}
                              >
                                <span className={`text-base font-bold tabular-nums ${c.text}`}>
                                  {item.current_qty}
                                </span>
                                <span className="text-[10px] text-[#a39e97]">{item.unit}</span>
                              </button>
	                              {viewMode === 'audit' && (
	                                <button
	                                  onClick={() => loadHistory(item.id)}
	                                  className="rounded-lg p-1.5 text-[#a39e97] hover:bg-[#f3efe9]"
	                                  title="Ver historial"
	                                >
	                                  <History className="size-3.5" />
	                                </button>
	                              )}
	                              <button
	                                onClick={() => openMetadataEditor(item.id, 'item')}
	                                className={`rounded-lg px-2 py-1.5 text-[10px] font-bold ${
	                                  editingMetaId === item.id && editingMetaSource === 'item'
	                                    ? 'bg-[#3d2c24] text-white'
	                                    : viewMode === 'work'
	                                      ? 'bg-[#f3efe9] text-[#3d2c24] hover:bg-[#e7ddd2]'
	                                      : 'text-[#a39e97] hover:bg-[#f3efe9]'
	                                }`}
	                                title="Editar configuración"
	                              >
	                                {viewMode === 'work' ? 'Resolver' : <Settings2 className="size-3.5" />}
	                              </button>
                            </div>
                          )}
                        </div>

                        {renderMetadataEditor(item.id, 'item')}

	                        {viewMode === 'audit' && showHistory && (
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
            </div>
          )
        })
      )}
    </div>
  )
}
