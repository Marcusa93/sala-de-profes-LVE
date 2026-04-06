'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, RefreshCw, ChefHat, Package,
  TrendingDown, AlertTriangle, Clock, Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import type { StockAvailabilityResult, StockDurationResult, RecipeAtRisk } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RendimientoData = {
  availability: {
    total_recipes: number
    at_risk_count: number
    ok_count: number
    recipes: StockAvailabilityResult[]
  }
  atRisk: {
    total: number
    sin_stock_count: number
    bajo_count: number
    ok_count: number
    recipes: (RecipeAtRisk & { limiting_ingredient_unit: string | null; limiting_ingredient_current_qty: number | null })[]
  }
  duration: {
    total: number
    semaphore_counts: { critico: number; bajo: number; atencion: number; ok: number; sin_historial: number }
    items: StockDurationResult[]
  }
}

// ---------------------------------------------------------------------------
// Semaphore helpers
// ---------------------------------------------------------------------------

type SemColor = { bg: string; text: string; ring: string; dot: string }

function portionsSemaphore(portions: number): SemColor {
  if (portions <= 0) return { bg: '#fef2f2', text: '#ea504c', ring: '#ea504c', dot: '#ea504c' }
  if (portions < 10)  return { bg: '#fdf6ec', text: '#d4943a', ring: '#d4943a', dot: '#d4943a' }
  return { bg: '#e8f5f1', text: '#006d5a', ring: '#006d5a', dot: '#006d5a' }
}

function durationSemaphore(sem: string): SemColor {
  if (sem === 'critico')      return { bg: '#fef2f2', text: '#ea504c', ring: '#ea504c', dot: '#ea504c' }
  if (sem === 'bajo')         return { bg: '#fdf6ec', text: '#d4943a', ring: '#d4943a', dot: '#d4943a' }
  if (sem === 'atención')     return { bg: '#fdf6ec', text: '#d4943a', ring: '#d4943a', dot: '#d4943a' }
  if (sem === 'sin_historial') return { bg: '#f3efe9', text: '#a39e97', ring: '#a39e97', dot: '#a39e97' }
  return { bg: '#e8f5f1', text: '#006d5a', ring: '#006d5a', dot: '#006d5a' }
}

function semLabel(sem: string): string {
  const map: Record<string, string> = {
    critico: 'Crítico', bajo: 'Bajo', 'atención': 'Atención',
    ok: 'OK', sin_historial: 'Sin datos',
  }
  return map[sem] ?? sem
}

function portionsLabel(portions: number): string {
  if (portions <= 0) return 'Sin stock'
  if (portions < 10) return 'Stock bajo'
  return 'OK'
}

function SemaphoreDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

// ---------------------------------------------------------------------------
// Recipe availability card
// ---------------------------------------------------------------------------

