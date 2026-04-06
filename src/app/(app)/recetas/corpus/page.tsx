'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, BookOpen, Check, AlertTriangle, HelpCircle,
  ChevronDown, ChevronUp, Package, Truck, Link2, Upload, Loader2,
  TrendingDown,
} from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'

type CorpusData = {
  stats: {
    total: number; completas: number; incompletas: number
    byCategory: Record<string, number>; totalVariants: number
    withDependencies: number; implicitSubRecipes: number
    uniqueIngredients: number; ingredientsNeedingReview: number
  }
  recipes: {
    slug: string; nombre: string; categoria: string; estado: string
    ingredientes_count: number; variantes_count: number
    depends_on: string[]; is_base: boolean; guarnicion: string | null
  }[]
  implicit_sub_recipes: { slug: string; nombre: string; description: string }[]
  ingredients: {
    original_name: string; normalized_name: string; classification: string
    confidence: string; requires_review: boolean; review_reason: string | null
    recipe_slug: string
    stock_match: {
      confidence: string; confidence_score: number
      suggested_stock_item_name: string | null
      reasons: string[]
    }
  }[]
  match_stats: { total: number; exacto: number; probable: number; ambiguo: number; sin_match: number }
  fudo_bridge: { recipe_slug: string; recipe_name: string; fudo_match: { name: string } | null }[]
}

const CAT_EMOJI: Record<string, string> = {
  plato: '🍽️', sandwich: '🥪', postre: '🍮', pizza: '🍕',
  preparacion_base: '🧪', guarnicion: '🥗', bebida: '☕',
}

const MATCH_COLORS: Record<string, { bg: string; text: string }> = {
  exacto: { bg: 'bg-[#e8f5f1]', text: 'text-[#006d5a]' },
  probable: { bg: 'bg-[#fdf6ec]', text: 'text-[#d4943a]' },
  ambiguo: { bg: 'bg-[#fef2f2]', text: 'text-[#ea504c]' },
  sin_match: { bg: 'bg-[#f3efe9]', text: 'text-[#a39e97]' },
}

type IngestResult = {
  ok: boolean
  dry_run: boolean
  summary: {
    recipes_created: number
    recipes_existing: number
    ingredients_linked: number
    ingredients_skipped: number
    menu_items_linked: number
  }
  details: Array<{
    recipe: string
    recipe_id: number | null
    action: 'created' | 'existing'
    ingredients: Array<{
      name: string
      stock_item: string | null
      qty_per_portion: number | null
      unit: string | null
      action: 'linked' | 'skipped' | 'override'
      reason: string
    }>
    menu_link: { menu_item_id: number; menu_item_name: string } | null
  }>
}

type YieldData = {
  recipe_id: number
  recipe_name: string
  max_portions: number
  limiting_item: string
  limiting_qty: number
  limiting_need: number
}

