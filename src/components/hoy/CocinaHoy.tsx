'use client'

import Link from 'next/link'
import { ChevronRight, ClipboardCheck } from 'lucide-react'

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
