'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  History,
  Loader2,
  PackagePlus,
  Radar,
  ScanFace,
  Shield,
} from 'lucide-react'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { FadeIn } from '@/components/ui/motion'
import type { StockAnomaliesResponse, StockAnomalyItem } from '@/lib/contracts/stock-anomalies'
import type { StockIntelligenceResponse, StockSetupIssue } from '@/lib/stock/intelligence'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SectionState<T> = {
  loading: boolean
  error: string | null
  data: T | null
}

type CriticalAlert = {
  id: string
  message: string
  alert_type: string
  created_at: string
  stock_items: {
    name: string
    current_qty: number
    min_qty: number
    unit: string
  } | null
}

type IntelData = {
  response: StockIntelligenceResponse
  missingSupplierCount: number | null
}

type FudoUnmapped = {
  unmapped_ingredients: { id: string; name: string; unit: string }[]
  unmapped_products: { id: string; name: string }[]
  total: number
}

type AttendanceAlert = {
  log_id: string
  first_name: string
  last_name: string
  role: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  hours_worked: number | null
  suspicious_reasons: string[]
  status: string
}

const initialState = { loading: true, error: null, data: null }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function anomalyHref(item: StockAnomalyItem): string {
  if (item.action_href) return item.action_href
  if (item.primary_action === 'count') return '/stock/puesta-a-cero'
  return '/stock'
}

