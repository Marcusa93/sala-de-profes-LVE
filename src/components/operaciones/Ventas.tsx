'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { corta, DIAS, dinero, dow } from '@/lib/operaciones/fechas'
import type { AnalisisVentas } from '@/lib/operaciones/alertas'
import type { VentasOperaciones } from '@/lib/operaciones/tipos'

// ---------------------------------------------------------------------------
// Ventas de ayer en Santa Fe contra el promedio del mismo día
// ---------------------------------------------------------------------------

export function TabVentas({ ventas, analisis, cargando }: { ventas: VentasOperaciones | undefined; analisis: AnalisisVentas | null; cargando: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-snug text-[#7d6c64]">Ventas cerradas de ayer en Fudo contra el promedio del mismo día de la semana en las 4 semanas anteriores.</p>
      <section className="rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
        <p className="text-[13px] font-bold text-[#3d2c24]">Santa Fe</p>
        {cargando && !ventas ? (
          <p className="mt-3 flex items-center gap-2 text-[12px] text-[#a39e97]"><Loader2 className="size-3.5 animate-spin" /> Trayendo las ventas de Fudo…</p>
        ) : ventas?.error ? (
          <p className="mt-2 text-[12px] text-[#c8312c]">{ventas.error}</p>
        ) : !analisis ? (
          <p className="mt-2 text-[12px] text-[#a39e97]">Sin datos de ventas.</p>
        ) : (
          <Detalle a={analisis} />
        )}
      </section>
      <p className="text-[11px] leading-snug text-[#a39e97]">Alerta ámbar si ayer vendió menos del 75 % del promedio; roja si no hay ventas cerradas en Fudo. El día va de 6 a 6, igual que en Ventas.</p>
    </div>
  )
}

function Detalle({ a }: { a: AnalisisVentas }) {
  const dv = a.ratio !== null ? (a.ratio - 1) * 100 : null
  const filas: [string, string, string?][] = [
    ['Tickets', String(a.tickets)],
    ['Ticket promedio', a.tickets ? dinero(a.total / a.tickets) : '—'],
  ]
  if (a.promedio) {
    filas.push([`Promedio ${DIAS[dow(a.ayer)].toLowerCase()}s (${a.n})`, dinero(a.promedio)])
    filas.push(['Contra el promedio', `${dv! >= 0 ? '+' : ''}${Math.round(dv!)} %`, dv! >= 0 ? 'text-[#006d5a]' : a.ratio! < 0.75 ? 'text-[#c8312c]' : 'text-[#9a6418]'])
  }
  filas.push(['Últimos 7 días', dinero(a.ultimos7)])
  return (
    <>
      <p className="mt-0.5 text-[11.5px] text-[#7d6c64]">{DIAS[dow(a.ayer)]} {corta(a.ayer)}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-[#3d2c24]">{dinero(a.total)}</p>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[12.5px]">
        {filas.map(([k, v, c]) => (
          <div key={k} className="contents">
            <dt className="text-[#7d6c64]">{k}</dt>
            <dd className={cn('text-right font-bold tabular-nums text-[#3d2c24]', c)}>{v}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
