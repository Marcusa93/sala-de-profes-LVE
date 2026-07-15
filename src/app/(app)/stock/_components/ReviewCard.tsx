'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight, ShoppingCart } from 'lucide-react'
import type { StockItem } from '@/lib/hooks/use-stock'
import { getStockSource, formatQty, type StockReviewCard } from '@/lib/stock/helpers'

type Props = {
  card: StockReviewCard
  featured?: boolean
  onSync: () => void
  onCount: (item: StockItem) => void
  onConfigure: (itemId: string) => void
  onMap: () => void
  onWatch: () => void
}

export function ReviewCard({ card, featured: featuredProp, onSync, onCount, onConfigure, onMap, onWatch }: Props) {
  const router = useRouter()
  const featured = Boolean(featuredProp)
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
      onSync()
      return
    }
    if (card.primaryAction === 'count' && card.item) {
      onCount(card.item)
      return
    }
    if (card.primaryAction === 'configure' && card.item) {
      onConfigure(card.item.id)
      return
    }
    if (card.primaryAction === 'map') {
      onMap()
      return
    }
    if (card.primaryAction === 'watch') {
      onWatch()
      return
    }
    onSync()
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
        <div className="flex flex-col gap-1.5 sm:items-end">
          <button
            onClick={onPrimaryAction}
            className={`${featured ? 'rounded-2xl px-4 py-3 text-sm' : 'rounded-xl px-3 py-2 text-[11px]'} flex w-full shrink-0 items-center justify-center gap-1.5 bg-[#3d2c24] font-bold text-white transition-transform group-active:scale-[0.98] sm:w-auto`}
          >
            {card.actionLabel ?? actionLabel[card.primaryAction]}
            <ArrowRight className={featured ? 'size-4' : 'size-3.5'} />
          </button>
          {card.priority === 'critico' && card.primaryAction === 'count' && card.item && (
            <button
              onClick={() => router.push('/pedidos')}
              className={`${featured ? 'rounded-2xl px-4 py-3 text-sm' : 'rounded-xl px-3 py-2 text-[11px]'} flex w-full shrink-0 items-center justify-center gap-1.5 bg-[#fdf6ec] font-bold text-[#d4943a] ring-1 ring-[#f1dfba] transition-transform group-active:scale-[0.98] sm:w-auto`}
            >
              <ShoppingCart className={featured ? 'size-4' : 'size-3.5'} />
              Pedir
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