function RecipeAvailCard({ recipe }: { recipe: StockAvailabilityResult }) {
  const portions = recipe.available_portions ?? 0
  const sem = portionsSemaphore(portions)
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="overflow-hidden rounded-xl ring-1 transition-all"
      style={{ ringColor: sem.ring + '40', backgroundColor: 'var(--card)' }}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        {/* Semaphore dot */}
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-center"
          style={{ backgroundColor: sem.bg }}
        >
          <span className="font-display text-base font-bold tabular-nums" style={{ color: sem.text }}>
            {portions <= 999 ? Math.floor(portions) : '∞'}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-[#3d2c24]">{recipe.recipe_name}</p>
            {recipe.warning && (
              <span className="rounded-full bg-[#f3efe9] px-1.5 py-0.5 text-[9px] text-[#a39e97]">
                sin vínculos
              </span>
            )}
          </div>
          <p className="text-[11px]" style={{ color: sem.text }}>
            {portionsLabel(portions)}
            {portions > 0 && <span className="text-[#a39e97]"> · {portions.toFixed(1)} porciones posibles</span>}
          </p>
          {recipe.limiting_ingredient && (
            <p className="text-[10px] text-[#a39e97]">
              Limitante: {recipe.limiting_ingredient}
            </p>
          )}
        </div>

        <SemaphoreDot color={sem.dot} />
      </button>

      {/* Expanded: ingredients breakdown */}
      {expanded && recipe.ingredients && recipe.ingredients.length > 0 && (
        <div className="border-t border-[#ebe6df] bg-[#faf8f5] px-3 py-2 space-y-1">
          {recipe.ingredients.map((ing, i) => {
            const ingSem = portionsSemaphore(ing.available_portions ?? 0)
            return (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <SemaphoreDot color={ing.is_limiting ? ingSem.dot : '#a39e97'} />
                  <span className={ing.is_limiting ? 'font-semibold text-[#3d2c24]' : 'text-[#a39e97]'}>
                    {ing.name}
                  </span>
                  {ing.is_limiting && (
                    <span className="rounded-full bg-[#fdf6ec] px-1.5 py-0.5 text-[9px] font-bold text-[#d4943a]">
                      limitante
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[#3d2c24]">
                    {ing.current_qty} {ing.unit}
                  </span>
                  <span className="ml-1 text-[#a39e97]">
                    ({ing.available_portions?.toFixed(1) ?? '?'} p.)
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stock duration card
// ---------------------------------------------------------------------------

function DurationCard({ item }: { item: StockDurationResult }) {
  const sem = durationSemaphore(item.semaphore)

  return (
    <div
      className="flex items-center gap-3 rounded-xl p-3 ring-1"
      style={{ backgroundColor: sem.bg + '60', ringColor: sem.ring + '30' }}
    >
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: sem.bg }}
      >
        <Clock className="size-4" style={{ color: sem.text }} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-[#3d2c24]">{item.name}</p>
        <p className="text-[11px]" style={{ color: sem.text }}>
          {item.days_remaining !== null
            ? `${item.days_remaining.toFixed(1)} días restantes`
            : semLabel(item.semaphore)
          }
        </p>
      </div>

      <div className="text-right">
        <p className="text-xs font-semibold text-[#3d2c24]">{item.current_qty} {item.unit}</p>
        {item.daily_avg_consumption > 0 && (
          <p className="text-[10px] text-[#a39e97]">
            {item.daily_avg_consumption.toFixed(2)}/día
          </p>
        )}
      </div>

      <SemaphoreDot color={sem.dot} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RendimientoPage() {
  const [data, setData] = useState<RendimientoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeSection, setActiveSection] = useState<'recetas' | 'insumos'>('recetas')
  const [recipeFilter, setRecipeFilter] = useState<'all' | 'sin_stock' | 'bajo' | 'ok'>('all')

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true)
    else setLoading(true)

    try {
      const [availRes, atRiskRes, durationRes] = await Promise.all([
        fetch('/api/stock/availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threshold: 0 }),
        }),
        fetch('/api/stock/at-risk?threshold=10'),
        fetch('/api/stock/duration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ only_at_risk: false, days: 30 }),
        }),
      ])

      const [availability, atRisk, duration] = await Promise.all([
        availRes.json(),
        atRiskRes.json(),
        durationRes.json(),
      ])

      setData({ availability, atRisk, duration })
    } catch {
      toast.error('Error al cargar datos de rendimiento')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Filter recipes
  const filteredRecipes = (data?.availability.recipes ?? []).filter(r => {
    if (recipeFilter === 'all') return true
    const portions = r.available_portions ?? 0
    if (recipeFilter === 'sin_stock') return portions <= 0
    if (recipeFilter === 'bajo') return portions > 0 && portions < 10
    if (recipeFilter === 'ok') return portions >= 10
    return true
  })

  // Duration: sort by urgency, filter relevant
  const criticalItems = (data?.duration.items ?? []).filter(
    i => i.semaphore === 'critico' || i.semaphore === 'bajo'
  )
  const warningItems = (data?.duration.items ?? []).filter(i => i.semaphore === 'atención')
  const okItems = (data?.duration.items ?? []).filter(i => i.semaphore === 'ok')

  if (loading) return <LoadingState message="Calculando rendimiento…" />

  const atRiskCount = data?.atRisk.sin_stock_count ?? 0
  const bajoCount = data?.atRisk.bajo_count ?? 0
  const totalRecipes = data?.availability.total_recipes ?? 0
  const durCounts = data?.duration.semaphore_counts

  return (
    <FadeIn className="mx-auto max-w-lg space-y-5 pb-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/stock"
            className="flex size-9 items-center justify-center rounded-xl bg-secondary text-[#a39e97] hover:text-[#3d2c24]"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Rendimiento</h1>
            <p className="section-label mt-0.5">Stock · Recetas · Proyección</p>
          </div>
        </div>

        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="flex size-9 items-center justify-center rounded-xl bg-secondary text-[#a39e97] hover:text-[#3d2c24] disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* KPI row */}
      <StaggerList className="grid grid-cols-3 gap-2">
        <StaggerItem>
          <div className="rounded-xl bg-[#fef2f2] p-3 text-center ring-1 ring-[#ea504c]/10">
            <p className="font-display text-2xl font-bold text-[#ea504c]">
              <AnimatedNumber value={atRiskCount} />
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#ea504c]">Sin stock</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="rounded-xl bg-[#fdf6ec] p-3 text-center ring-1 ring-[#d4943a]/10">
            <p className="font-display text-2xl font-bold text-[#d4943a]">
              <AnimatedNumber value={bajoCount} />
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">Stock bajo</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="rounded-xl bg-[#e8f5f1] p-3 text-center ring-1 ring-[#006d5a]/10">
            <p className="font-display text-2xl font-bold text-[#006d5a]">
              <AnimatedNumber value={totalRecipes - atRiskCount - bajoCount} />
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">OK</p>
          </div>
        </StaggerItem>
      </StaggerList>

      {/* Critical alert banner */}
      {atRiskCount > 0 && (
        <FadeIn>
          <div className="flex items-start gap-3 rounded-xl bg-[#fef2f2] p-3 ring-1 ring-[#ea504c]/20">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#ea504c]" />
            <p className="text-xs text-[#ea504c]">
              <strong>{atRiskCount} receta{atRiskCount !== 1 ? 's' : ''} sin stock suficiente.</strong>{' '}
              {data?.atRisk.recipes
                .filter(r => r.status === 'sin_stock')
                .map(r => r.recipe_name)
                .join(', ')}
            </p>
          </div>
        </FadeIn>
      )}

      {/* Section tabs */}
      <div className="flex gap-1.5">
        <button
          onClick={() => setActiveSection('recetas')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all ${
            activeSection === 'recetas'
              ? 'bg-[#006d5a] text-white'
              : 'bg-secondary text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          <ChefHat className="size-3.5" />
          Recetas ({totalRecipes})
        </button>
        <button
          onClick={() => setActiveSection('insumos')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all ${
            activeSection === 'insumos'
              ? 'bg-[#006d5a] text-white'
              : 'bg-secondary text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          <Package className="size-3.5" />
          Insumos ({data?.duration.total ?? 0})
        </button>
      </div>

      {/* ── RECETAS section ── */}
      {activeSection === 'recetas' && (
        <div className="space-y-4">
          {/* Filter pills */}
          <div className="flex gap-1.5">
            {[
              { key: 'all' as const, label: 'Todas' },
              { key: 'sin_stock' as const, label: `Sin stock (${atRiskCount})`, color: '#ea504c' },
              { key: 'bajo' as const, label: `Bajo (${bajoCount})`, color: '#d4943a' },
              { key: 'ok' as const, label: `OK (${totalRecipes - atRiskCount - bajoCount})`, color: '#006d5a' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setRecipeFilter(f.key)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                  recipeFilter === f.key
                    ? 'bg-[#006d5a] text-white'
                    : 'bg-secondary text-[#a39e97]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredRecipes.length === 0 ? (
            <div className="rounded-xl bg-[#faf8f5] p-6 text-center">
              <p className="text-sm text-[#a39e97]">
                {totalRecipes === 0
                  ? 'No hay recetas con ingredientes vinculados. Ejecutá POST /api/recipes/ingest primero.'
                  : 'No hay recetas en este estado.'}
              </p>
              {totalRecipes === 0 && (
                <Link
                  href="/admin/recetas/pending"
                  className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Ver ingredientes pendientes
                </Link>
              )}
            </div>
          ) : (
            <StaggerList className="space-y-2">
              {filteredRecipes
                .sort((a, b) => (a.available_portions ?? 0) - (b.available_portions ?? 0))
                .map(recipe => (
                  <StaggerItem key={recipe.recipe_id}>
                    <RecipeAvailCard recipe={recipe} />
                  </StaggerItem>
                ))}
            </StaggerList>
          )}
        </div>
      )}

      {/* ── INSUMOS section ── */}
      {activeSection === 'insumos' && (
        <div className="space-y-4">
          {/* Duration semaphore summary */}
          {durCounts && (
            <div className="grid grid-cols-4 gap-1.5 text-center">
              {[
                { key: 'critico', label: 'Crítico', count: durCounts.critico, color: '#ea504c', bg: '#fef2f2' },
                { key: 'bajo', label: 'Bajo', count: durCounts.bajo, color: '#d4943a', bg: '#fdf6ec' },
                { key: 'atencion', label: 'Atención', count: durCounts.atencion, color: '#d4943a', bg: '#fdf6ec' },
                { key: 'ok', label: 'OK', count: durCounts.ok, color: '#006d5a', bg: '#e8f5f1' },
              ].map(s => (
                <div key={s.key} className="rounded-xl p-2" style={{ backgroundColor: s.bg }}>
                  <p className="font-display text-lg font-bold" style={{ color: s.color }}>{s.count}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: s.color }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Critical items */}
          {criticalItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <TrendingDown className="size-3.5 text-[#ea504c]" />
                <h3 className="section-label text-[#ea504c]">Crítico / Bajo — acción inmediata</h3>
              </div>
              <div className="space-y-1.5">
                {criticalItems.map(item => (
                  <DurationCard key={item.stock_item_id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* Warning items */}
          {warningItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="size-3.5 text-[#d4943a]" />
                <h3 className="section-label text-[#d4943a]">Atención — esta semana</h3>
              </div>
              <div className="space-y-1.5">
                {warningItems.map(item => (
                  <DurationCard key={item.stock_item_id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* OK items */}
          {okItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Layers className="size-3.5 text-[#006d5a]" />
                <h3 className="section-label">Stock estable</h3>
              </div>
              <div className="space-y-1.5">
                {okItems.map(item => (
                  <DurationCard key={item.stock_item_id} item={item} />
                ))}
              </div>
            </div>
          )}

          {data?.duration.total === 0 && (
            <div className="rounded-xl bg-[#faf8f5] p-6 text-center">
              <p className="text-sm text-[#a39e97]">
                Sin historial de consumo. Los datos aparecerán después de registrar
                ventas o producción en cocina.
              </p>
            </div>
          )}

          {/* Note about lookback */}
          {(data?.duration.total ?? 0) > 0 && (
            <p className="text-center text-[10px] text-[#a39e97]">
              Cálculo basado en consumo promedio de los últimos 30 días
            </p>
          )}
        </div>
      )}

      {/* Link to pending */}
      <FadeIn>
        <Link
          href="/admin/recetas/pending"
          className="flex items-center justify-between rounded-xl bg-card p-3 ring-1 ring-[#ebe6df] hover:bg-[#faf8f5]"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#fdf6ec]">
              <AlertTriangle className="size-4 text-[#d4943a]" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#3d2c24]">Ingredientes pendientes de revisión</p>
              <p className="text-[10px] text-[#a39e97]">Vincular ingredientes sin match automático</p>
            </div>
          </div>
          <ArrowLeft className="size-4 rotate-180 text-[#a39e97]" />
        </Link>
      </FadeIn>
    </FadeIn>
  )
}
