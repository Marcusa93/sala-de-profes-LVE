'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChefHat, ChevronDown, ChevronUp, Hammer, Loader2, RefreshCw, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isKitchenRole } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { BackToHoy } from '@/components/layout/BackToHoy'
import { LoadingState } from '@/components/ui/LoadingState'
import { LoHiceDialog } from '@/components/produccion/LoHiceDialog'
import type { ElaboradosPayload } from '@/lib/produccion/elaborados'
import type { AProducir, ItemAProducir } from '@/lib/produccion/a-producir'

// ---------------------------------------------------------------------------
// Qué producir — la pantalla del encargado de producción (punto 3)
// ---------------------------------------------------------------------------
// Por cada producto de la lista: lo que falta para el mínimo de Santa Fe más
// lo que le falta a la 24, menos lo ya cargado sin confirmar. Lo completo no
// aparece. Cada uno con «Lo hice»; abajo, el envío a la 24 ya armado.
// ---------------------------------------------------------------------------

const TZ = 'America/Argentina/Buenos_Aires'
const URL = '/api/produccion/a-producir'

async function fetcher(url: string): Promise<AProducir> {
  const r = await fetch(url)
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw new Error(j?.error ?? 'No se pudo cargar')
  return j as AProducir
}

const num = (n: number) => Number(n.toFixed(3)).toLocaleString('es-AR')
const cuando = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

const TEXTO_24: Record<ItemAProducir['estado_24'], string | null> = {
  ok: null,
  no_va: null,
  sin_minimo: 'la 24 no tiene mínimo cargado',
  no_vinculado: 'la 24 todavía no eligió este producto',
  otra_unidad: 'la 24 lo cuenta en otra unidad',
  sin_dato: 'la 24 no tiene dato de este producto',
  sin_conexion: 'no se pudo ver el stock de la 24',
}