function setupIssueHref(issue: StockSetupIssue): string {
  if (issue.type === 'missing_fudo_mapping' || issue.type === 'mapping_conflict') {
    return '/admin/stock/mapeo'
  }
  // Problemas de metadata de UN item puntual (sin vida útil, categoría, unidad):
  // deep-link directo al editor de ese item en /stock
  if (
    issue.stock_item_id
    && (issue.type === 'missing_shelf_life' || issue.type === 'category_review' || issue.type === 'unit_review')
  ) {
    return `/stock?meta=${issue.stock_item_id}`
  }
  return '/stock'
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ControlPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const isManager = isManagerOrAbove(profile?.role)

  const [critical, setCritical] = useState<SectionState<CriticalAlert[]>>(initialState)
  const [anomalies, setAnomalies] = useState<SectionState<StockAnomaliesResponse>>(initialState)
  const [intel, setIntel] = useState<SectionState<IntelData>>(initialState)
  const [attendance, setAttendance] = useState<SectionState<AttendanceAlert[]>>(initialState)
  const [fudoUnmapped, setFudoUnmapped] = useState<FudoUnmapped | null>(null)
  const [creatingFromFudo, setCreatingFromFudo] = useState(false)
  const [createResult, setCreateResult] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Loaders — cada sección carga y falla de forma independiente
  // -------------------------------------------------------------------------

  const loadCritical = useCallback(async () => {
    setCritical({ loading: true, error: null, data: null })
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('stock_alerts')
        .select('id, message, alert_type, created_at, stock_items(name, current_qty, min_qty, unit)')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      setCritical({ loading: false, error: null, data: (data as unknown as CriticalAlert[]) ?? [] })
    } catch (err) {
      console.error('[control] stock_alerts', err)
      setCritical({ loading: false, error: 'No se pudieron cargar las alertas de stock', data: null })
    }
  }, [])

  const loadAnomalies = useCallback(async () => {
    setAnomalies({ loading: true, error: null, data: null })
    try {
      const res = await fetch('/api/stock/anomalies')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar anomalías')
      setAnomalies({ loading: false, error: null, data: data as StockAnomaliesResponse })
    } catch (err) {
      console.error('[control] anomalies', err)
      setAnomalies({
        loading: false,
        error: err instanceof Error ? err.message : 'No se pudieron cargar las anomalías de stock',
        data: null,
      })
    }
  }, [])

  const loadIntel = useCallback(async () => {
    setIntel({ loading: true, error: null, data: null })
    try {
      const res = await fetch('/api/stock/intelligence')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar el análisis de stock')

      // Conteo de items sin proveedor (opcional: si falla no rompe la sección)
      let missingSupplierCount: number | null = null
      try {
        const supabase = createClient()
        const { count, error } = await supabase
          .from('stock_items')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .is('supplier_id', null)
        if (!error) missingSupplierCount = count ?? 0
      } catch {
        missingSupplierCount = null
      }

      setIntel({
        loading: false,
        error: null,
        data: { response: data as StockIntelligenceResponse, missingSupplierCount },
      })
    } catch (err) {
      console.error('[control] intelligence', err)
      setIntel({
        loading: false,
        error: err instanceof Error ? err.message : 'No se pudo cargar el análisis de stock',
        data: null,
      })
    }
  }, [])

  const loadAttendance = useCallback(async () => {
    setAttendance({ loading: true, error: null, data: null })
    try {
      const fromDate = format(new Date(Date.now() - 7 * 86400000), 'yyyy-MM-dd')
      const res = await fetch(`/api/attendance/alerts?from_date=${fromDate}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar fichajes')
      setAttendance({ loading: false, error: null, data: (data.alerts as AttendanceAlert[]) ?? [] })
    } catch (err) {
      console.error('[control] attendance', err)
      setAttendance({
        loading: false,
        error: err instanceof Error ? err.message : 'No se pudieron cargar los fichajes',
        data: null,
      })
    }
  }, [])

  // Items de Fudo (con control de stock) que todavía no existen en LVE.
  // Silencioso: si Fudo no responde, la fila simplemente no aparece.
  const loadFudoUnmapped = useCallback(async () => {
    try {
      const res = await fetch('/api/stock/create-from-fudo')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al consultar Fudo')
      setFudoUnmapped(data as FudoUnmapped)
    } catch (err) {
      console.error('[control] create-from-fudo', err)
      setFudoUnmapped(null)
    }
  }, [])

  const handleCreateAllFromFudo = useCallback(async () => {
    setCreatingFromFudo(true)
    setCreateResult(null)
    try {
      const res = await fetch('/api/stock/create-from-fudo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudieron crear los items')

      const summary = `${data.created} creado${data.created === 1 ? '' : 's'} · ${data.skipped} salteado${data.skipped === 1 ? '' : 's'}${data.errors?.length ? ` · ${data.errors.length} con error` : ''}`
      setCreateResult(summary)
      if (data.errors?.length) {
        toast.error(`Creados con errores: ${summary}. ${data.errors[0]}`)
      } else {
        toast.success(`Items creados en LVE: ${summary}`)
      }
      void loadFudoUnmapped()
      void loadIntel()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron crear los items'
      setCreateResult(null)
      toast.error(msg)
    } finally {
      setCreatingFromFudo(false)
    }
  }, [loadFudoUnmapped, loadIntel])

  useEffect(() => {
    if (!profile || !isManager) return
    void Promise.all([loadCritical(), loadAnomalies(), loadIntel(), loadAttendance(), loadFudoUnmapped()])
  }, [profile, isManager, loadCritical, loadAnomalies, loadIntel, loadAttendance, loadFudoUnmapped])

  // -------------------------------------------------------------------------
  // Access control
  // -------------------------------------------------------------------------

  if (profileLoading) {
    return <LoadingState message="Cargando centro de control..." />
  }

  if (!isManager) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          icon={Shield}
          title="Acceso restringido"
          description="Solo encargados y socios pueden ver el centro de control"
        />
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Derived data per section
  // -------------------------------------------------------------------------

  // a. Stock crítico: alertas activas + reposiciones high del intelligence
  const criticalAlerts = critical.data ?? []
  const alertedNames = new Set(
    criticalAlerts.map((a) => (a.stock_items?.name ?? '').toLowerCase()).filter(Boolean),
  )
  const highReplenish = (intel.data?.response.sectors ?? [])
    .filter((s) => s.sector === 'compras')
    .flatMap((s) => s.actions)
    .filter(
      (a) =>
        a.kind === 'replenish'
        && a.priority === 'high'
        && !alertedNames.has(a.stock_item_name.toLowerCase()),
    )
  const criticalCount = criticalAlerts.length + highReplenish.length

  // b. Anomalías de stock (radar)
  const anomalyItems = anomalies.data?.items ?? []
  const anomalyCount = anomalies.data?.summary.total ?? anomalyItems.length

  // c. Datos por completar (setup issues + items sin proveedor + items Fudo sin crear)
  const setupIssues = intel.data?.response.setup_issues ?? []
  const missingSupplierCount = intel.data?.missingSupplierCount ?? 0
  const fudoUnmappedCount = fudoUnmapped?.total ?? 0
  const setupCount = setupIssues.length
    + (missingSupplierCount > 0 ? 1 : 0)
    + (fudoUnmappedCount > 0 ? 1 : 0)

  // d. Fichajes sospechosos
  const attendanceAlerts = attendance.data ?? []

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-24">
      {/* Header */}
      <FadeIn className="space-y-1 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#e8f5f1]">
            <Shield className="size-5 text-[#006d5a]" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[#3d2c24]">
              Centro de control
            </h1>
            <p className="text-sm text-[#a39e97]">
              Todo lo que necesita atención, en un solo lugar
            </p>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.05} className="space-y-4">
        {/* a. Stock crítico */}
        <ControlSection
          title="Stock crítico"
          icon={AlertTriangle}
          tone="red"
          count={criticalCount}
          loading={critical.loading}
          error={critical.error}
          emptyText="Sin alertas de stock activas"
        >
          {criticalAlerts.map((alert) => (
            <SectionRow
              key={alert.id}
              href="/stock"
              title={alert.stock_items?.name ?? 'Item desconocido'}
              detail={alert.message}
              meta={
                alert.stock_items
                  ? `${alert.stock_items.current_qty} ${alert.stock_items.unit} / mín. ${alert.stock_items.min_qty}`
                  : undefined
              }
            />
          ))}
          {highReplenish.map((action) => (
            <SectionRow
              key={action.id}
              href="/stock"
              title={action.title}
              detail={action.detail}
            />
          ))}
        </ControlSection>

        {/* b. Anomalías de stock */}
        <ControlSection
          title="Anomalías de stock"
          icon={Radar}
          tone="orange"
          count={anomalyCount}
          loading={anomalies.loading}
          error={anomalies.error}
          emptyText="El radar no detecta anomalías"
        >
          {anomalyItems.map((item) => (
            <SectionRow
              key={item.id}
              href={anomalyHref(item)}
              title={item.title}
              detail={item.detail}
              meta={item.action_label}
            />
          ))}
        </ControlSection>

        {/* c. Datos por completar */}
        <ControlSection
          title="Datos por completar"
          icon={ClipboardList}
          tone="yellow"
          count={setupCount}
          loading={intel.loading}
          error={intel.error}
          emptyText="No hay datos pendientes de completar"
        >
          {fudoUnmappedCount > 0 && (
            <div className="flex items-center gap-3 bg-[#fbf6e0]/50 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f5f1]">
                <PackagePlus className="size-4.5 text-[#006d5a]" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#3d2c24]">
                  {fudoUnmappedCount} item{fudoUnmappedCount === 1 ? '' : 's'} de Fudo sin crear en LVE
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#a39e97]">
                  {createResult
                    ? `Último resultado: ${createResult}`
                    : 'Tienen control de stock en Fudo pero no existen acá. Crealos para no perder trazabilidad.'}
                </p>
              </div>
              <button
                onClick={handleCreateAllFromFudo}
                disabled={creatingFromFudo}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#006d5a] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#005c4c] disabled:opacity-60"
              >
                {creatingFromFudo && <Loader2 className="size-3.5 animate-spin" />}
                Crear todos en LVE
              </button>
            </div>
          )}
          {missingSupplierCount > 0 && (
            <SectionRow
              href="/proveedores/vincular"
              title={`${missingSupplierCount} item${missingSupplierCount === 1 ? '' : 's'} sin proveedor asignado`}
              detail="Vinculá cada item a su proveedor para poder pedir y controlar compras."
              meta="Vincular"
            />
          )}
          {setupIssues.slice(0, 30).map((issue) => (
            <SectionRow
              key={issue.id}
              href={setupIssueHref(issue)}
              title={issue.title}
              detail={issue.detail}
            />
          ))}
          {setupIssues.length > 30 && (
            <p className="px-4 py-2.5 text-xs text-[#a39e97]">
              + {setupIssues.length - 30} más en la vista de stock
            </p>
          )}
        </ControlSection>

        {/* d. Fichajes sospechosos */}
        <ControlSection
          title="Fichajes sospechosos"
          icon={ScanFace}
          tone="purple"
          count={attendanceAlerts.length}
          loading={attendance.loading}
          error={attendance.error}
          emptyText="Sin fichajes sospechosos en los últimos 7 días"
        >
          {attendanceAlerts.map((alert) => (
            <SectionRow
              key={alert.log_id}
              href="/equipo/asistencia"
              title={`${alert.first_name} ${alert.last_name}`}
              detail={
                (alert.suspicious_reasons ?? []).length > 0
                  ? alert.suspicious_reasons.join(' · ')
                  : 'Sin egreso registrado'
              }
              meta={`${format(new Date(alert.operative_date + 'T12:00:00'), 'EEE d/MM', { locale: es })} · ${format(new Date(alert.clock_in_at), 'HH:mm')}${alert.clock_out_at ? ` → ${format(new Date(alert.clock_out_at), 'HH:mm')}` : ' → ?'}`}
            />
          ))}
        </ControlSection>
      </FadeIn>

      {/* Footer: auditoría */}
      <FadeIn delay={0.1} className="pt-2 text-center">
        <Link
          href="/auditoria"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#a39e97] transition-colors hover:text-[#006d5a]"
        >
          <History className="size-3.5" />
          Ver historial completo de cambios
        </Link>
      </FadeIn>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ControlSection — card colapsable con badge de conteo
// ---------------------------------------------------------------------------

type SectionTone = 'red' | 'orange' | 'yellow' | 'purple'

const TONE_STYLES: Record<SectionTone, { iconBg: string; iconText: string; badge: string }> = {
  red: { iconBg: 'bg-[#fdecea]', iconText: 'text-[#ea504c]', badge: 'bg-[#ea504c]' },
  orange: { iconBg: 'bg-[#fdf1e3]', iconText: 'text-[#d4943a]', badge: 'bg-[#d4943a]' },
  yellow: { iconBg: 'bg-[#fbf6e0]', iconText: 'text-[#b08a1e]', badge: 'bg-[#c9a227]' },
  purple: { iconBg: 'bg-[#f3edfb]', iconText: 'text-[#8b5cf6]', badge: 'bg-[#8b5cf6]' },
}

function ControlSection({
  title,
  icon: Icon,
  tone,
  count,
  loading,
  error,
  emptyText,
  children,
}: {
  title: string
  icon: LucideIcon
  tone: SectionTone
  count: number
  loading: boolean
  error: string | null
  emptyText: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  const styles = TONE_STYLES[tone]
  const isEmpty = !loading && !error && count === 0

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
      {/* Header colapsable */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${styles.iconBg}`}>
          <Icon className={`size-4.5 ${styles.iconText}`} strokeWidth={1.75} />
        </span>
        <span className="flex-1 text-sm font-semibold text-[#3d2c24]">{title}</span>
        {loading ? (
          <Loader2 className="size-4 animate-spin text-[#a39e97]" />
        ) : error ? (
          <span className="rounded-full bg-[#fdecea] px-2 py-0.5 text-[11px] font-semibold text-[#ea504c]">
            Error
          </span>
        ) : count > 0 ? (
          <span
            className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white ${styles.badge}`}
          >
            {count}
          </span>
        ) : (
          <span className="rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[11px] font-semibold text-[#006d5a]">
            OK
          </span>
        )}
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-[#a39e97]" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-[#a39e97]" />
        )}
      </button>

      {/* Contenido */}
      {open && (
        <div className="border-t border-[#ebe6df]">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-[#a39e97]">
              <Loader2 className="size-4 animate-spin" />
              Cargando...
            </div>
          ) : error ? (
            <p className="px-4 py-4 text-sm text-[#ea504c]">{error}</p>
          ) : isEmpty ? (
            <p className="px-4 py-4 text-sm text-[#a39e97]">{emptyText}</p>
          ) : (
            <div className="divide-y divide-[#f3efe9]">{children}</div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// SectionRow — ítem linkeable dentro de una sección
// ---------------------------------------------------------------------------

function SectionRow({
  href,
  title,
  detail,
  meta,
}: {
  href: string
  title: string
  detail?: string
  meta?: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#f9f7f3] active:bg-[#f3efe9]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-[#3d2c24]">{title}</p>
          {meta && (
            <span className="shrink-0 rounded-full bg-[#f5f0ea] px-2 py-0.5 text-[10px] font-medium text-[#a39e97]">
              {meta}
            </span>
          )}
        </div>
        {detail && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#a39e97]">{detail}</p>
        )}
      </div>
      <ChevronRight className="size-4 shrink-0 text-[#d8d2c9]" />
    </Link>
  )
}
