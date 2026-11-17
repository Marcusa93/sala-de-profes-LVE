'use client'

import Link from 'next/link'
import { ChevronRight, ClipboardCheck, ClipboardList, Hammer } from 'lucide-react'

// ---------------------------------------------------------------------------
// Hoy → «Lo de hoy · Cocina» (jefa de cocina, encargados y socios)
// ---------------------------------------------------------------------------

export function CocinaHoy() {
  return (
    <Link
      href="/cocina/lo-de-hoy?from=hoy"
      className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3.5 ring-1 ring-[#ebe6df] active:scale-[0.99]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f5f1]">
          <ClipboardCheck className="size-4 text-[#006d5a]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#3d2c24]">Lo de hoy · Cocina</p>
          <p className="truncate text-xs text-[#a39e97]">Confirmar producción, conteo de cierre y merma</p>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-[#d1cdc7]" />
    </Link>
  )
}

// Hoy → «Qué producir» (encargado de producción y el resto de la cocina)
export function ProducirHoy() {
  return (
    <Link
      href="/cocina/a-producir?from=hoy"
      className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3.5 ring-1 ring-[#ebe6df] active:scale-[0.99]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f5f1]">
          <Hammer className="size-4 text-[#006d5a]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#3d2c24]">Qué producir</p>
          <p className="truncate text-xs text-[#a39e97]">Lo que falta para el mínimo en Santa Fe y en la 24</p>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-[#d1cdc7]" />
    </Link>
  )
}

// Hoy → «Parte de cierre» (lo que se produjo en la noche)
export function ParteHoy() {
  return (
    <Link
      href="/cocina/parte?from=hoy"
      className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3.5 ring-1 ring-[#ebe6df] active:scale-[0.99]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f5f1]">
          <ClipboardList className="size-4 text-[#006d5a]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#3d2c24]">Parte de cierre</p>
          <p className="truncate text-xs text-[#a39e97]">Kilos, porciones, desperdicio y rendimiento de la noche</p>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-[#d1cdc7]" />
    </Link>
  )
}
