'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, BookOpen, Check, AlertTriangle, HelpCircle,
  ChevronDown, ChevronUp, Package, Truck, Link2,
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

export default function CorpusPage() {
  const [data, setData] = useState<CorpusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'recetas' | 'ingredientes' | 'fudo'>('recetas')
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/recipes/ingest')
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

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

      {/* Tabs */}
      <div className="flex gap-1.5">
        {[
          { key: 'recetas' as const, label: 'Recetas', icon: BookOpen },
          { key: 'ingredientes' as const, label: 'Ingredientes', icon: Package },
          { key: 'fudo' as const, label: 'FUDO Bridge', icon: Link2 },
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

      <p className="text-center text-[9px] text-[#a39e97]">
        Corpus del chef · {data.stats.uniqueIngredients} ingredientes únicos · Descuento automático NO activado
      </p>
    </FadeIn>
  )
}
