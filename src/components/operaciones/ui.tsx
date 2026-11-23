'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Piezas chicas del control interno de operaciones
// ---------------------------------------------------------------------------

export type Tono = 'rojo' | 'ambar' | 'verde' | 'azul' | 'gris'

const TONOS: Record<Tono, string> = {
  rojo: 'bg-[#fef2f2] text-[#c8312c]',
  ambar: 'bg-[#fdf3e3] text-[#9a6418]',
  verde: 'bg-[#e8f5f1] text-[#006d5a]',
  azul: 'bg-[#eaf1fb] text-[#2f5fa0]',
  gris: 'bg-[#f3efe9] text-[#7d6c64]',
}

export function Chip({ tono = 'gris', children }: { tono?: Tono; children: ReactNode }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold', TONOS[tono])}>{children}</span>
}

export function Progreso({ hechos, total, texto }: { hechos: number; total: number; texto?: string }) {
  const p = total ? Math.round((hechos / total) * 100) : 0
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-[#7d6c64]">{texto ?? `${hechos} de ${total}${total ? ` · ${p} %` : ''}`}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#ebe6df]">
        <span className="block h-full rounded-full bg-[#006d5a] transition-[width] duration-300" style={{ width: `${p}%` }} />
      </span>
    </div>
  )
}

export function Kpi({ k, v, sub, frac }: { k: string; v: string; sub?: string; frac?: number | null }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#a39e97]">{k}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-[#3d2c24]">{v}</p>
      {sub && <p className="text-[11px] leading-snug text-[#7d6c64]">{sub}</p>}
      {frac != null && (
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#ebe6df]">
          <span className="block h-full rounded-full bg-[#006d5a]" style={{ width: `${Math.max(0, Math.min(100, frac))}%` }} />
        </span>
      )}
    </div>
  )
}

export function Pills<T extends string>({ opciones, valor, onCambiar, disabled, etiqueta }: {
  opciones: { v: T; label: string }[]
  valor: T
  onCambiar: (v: T) => void
  disabled?: boolean
  etiqueta?: string
}) {
  return (
    <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-1.5">
      {opciones.map((o) => (
        <button
          key={o.v || 'vacio'}
          type="button"
          disabled={disabled}
          aria-pressed={o.v === valor}
          onClick={() => onCambiar(o.v)}
          className={cn(
            'rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors active:scale-95 disabled:opacity-60',
            o.v === valor ? 'bg-[#006d5a] text-white' : 'bg-[#f3efe9] text-[#3d2c24] hover:bg-[#ebe6df]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Vacio({ children, ok }: { children: ReactNode; ok?: boolean }) {
  return (
    <p className={cn('rounded-2xl px-4 py-5 text-center text-[12.5px] ring-1', ok ? 'bg-[#f2f9f6] text-[#006d5a] ring-[#cfe4dd]' : 'bg-white text-[#a39e97] ring-[#ebe6df]')}>
      {children}
    </p>
  )
}

export const inputCls = 'w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none disabled:bg-[#faf8f5]'