export default function CorpusPage() {
  const [data, setData] = useState<CorpusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'recetas' | 'ingredientes' | 'fudo' | 'rendimiento'>('recetas')
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null)

  // Ingest state
  const [ingestPreview, setIngestPreview] = useState<IngestResult | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestDone, setIngestDone] = useState<IngestResult | null>(null)

  // Yield state
  const [yields, setYields] = useState<YieldData[] | null>(null)
  const [loadingYields, setLoadingYields] = useState(false)

  useEffect(() => {
    fetch('/api/recipes/ingest')
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const runIngest = async (dryRun: boolean) => {
    setIngesting(true)
    try {
      const res = await fetch('/api/recipes/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun, min_confidence: 'probable' }),
      })
      const result = await res.json()
      if (dryRun) {
        setIngestPreview(result)
      } else {
        setIngestDone(result)
        setIngestPreview(null)
      }
    } catch {
      // noop
    } finally {
      setIngesting(false)
    }
  }

  const loadYields = async () => {
    setLoadingYields(true)
    try {
      const res = await fetch('/api/recipes/yield')
      const result = await res.json()
      setYields(result.yields ?? [])
    } catch {
      // noop
    } finally {
      setLoadingYields(false)
    }
  }

  if (loading) return <LoadingState />
  if (!data) return <div className="p-4 text-center text-muted-foreground">Error al cargar corpus</div>

  return (
    <FadeIn className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/recetas" className="icon-btn flex items-center justify-center rounded-xl bg-secondary">
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Corpus de Recetas</h1>
          <p className="section-label mt-0.5">Análisis gastronómico del chef</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-[#e8f5f1] p-3 text-center">
          <p className="font-display text-2xl font-bold text-[#006d5a]">{data.stats.completas}</p>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">Completas</p>
        </div>
        <div className="rounded-xl bg-[#fdf6ec] p-3 text-center">
          <p className="font-display text-2xl font-bold text-[#d4943a]">{data.stats.incompletas}</p>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">Incompletas</p>
        </div>
        <div className="rounded-xl bg-[#f3efe9] p-3 text-center">
          <p className="font-display text-2xl font-bold text-[#3d2c24]">{data.stats.totalVariants}</p>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Variantes</p>
        </div>
      </div>

      {/* Match stats */}
      <div className="flex items-center justify-between rounded-xl bg-[#faf8f5] px-4 py-2.5 text-xs">
        <span className="text-[#a39e97]">Ingredientes → Stock:</span>
        <div className="flex gap-3">
          <span className="text-[#006d5a] font-semibold">{data.match_stats.exacto} exactos</span>
          <span className="text-[#d4943a] font-semibold">{data.match_stats.probable} probables</span>
          <span className="text-[#ea504c] font-semibold">{data.match_stats.sin_match} sin match</span>
        </div>
      </div>

      {/* Ingest Action */}
      {!ingestDone && (
        <div className="rounded-xl border border-dashed border-[#006d5a]/30 bg-[#e8f5f1]/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Upload className="size-4 text-[#006d5a]" />
            <span className="text-sm font-semibold text-[#006d5a]">Poblar recetas en el sistema</span>
          </div>
          <p className="text-[10px] text-[#a39e97]">
            Escribe las recetas del corpus al sistema: crea recetas, vincula ingredientes con stock,
            y conecta con productos de FUDO. Solo ingredientes con match probable o exacto.
          </p>
          {!ingestPreview ? (
            <button
              onClick={() => runIngest(true)}
              disabled={ingesting}
              className="w-full rounded-xl bg-[#006d5a] py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {ingesting ? <Loader2 className="inline size-3.5 animate-spin mr-1" /> : null}
              {ingesting ? 'Analizando...' : 'Vista previa (dry run)'}
            </button>
          ) : (
            <div className="space-y-3">
              {/* Preview summary */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white p-2">
                  <p className="font-display text-lg font-bold text-[#006d5a]">{ingestPreview.summary.recipes_created}</p>
                  <p className="text-[8px] uppercase tracking-wider text-[#a39e97]">Recetas nuevas</p>
                </div>
                <div className="rounded-lg bg-white p-2">
                  <p className="font-display text-lg font-bold text-[#006d5a]">{ingestPreview.summary.ingredients_linked}</p>
                  <p className="text-[8px] uppercase tracking-wider text-[#a39e97]">Ingredientes</p>
                </div>
                <div className="rounded-lg bg-white p-2">
                  <p className="font-display text-lg font-bold text-[#d4943a]">{ingestPreview.summary.ingredients_skipped}</p>
                  <p className="text-[8px] uppercase tracking-wider text-[#a39e97]">Sin vincular</p>
                </div>
              </div>

              {/* Detail preview */}
              <div className="max-h-60 overflow-y-auto space-y-1.5 rounded-lg bg-white p-2">
                {ingestPreview.details.map((d, i) => (
                  <div key={i} className="rounded-lg bg-[#faf8f5] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#3d2c24]">{d.recipe}</span>
                      <span className={`text-[9px] font-bold ${d.action === 'created' ? 'text-[#006d5a]' : 'text-[#a39e97]'}`}>
                        {d.action === 'created' ? 'NUEVA' : 'YA EXISTE'}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.ingredients.map((ing, j) => (
                        <span key={j} className={`rounded px-1.5 py-0.5 text-[9px] ${
                          ing.action === 'linked' ? 'bg-[#e8f5f1] text-[#006d5a]'
                          : 'bg-[#f3efe9] text-[#a39e97]'
                        }`}>
                          {ing.name} {ing.action === 'linked' ? '→ ' + ing.stock_item : '✗'}
                        </span>
                      ))}
                    </div>
                    {d.menu_link && (
                      <p className="mt-1 text-[9px] text-[#4a90d9]">
                        FUDO → {d.menu_link.menu_item_name}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setIngestPreview(null)}
                  className="flex-1 rounded-xl bg-secondary py-2.5 text-xs font-semibold text-muted-foreground"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => runIngest(false)}
                  disabled={ingesting}
                  className="flex-1 rounded-xl bg-[#006d5a] py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {ingesting ? <Loader2 className="inline size-3.5 animate-spin mr-1" /> : null}
                  {ingesting ? 'Escribiendo...' : 'Confirmar y escribir'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {ingestDone && (
        <div className="rounded-xl border border-[#006d5a]/30 bg-[#e8f5f1] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Check className="size-4 text-[#006d5a]" />
            <span className="text-sm font-semibold text-[#006d5a]">Ingesta completada</span>
          </div>
          <div className="flex gap-4 text-xs text-[#006d5a]">
            <span>{ingestDone.summary.recipes_created} recetas creadas</span>
            <span>{ingestDone.summary.ingredients_linked} ingredientes vinculados</span>
            <span>{ingestDone.summary.menu_items_linked} links FUDO</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5">
        {[
          { key: 'recetas' as const, label: 'Recetas', icon: BookOpen },
          { key: 'ingredientes' as const, label: 'Ingredientes', icon: Package },
          { key: 'fudo' as const, label: 'FUDO Bridge', icon: Link2 },
          { key: 'rendimiento' as const, label: 'Rendimiento', icon: TrendingDown },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all ${
              tab === t.key ? 'bg-[#006d5a] text-white' : 'bg-secondary text-muted-foreground'
            }`}
          >
            <t.icon className="size-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'recetas' && (
        <div className="space-y-2">
          {data.recipes.map(r => {
            const isExpanded = expandedRecipe === r.slug
            return (
              <div key={r.slug} className="rounded-xl border bg-card overflow-hidden">
                <button
                  onClick={() => setExpandedRecipe(isExpanded ? null : r.slug)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="text-lg">{CAT_EMOJI[r.categoria] ?? '📋'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#3d2c24]">{r.nombre}</p>
                    <p className="text-[10px] text-[#a39e97]">
                      {r.ingredientes_count} ing. · {r.variantes_count} var.
                      {r.is_base && ' · Base'}
                      {r.guarnicion && ` · Guarn: ${r.guarnicion}`}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                    r.estado === 'completa' ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#fdf6ec] text-[#d4943a]'
                  }`}>
                    {r.estado === 'completa' ? '✓' : '⚠'}
                  </span>
                  {isExpanded ? <ChevronUp className="size-3.5 text-[#a39e97]" /> : <ChevronDown className="size-3.5 text-[#a39e97]" />}
                </button>
                {isExpanded && (
                  <div className="border-t px-4 py-3 space-y-2">
                    {r.depends_on.length > 0 && (
                      <p className="text-[10px] text-[#d4943a]">
                        ⚡ Depende de: {r.depends_on.join(', ')}
                      </p>
                    )}
                    {/* Ingredients with match status */}
                    <div className="space-y-1">
                      {data.ingredients
                        .filter(i => i.recipe_slug === r.slug)
                        .map((ing, idx) => {
                          const mc = MATCH_COLORS[ing.stock_match.confidence] ?? MATCH_COLORS.sin_match
                          return (
                            <div key={idx} className="flex items-center justify-between rounded-lg bg-[#faf8f5] px-3 py-1.5">
                              <span className="text-xs text-[#3d2c24]">{ing.original_name}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${mc.bg} ${mc.text}`}>
                                {ing.stock_match.confidence === 'exacto' ? '✓ ' : ing.stock_match.confidence === 'sin_match' ? '✗ ' : '? '}
                                {ing.stock_match.suggested_stock_item_name ?? 'Sin match'}
                              </span>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Implicit sub-recipes */}
          <h3 className="section-label mt-4">Sub-recetas implícitas detectadas</h3>
          {data.implicit_sub_recipes.map(sr => (
            <div key={sr.slug} className="rounded-xl border border-dashed border-[#d4943a]/30 bg-[#fdf6ec]/30 px-4 py-3">
              <p className="text-xs font-semibold text-[#d4943a]">🧪 {sr.nombre}</p>
              <p className="mt-0.5 text-[10px] text-[#a39e97]">{sr.description}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'ingredientes' && (
        <div className="space-y-1.5">
          {data.ingredients.map((ing, idx) => {
            const mc = MATCH_COLORS[ing.stock_match.confidence] ?? MATCH_COLORS.sin_match
            return (
              <div key={idx} className="flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5">
                <div className={`size-2 shrink-0 rounded-full ${
                  ing.classification === 'atomico' ? 'bg-[#006d5a]'
                  : ing.classification === 'preparacion_base' ? 'bg-[#4a90d9]'
                  : ing.classification === 'ambiguo' ? 'bg-[#ea504c]'
                  : 'bg-[#a39e97]'
                }`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[#3d2c24] truncate">{ing.original_name}</p>
                  <p className="text-[10px] text-[#a39e97]">{ing.classification} · {ing.recipe_slug}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${mc.bg} ${mc.text}`}>
                  {ing.stock_match.confidence} {ing.stock_match.confidence_score > 0 ? `(${ing.stock_match.confidence_score})` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'fudo' && (
        <div className="space-y-1.5">
          {data.fudo_bridge.map(fb => (
            <div key={fb.recipe_slug} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5">
              <span className="text-lg">{CAT_EMOJI[data.recipes.find(r => r.slug === fb.recipe_slug)?.categoria ?? ''] ?? '📋'}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[#3d2c24]">{fb.recipe_name}</p>
              </div>
              {fb.fudo_match ? (
                <span className="rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[9px] font-semibold text-[#006d5a]">
                  ✓ {fb.fudo_match.name}
                </span>
              ) : (
                <span className="rounded-full bg-[#f3efe9] px-2 py-0.5 text-[9px] font-semibold text-[#a39e97]">
                  Sin match FUDO
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'rendimiento' && (
        <div className="space-y-3">
          {!yields ? (
            <button
              onClick={loadYields}
              disabled={loadingYields}
              className="w-full rounded-xl bg-[#006d5a] py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {loadingYields ? <Loader2 className="inline size-3.5 animate-spin mr-1" /> : null}
              {loadingYields ? 'Calculando...' : 'Calcular rendimiento con stock actual'}
            </button>
          ) : yields.length === 0 ? (
            <div className="rounded-xl bg-[#faf8f5] p-4 text-center">
              <p className="text-xs text-[#a39e97]">No hay recetas con ingredientes vinculados al stock.</p>
              <p className="mt-1 text-[10px] text-[#a39e97]">Ejecuta la ingesta primero.</p>
            </div>
          ) : (
            <StaggerList>
              {yields.map(y => {
                const color = y.max_portions <= 0 ? '#ea504c'
                  : y.max_portions < 5 ? '#d4943a'
                  : '#006d5a'
                return (
                  <StaggerItem key={y.recipe_id}>
                    <div className="rounded-xl border bg-card px-4 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#3d2c24]">{y.recipe_name}</span>
                        <span className="font-display text-lg font-bold" style={{ color }}>
                          {y.max_portions}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px]">
                        <span className="text-[#a39e97]">porciones posibles</span>
                        <span className="text-[#a39e97]">
                          Limitante: <span className="font-semibold text-[#3d2c24]">{y.limiting_item}</span>
                          {' '}({y.limiting_qty} disponible, necesita {y.limiting_need}/porción)
                        </span>
                      </div>
                    </div>
                  </StaggerItem>
                )
              })}
            </StaggerList>
          )}
        </div>
      )}

      <p className="text-center text-[9px] text-[#a39e97]">
        Corpus del chef · {data.stats.uniqueIngredients} ingredientes únicos
      </p>
    </FadeIn>
  )
}