export default function QueProducirPage() {
  const { profile, loading: cargandoPerfil } = useProfileContext()
  const puede = isKitchenRole(profile?.role)
  const { data, error, isLoading, isValidating, mutate } = useSWR(puede ? URL : null, fetcher, { revalidateOnFocus: true, keepPreviousData: true })
  const [loHice, setLoHice] = useState<{ payload: ElaboradosPayload; sugerido: number } | null>(null)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [verCompletos, setVerCompletos] = useState(false)

  if (cargandoPerfil) return <LoadingState />
  if (!puede) return <p className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-[#7d6c64]">Esta pantalla es de cocina, chef, encargados y socios.</p>
  if (isLoading && !data) return <LoadingState message="Calculando qué falta…" />
  if (error && !data) return <p className="mx-auto max-w-lg rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#ea504c]">{error.message}</p>
  if (!data) return <LoadingState />

  async function abrirLoHice(item: ItemAProducir) {
    setAbriendo(item.stock_item_id)
    try {
      const r = await fetch(`/api/produccion/elaborados?item=${item.stock_item_id}`)
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.elaborados?.length) {
        toast.error(r.status === 404 ? `${item.nombre} no figura como elaborado: cargale la receta en Elaborados` : (j?.error ?? 'No se pudo abrir «Lo hice»'))
        return
      }
      setLoHice({ payload: j as ElaboradosPayload, sugerido: item.producir })
    } finally {
      setAbriendo(null)
    }
  }

  const paraLa24 = data.items.filter((i) => i.falta_24 > 0)
  const linkEnvio = `/cocina/envios?items=${paraLa24.map((i) => `${i.stock_item_id}:${Math.ceil(i.falta_24 * 1000) / 1000}`).join(',')}`
  const cierre = data.la_24?.ok ? data.la_24.conteo_cierre : null

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-32">
      <BackToHoy />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[#006d5a]/10">
            <Hammer className="size-4 text-[#006d5a]" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-[#3d2c24]">Qué producir</h1>
            <p className="text-[12px] text-[#7d6c64]">Lo que falta para el mínimo en Santa Fe y en la 24</p>
          </div>
        </div>
        <button onClick={() => void mutate()} disabled={isValidating} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[#3d2c24] ring-1 ring-[#ebe6df] active:scale-95 disabled:opacity-50" aria-label="Actualizar">
          {isValidating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </button>
      </div>

      {/* Estado de la 24 */}
      {data.la_24 && !data.la_24.ok && (
        <p className="flex items-start gap-1 rounded-xl bg-[#fdf6ec] px-3 py-2 text-[11.5px] text-[#b0762a]"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> No se pudo ver el stock de la 24 ({data.la_24.error}): por ahora se cuenta solo lo de Santa Fe.</p>
      )}
      {cierre && (
        <p className={cn('rounded-xl px-3 py-2 text-[11.5px]', cierre.hecho_hoy ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#f3efe9] text-[#7d6c64]')}>
          {cierre.hecho_hoy && cierre.ultimo
            ? `La 24 contó hoy a las ${hora(cierre.ultimo.hora)}${cierre.ultimo.quien ? ` (${cierre.ultimo.quien})` : ''}.`
            : `La 24 todavía no contó hoy${cierre.ultimo ? ` (último: ${cuando(cierre.ultimo.hora)})` : ''}: lo de la 24 puede estar desactualizado.`}
        </p>
      )}

      {data.falta_migracion || (data.items.length === 0 && data.completos.length === 0 && data.sin_minimo.length === 0) ? (
        <p className="rounded-2xl bg-white px-4 py-6 text-center text-[12.5px] text-[#7d6c64] ring-1 ring-[#ebe6df]">
          Todavía no hay lista de producción: la cargan los socios en <Link href="/cocina/lista" className="font-semibold text-[#006d5a] underline">Lista y mínimos</Link>.
        </p>
      ) : data.items.length === 0 ? (
        <p className="flex items-center justify-center gap-1.5 rounded-2xl bg-[#e8f5f1] px-4 py-6 text-[13px] font-semibold text-[#006d5a]"><Check className="size-4" /> Está todo en el mínimo, acá y en la 24.</p>
      ) : (
        <section className="space-y-2">
          {data.items.map((i) => (
            <ItemCard key={i.stock_item_id} item={i} abriendo={abriendo === i.stock_item_id} onLoHice={() => void abrirLoHice(i)} />
          ))}
        </section>
      )}

      {(data.completos.length > 0 || data.sin_minimo.length > 0) && (
        <section className="rounded-2xl bg-white ring-1 ring-[#ebe6df]">
          <button type="button" onClick={() => setVerCompletos((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="text-[12.5px] font-semibold text-[#3d2c24]">
              <Check className="mr-1 inline size-3.5 text-[#006d5a]" />{data.completos.length} completo{data.completos.length === 1 ? '' : 's'}
              {data.sin_minimo.length > 0 && <span className="font-normal text-[#a39e97]"> · {data.sin_minimo.length} sin mínimo</span>}
            </span>
            {verCompletos ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
          </button>
          {verCompletos && (
            <div className="space-y-1.5 border-t border-[#f3efe9] px-4 py-3 text-[12px]">
              {data.completos.length > 0 && <p className="text-[#3d2c24]">{data.completos.map((c) => c.nombre).join(' · ')}</p>}
              {data.sin_minimo.length > 0 && <p className="text-[#a39e97]">Sin mínimo cargado: {data.sin_minimo.map((c) => c.nombre).join(' · ')}</p>}
            </div>
          )}
        </section>
      )}

      {/* El envío a la 24, ya armado con lo que le falta */}
      {paraLa24.length > 0 && (
        <section className="space-y-2 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#3d2c24]"><Truck className="size-4 text-[#006d5a]" /> Para mandar a la 24</p>
          <ul className="space-y-0.5 text-[12.5px] text-[#3d2c24]">
            {paraLa24.map((i) => <li key={i.stock_item_id}><b className="tabular-nums">{num(i.falta_24)} {i.unidad}</b> · {i.nombre}</li>)}
          </ul>
          <Link href={linkEnvio} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-3 text-[14px] font-bold text-white active:scale-[0.99]">
            <Truck className="size-4" /> Armar envío a la 24
          </Link>
          <p className="text-[10.5px] text-[#a39e97]">Se abre «Enviar a la 24» con esto cargado: revisá las cantidades antes de mandar.</p>
        </section>
      )}

      {loHice && (
        <LoHiceDialog
          elaborado={loHice.payload.elaborados[0]}
          puedeCerrar={loHice.payload.permisos.cerrar_produccion}
          sugerido={loHice.sugerido}
          onClose={() => setLoHice(null)}
          onDone={() => { setLoHice(null); void mutate() }}
        />
      )}
    </div>
  )
}

function ItemCard({ item: i, abriendo, onLoHice }: { item: ItemAProducir; abriendo: boolean; onLoHice: () => void }) {
  const aviso24 = TEXTO_24[i.estado_24]
  return (
    <div className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-[#3d2c24]">{i.nombre}</p>
          <p className="mt-0.5 text-[22px] font-bold leading-tight text-[#006d5a] tabular-nums">{num(i.producir)} <span className="text-[13px] font-semibold">{i.unidad}</span></p>
        </div>
        <button type="button" onClick={onLoHice} disabled={abriendo} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#006d5a] px-4 py-3 text-[13px] font-bold text-white active:scale-95 disabled:opacity-60">
          {abriendo ? <Loader2 className="size-4 animate-spin" /> : <ChefHat className="size-4" />} Lo hice
        </button>
      </div>

      <div className="mt-2 space-y-0.5 text-[11.5px] text-[#7d6c64]">
        {i.minimo_sf > 0 && (
          <p>
            <b className="text-[#3d2c24]">Santa Fe:</b> hay {i.stock_negativo ? <span className="text-[#ea504c]">{num(i.stock_sf)} (falta contar)</span> : num(i.stock_sf)} de {num(i.minimo_sf)}
            {i.falta_sf > 0 ? <> → faltan <b className="text-[#3d2c24]">{num(i.falta_sf)}</b></> : ' ✓'}
          </p>
        )}
        {i.va_a_la_24 && i.estado_24 === 'ok' && (
          <p>
            <b className="text-[#3d2c24]">La 24:</b> hay {i.stock_24 != null ? num(i.stock_24) : '?'} de {num(i.minimo_24 ?? 0)}
            {i.en_camino_24 > 0 && <> ({num(i.en_camino_24)} en camino)</>}
            {i.falta_24 > 0 ? <> → faltan <b className="text-[#3d2c24]">{num(i.falta_24)}</b></> : ' ✓'}
          </p>
        )}
        {i.va_a_la_24 && aviso24 && <p className="text-[#b0762a]">La 24: {aviso24}</p>}
        {i.en_espera > 0 && <p>Ya cargado sin confirmar: {num(i.en_espera)} {i.unidad} (se descontó)</p>}
        {i.stock_negativo && <p className="text-[#ea504c]">La app da negativo: se toma como 0 hasta que se cuente.</p>}
      </div>
    </div>
  )
}
