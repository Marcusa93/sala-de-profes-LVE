'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ChevronRight, Truck } from 'lucide-react'

// ---------------------------------------------------------------------------
// Hoy → «Enviar a la 24»: acceso directo con lo que todavía no llegó
// ---------------------------------------------------------------------------

type Resumen = { en_camino: number; pendientes: number }

async function fetcher(url: string): Promise<Resumen | null> {
  const r = await fetch(url)
  if (!r.ok) return null
  return (await r.json().catch(() => null)) as Resumen | null
}

export function EnviosA24Hoy() {
  const { data } = useSWR('/api/envios/salientes?resumen=1', fetcher, { revalidateOnFocus: false })
  const enCamino = data?.en_camino ?? 0
  const pendientes = data?.pendientes ?? 0
  const detalle = [
    enCamino > 0 ? `${enCamino} en camino` : null,
    pendientes > 0 ? `${pendientes} sin poder mandarse todavía` : null,
  ].filter(Boolean).join(' · ')

  return (
    <Link
      href="/cocina/envios?from=hoy"
      className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3.5 ring-1 ring-[#ebe6df] active:scale-[0.99]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f5f1]">
          <Truck className="size-4 text-[#006d5a]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#3d2c24]">Enviar a la 24</p>
          <p className={`truncate text-xs ${pendientes > 0 ? 'text-[#b0762a]' : 'text-[#a39e97]'}`}>
            {detalle || 'Mandar producción a la otra sucursal'}
          </p>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-[#d1cdc7]" />
    </Link>
  )
}
