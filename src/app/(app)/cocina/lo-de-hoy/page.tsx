'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChefHat, ClipboardCheck, Loader2, Package, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { coincideBusqueda } from '@/lib/buscar'
import { BackToHoy } from '@/components/layout/BackToHoy'
import { LoadingState } from '@/components/ui/LoadingState'
import type { InsumoEnviable } from '@/lib/envios/salientes'
import type { DatosLoDeHoy, ProduccionAConfirmar, ProduccionRevisada } from '@/lib/produccion/lo-de-hoy'
import { avisoQuedoNegativo, leerFaltantes, textoFaltante, type Faltante } from '@/lib/produccion/faltantes'

// ---------------------------------------------------------------------------
// Lo de hoy · Cocina — la pantalla de la jefa de cocina (punto 2)
// ---------------------------------------------------------------------------
// 1. Confirmar lo que producción cargó con «Lo hice»: está todo, falta algo
//    (se corrige cuánto hay) o no está (se rechaza con el motivo).
// 2. Conteo de cierre de la lista de producción, rápido y desde el celular.
// 3. Merma: vencido, mal guardado o consumo del personal.
// Se puede contar y confirmar en cualquier orden: si un producto se contó
// después de cargar la producción, al confirmarla no se vuelve a sumar.
// ---------------------------------------------------------------------------

const TZ = 'America/Argentina/Buenos_Aires'
const URL = '/api/produccion/lo-de-hoy?insumos=1'
const ROLES = ['socio', 'encargado', 'chef']

type Datos = DatosLoDeHoy & { insumos?: InsumoEnviable[] }

const MOTIVOS = [
  { value: 'vencido', label: 'Vencido' },
  { value: 'mal_guardado', label: 'Mal guardado' },
  { value: 'consumo_interno', label: 'Consumo del personal' },
  { value: 'otro', label: 'Otro' },
] as const

async function fetcher(url: string): Promise<Datos> {
  const r = await fetch(url)
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw new Error(j?.error ?? 'No se pudo cargar')
  return j as Datos
}

async function pedir(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => null)
  return { ok: r.ok, j: j as Record<string, unknown> | null }
}

const num = (n: number) => Number(n.toFixed(3)).toLocaleString('es-AR')
const leer = (s: string) => {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}
const cuando = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

export default function LoDeHoyCocinaPage() {
  const { profile, loading: cargandoPerfil } = useProfileContext()
  const puede = !!profile && ROLES.includes(profile.role)
  const { data, error, isLoading, mutate } = useSWR(puede ? URL : null, fetcher, { revalidateOnFocus: true, keepPreviousData: true })

  if (cargandoPerfil) return <LoadingState />
  if (!puede) return <p className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-[#7d6c64]">Esta pantalla es de la jefa de cocina, encargados y socios.</p>
  if (isLoading && !data) return <LoadingState />
  if (error && !data) return <p className="mx-auto max-w-lg rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#ea504c]">{error.message}</p>
  if (!data) return <LoadingState />

  const nombreYo = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Cocina'
  const recargar = () => void mutate()

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-32">
      <BackToHoy />

      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-[#006d5a]/10">
          <ChefHat className="size-4 text-[#006d5a]" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-[#3d2c24]">Lo de hoy · Cocina</h1>
          <p className="text-[12px] text-[#7d6c64]">Confirmar producción, contar y cargar merma</p>
        </div>
      </div>

      <Paso n={1} titulo="Confirmar producción" detalle="Lo que cargó producción con «Lo hice»: ¿está en la heladera?">
        {data.a_confirmar.length === 0 ? (
          <p className="flex items-center gap-1.5 rounded-2xl bg-white px-4 py-3.5 text-[12.5px] text-[#006d5a] ring-1 ring-[#ebe6df]"><Check className="size-4" /> No hay producción para confirmar.</p>
        ) : (
          data.a_confirmar.map((o) => <ConfirmarProduccion key={o.id} orden={o} nombreYo={nombreYo} onListo={recargar} />)
        )}
        {data.viejas_sin_confirmar > 0 && (
          <p className="px-1 text-[11px] text-[#a39e97]">Hay {data.viejas_sin_confirmar} producción{data.viejas_sin_confirmar === 1 ? '' : 'es'} vieja{data.viejas_sin_confirmar === 1 ? '' : 's'} sin confirmar: la{data.viejas_sin_confirmar === 1 ? '' : 's'} revisa un encargado en Stock → Producción.</p>
        )}
        {(data.revisadas ?? []).length > 0 && <Revisadas lista={data.revisadas} />}
      </Paso>

      <Paso n={2} titulo="Conteo de cierre" detalle="Lo que hay de verdad, producto por producto">
        <ConteoCierre datos={data} onListo={recargar} />
      </Paso>

      <Paso n={3} titulo="Merma" detalle="Lo que se tira (vencido, mal guardado) y el consumo del personal">
        <CargarMerma datos={data} onListo={recargar} />
      </Paso>
    </div>
  )
}

function Paso({ n, titulo, detalle, children }: { n: number; titulo: string; detalle: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-start gap-2 px-1">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#006d5a] text-[11px] font-bold text-white">{n}</span>
        <div>
          <h2 className="text-[14px] font-bold text-[#3d2c24]">{titulo}</h2>
          <p className="text-[11.5px] text-[#7d6c64]">{detalle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 1. Confirmar una producción
// ---------------------------------------------------------------------------

function ConfirmarProduccion({ orden: o, nombreYo, onListo }: { orden: ProduccionAConfirmar; nombreYo: string; onListo: () => void }) {
  const [modo, setModo] = useState<'ver' | 'falta' | 'no_esta'>('ver')
  const [reales, setReales] = useState<Record<number, string>>(() => Object.fromEntries(o.salidas.map((s) => [s.id, String(s.cantidad).replace('.', ',')])))
  const [motivo, setMotivo] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // En la app figura menos stock de un insumo que lo usado: se muestra y se puede confirmar igual
  const [faltantes, setFaltantes] = useState<Faltante[]>([])
  const contadoDespues = o.salidas.filter((s) => s.contado_despues)

  /** Cierra la producción. Devuelve false si no se pudo (el motivo queda en pantalla). */
  async function completar(permitirFaltante: boolean): Promise<boolean> {
    const r = await pedir(`/api/produccion/orders/${o.id}/complete`, 'POST', permitirFaltante ? { permitir_faltante: true } : {})
    if (!r.ok || r.j?.success === false) {
      const lista = r.j?.code === 'stock_insuficiente' ? leerFaltantes(r.j) : []
      if (lista.length > 0) { setFaltantes(lista); return false }
      const msg = String(r.j?.error ?? 'No se pudo confirmar')
      setError(/insuficiente/i.test(msg)
        ? `${msg}. El stock de esa materia prima en la app está por debajo de lo que se usó: contala (o que carguen la compra en Fudo) y confirmá de nuevo.`
        : msg)
      return false
    }
    const yaContados = Array.isArray(r.j?.ya_contados) ? (r.j.ya_contados as string[]) : []
    toast.success(`Confirmada: ${o.nombre}${yaContados.length ? ` (${yaContados.join(', ')} ya estaba en el conteo: no se sumó de nuevo)` : ''}`)
    const quedaronNegativos = leerFaltantes(r.j)
    if (quedaronNegativos.length > 0) toast.info(avisoQuedoNegativo(quedaronNegativos))
    onListo()
    return true
  }

  async function confirmarIgual() {
    setTrabajando(true)
    setError(null)
    try {
      if (await completar(true)) setFaltantes([])
    } finally {
      setTrabajando(false)
    }
  }

  async function confirmar(corregir: boolean) {
    setTrabajando(true)
    setError(null)
    setFaltantes([])
    try {
      if (corregir) {
        const cambios: string[] = []
        for (const s of o.salidas) {
          const real = leer(reales[s.id] ?? '')
          if (real == null || Number.isNaN(real)) { setError(`Poné cuánto hay de ${s.nombre}`); return }
          if (Math.abs(real - s.cantidad) < 0.0005) continue
          const r = await pedir(`/api/produccion/orders/${o.id}`, 'PATCH', { action: 'upd_output', output_id: s.id, qty_produced: real })
          if (!r.ok) { setError(String(r.j?.error ?? `No se pudo corregir ${s.nombre}`)); return }
          cambios.push(`${s.nombre} ${num(real)} de ${num(s.cantidad)}`)
        }
        if (cambios.length) {
          await pedir(`/api/produccion/orders/${o.id}`, 'PATCH', { action: 'update', notes: `${o.nota ? `${o.nota} · ` : ''}Confirmó ${nombreYo}: faltaba (${cambios.join('; ')})`.slice(0, 1000) })
        }
      }
      await completar(false)
    } finally {
      setTrabajando(false)
    }
  }

  async function rechazar() {
    if (motivo.trim().length < 3) { setError('Escribí qué pasó (ej. "no está en la heladera")'); return }
    setTrabajando(true)
    setError(null)
    try {
      const r = await pedir(`/api/produccion/orders/${o.id}/reject`, 'POST', { motivo: motivo.trim() })
      if (!r.ok) { setError(String(r.j?.error ?? 'No se pudo marcar')); return }
      toast.success('Marcada como que no está')
      onListo()
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
      <p className="text-[13px] font-bold text-[#3d2c24]">{o.nombre}</p>
      <p className="text-[11px] capitalize text-[#a39e97]">{o.quien ? `Cargó ${o.quien}` : 'Producción'} · {cuando(o.cargada_at)}</p>

      <ul className="mt-2 space-y-1.5">
        {o.salidas.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[13px] text-[#3d2c24]"><b className="tabular-nums">{num(s.cantidad)} {s.unidad}</b> · {s.nombre}</span>
            {modo === 'falta' && (
              <span className="flex shrink-0 items-center gap-1">
                <span className="text-[10.5px] text-[#7d6c64]">hay</span>
                <input
                  value={reales[s.id] ?? ''}
                  onChange={(e) => setReales((r) => ({ ...r, [s.id]: e.target.value }))}
                  inputMode="decimal"
                  aria-label={`Cuánto hay de ${s.nombre}`}
                  className="w-20 rounded-xl border border-[#ebe6df] px-2.5 py-2 text-right text-[15px] tabular-nums focus:border-[#006d5a] focus:outline-none"
                />
              </span>
            )}
          </li>
        ))}
      </ul>
      {o.crudos.length > 0 && (
        <p className="mt-1.5 text-[10.5px] text-[#a39e97]">Usó: {o.crudos.slice(0, 4).map((c) => `${num(c.cantidad)} ${c.unidad} ${c.nombre}`).join(', ')}{o.crudos.length > 4 ? ` y ${o.crudos.length - 4} más` : ''}</p>
      )}
      {o.nota && <p className="mt-1 text-[11px] italic text-[#7d6c64]">«{o.nota}»</p>}
      {o.cambio_nota && <p className="mt-2 flex items-start gap-1 rounded-lg bg-[#fdf6ec] px-2 py-1.5 text-[11px] text-[#b0762a]"><RotateCcw className="mt-0.5 size-3 shrink-0" /> {o.cambio_nota}</p>}
      {o.problema && <p className="mt-2 flex items-start gap-1 rounded-lg bg-[#fdf6ec] px-2 py-1.5 text-[11px] text-[#b0762a]"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> No se pudo cerrar sola: {o.problema}</p>}
      {contadoDespues.length > 0 && (
        <p className="mt-2 rounded-lg bg-[#f3efe9] px-2 py-1.5 text-[11px] text-[#7d6c64]">
          {contadoDespues.map((s) => s.nombre).join(', ')} ya se contó después de cargar esta producción: al confirmarla queda registrada, pero no se vuelve a sumar (el conteo ya la incluye).
        </p>
      )}
      {error && <p className="mt-2 rounded-lg bg-[#fef2f2] px-2 py-1.5 text-[11.5px] text-[#ea504c]">{error}</p>}
      {faltantes.length > 0 && (
        <div className="mt-2 space-y-2 rounded-xl bg-[#fdf6ec] p-2.5 text-[11.5px] text-[#8a5a1c] ring-1 ring-[#f1dcb8]">
          <p className="flex items-start gap-1 font-semibold"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> Falta stock en la app:</p>
          <ul className="space-y-0.5 pl-4">
            {faltantes.map((f) => <li key={f.stock_item_id} className="list-disc">{textoFaltante(f)}</li>)}
          </ul>
          <p>Si entró mercadería y no se cargó la compra, confirmala igual: ese insumo queda en negativo hasta que carguen la compra en Fudo. Si algún número está mal cargado, tocá «No está» y contá qué pasó.</p>
          <button type="button" onClick={() => void confirmarIgual()} disabled={trabajando} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#b0762a] py-2.5 text-[13px] font-bold text-white active:scale-[0.98] disabled:opacity-60">
            {trabajando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Confirmar igual
          </button>
        </div>
      )}

      {!o.puede_confirmar ? (
        <p className="mt-3 rounded-xl bg-[#f3efe9] px-3 py-2 text-[11.5px] text-[#7d6c64]">{o.es_mia ? 'La cargaste vos: la confirma otra persona.' : 'La confirman la jefa de cocina, un encargado o un socio.'}</p>
      ) : modo === 'ver' ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => void confirmar(false)} disabled={trabajando} className="col-span-3 flex items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-3 text-[14px] font-bold text-white active:scale-[0.98] disabled:opacity-60">
            {trabajando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Está todo
          </button>
          <button type="button" onClick={() => setModo('falta')} disabled={trabajando} className="col-span-2 rounded-xl bg-[#fdf6ec] py-2.5 text-[13px] font-semibold text-[#b0762a] ring-1 ring-[#f1dcb8]">Falta algo</button>
          <button type="button" onClick={() => setModo('no_esta')} disabled={trabajando} className="rounded-xl bg-white py-2.5 text-[13px] font-semibold text-[#ea504c] ring-1 ring-[#f5c6c4]">No está</button>
        </div>
      ) : modo === 'falta' ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => { setModo('ver'); setError(null) }} disabled={trabajando} className="rounded-xl bg-[#f3efe9] px-4 py-2.5 text-[13px] font-semibold text-[#7d6c64]">Volver</button>
          <button type="button" onClick={() => void confirmar(true)} disabled={trabajando} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-2.5 text-[13px] font-bold text-white disabled:opacity-60">
            {trabajando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Confirmar con lo que hay
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="¿Qué pasó? (ej. no está en la heladera)" className="w-full resize-none rounded-xl border border-[#e6dfd7] px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setModo('ver'); setError(null) }} disabled={trabajando} className="rounded-xl bg-[#f3efe9] px-4 py-2.5 text-[13px] font-semibold text-[#7d6c64]">Volver</button>
            <button type="button" onClick={() => void rechazar()} disabled={trabajando} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#ea504c] py-2.5 text-[13px] font-bold text-white disabled:opacity-60">
              {trabajando ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} No está
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Confirmadas o rechazadas hace poco: se pueden cambiar en el detalle (hasta 2 días) */
function Revisadas({ lista }: { lista: ProduccionRevisada[] }) {
  return (
    <details className="rounded-2xl bg-white px-4 py-3 ring-1 ring-[#ebe6df]">
      <summary className="cursor-pointer text-[12.5px] font-semibold text-[#7d6c64]">
        ¿Confirmaste o rechazaste algo por error? ({lista.length})
      </summary>
      <p className="mt-2 text-[11px] text-[#a39e97]">Se puede cambiar hasta 2 días después. Tocá la producción y usá «Deshacer validación» o «Volver a abrir».</p>
      <ul className="mt-2 divide-y divide-[#f3efe9]">
        {lista.map((r) => (
          <li key={r.id}>
            <Link href={`/cocina/produccion/${r.id}`} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-[#3d2c24]">{r.nombre}</span>
                <span className="block text-[10.5px] capitalize text-[#a39e97]">
                  {r.cambio === 'deshacer' ? 'Confirmada' : 'Rechazada'}{r.cuando ? ` · ${cuando(r.cuando)}` : ''}{r.quien_reviso ? ` · ${r.quien_reviso}` : ''}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-[#b0762a]">
                <RotateCcw className="size-3" />{r.cambio === 'deshacer' ? 'Deshacer' : 'Abrir'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}

// ---------------------------------------------------------------------------
// 2. Conteo de cierre
// ---------------------------------------------------------------------------

function ConteoCierre({ datos, onListo }: { datos: Datos; onListo: () => void }) {
  const [valores, setValores] = useState<Record<string, string>>({})
  const [comentario, setComentario] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [conErrores, setConErrores] = useState<Record<string, string>>({})

  const cargados = datos.lista.filter((p) => (valores[p.stock_item_id] ?? '').trim() !== '')
  const invalidos = cargados.filter((p) => Number.isNaN(leer(valores[p.stock_item_id])))
  const contadosHoy = datos.lista.filter((p) => p.contado_hoy).length

  if (datos.falta_migracion || datos.lista.length === 0) {
    return (
      <p className="rounded-2xl bg-white px-4 py-3.5 text-[12.5px] text-[#7d6c64] ring-1 ring-[#ebe6df]">
        Todavía no hay lista de producción: la cargan los socios en <Link href="/cocina/lista" className="font-semibold text-[#006d5a] underline">Lista y mínimos</Link>.
      </p>
    )
  }

  async function guardar() {
    if (invalidos.length) { toast.error(`Revisá: ${invalidos.map((p) => p.nombre).join(', ')}`); return }
    setGuardando(true)
    setConErrores({})
    try {
      const { ok, j } = await pedir('/api/stock/conteo-diario', 'POST', {
        conteos: cargados.map((p) => ({ stock_item_id: p.stock_item_id, qty: leer(valores[p.stock_item_id]) })),
        comentario: comentario.trim() || null,
      })
      if (!ok && !j?.resultados) { toast.error(String(j?.error ?? 'No se pudo guardar el conteo')); return }
      const resultados = (Array.isArray(j?.resultados) ? j.resultados : []) as { stock_item_id: string; ok: boolean; error?: string }[]
      const fallidos = resultados.filter((r) => !r.ok)
      const guardados = resultados.filter((r) => r.ok).map((r) => r.stock_item_id)
      // Lo guardado se limpia; lo que falló queda para corregir
      setValores((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !guardados.includes(k))))
      if (fallidos.length) {
        setConErrores(Object.fromEntries(fallidos.map((f) => [f.stock_item_id, f.error ?? 'No se guardó'])))
        const pideNota = fallidos.some((f) => /nota/i.test(f.error ?? ''))
        toast.warning(pideNota
          ? `${fallidos.length} con una diferencia grande: escribí un comentario abajo (ej. "conteo inicial") y guardá de nuevo`
          : `${fallidos.length} no se guardaron`, { duration: 8_000 })
      } else {
        toast.success(`Conteo guardado (${guardados.length} producto${guardados.length === 1 ? '' : 's'})`)
        setComentario('')
      }
      onListo()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-2">
      {datos.conteos_hoy.length > 0 && (
        <p className="px-1 text-[11px] text-[#006d5a]">Hoy ya contó {datos.conteos_hoy.map((c) => `${c.quien?.split(' ')[0] ?? 'alguien'} ${hora(c.hora)} (${c.lineas.length})`).join(', ')} · {contadosHoy} de {datos.lista.length} contados</p>
      )}

      <div className="divide-y divide-[#f3efe9] overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
        {datos.lista.map((p) => {
          const v = valores[p.stock_item_id] ?? ''
          const malo = v.trim() !== '' && Number.isNaN(leer(v))
          return (
            <div key={p.stock_item_id} className="px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{p.nombre}</p>
                  <p className={cn('text-[10.5px]', p.contado_hoy ? 'text-[#006d5a]' : 'text-[#a39e97]')}>
                    {p.contado_hoy && p.contado_at ? `✓ contado hoy ${hora(p.contado_at)}` : p.contado_at ? `último conteo ${cuando(p.contado_at)}` : 'nunca contado'}
                  </p>
                </div>
                <input
                  value={v}
                  onChange={(e) => { const val = e.target.value; setValores((x) => ({ ...x, [p.stock_item_id]: val })) }}
                  inputMode="decimal"
                  placeholder="—"
                  aria-label={`Cuánto hay de ${p.nombre}`}
                  className={cn('w-24 rounded-xl border px-3 py-2.5 text-right text-[16px] tabular-nums focus:outline-none', malo || conErrores[p.stock_item_id] ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')}
                />
                <span className="w-11 shrink-0 text-[11px] text-[#a39e97]">{p.unidad}</span>
              </div>
              {conErrores[p.stock_item_id] && <p className="mt-1 text-[10.5px] text-[#ea504c]">{conErrores[p.stock_item_id]}</p>}
            </div>
          )
        })}
      </div>

      <textarea
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="Comentario (si algo da muy distinto, contá por qué)"
        className={cn('w-full resize-none rounded-xl border bg-white px-3 py-2 text-[12.5px] focus:outline-none', Object.values(conErrores).some((e) => /nota/i.test(e)) ? 'border-[#ea504c]' : 'border-[#e6dfd7] focus:border-[#006d5a]')}
      />
      <button
        type="button"
        onClick={() => void guardar()}
        disabled={guardando || cargados.length === 0}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-3 text-[14px] font-bold text-white active:scale-[0.99] disabled:opacity-40"
      >
        {guardando ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
        {cargados.length === 0 ? 'Cargá lo que contaste' : `Guardar conteo (${cargados.length})`}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3. Merma
// ---------------------------------------------------------------------------

function CargarMerma({ datos, onListo }: { datos: Datos; onListo: () => void }) {
  const [buscar, setBuscar] = useState('')
  const [elegido, setElegido] = useState<{ id: string; nombre: string; unidad: string } | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState<(typeof MOTIVOS)[number]['value']>('vencido')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Primero los de la lista de producción, después el resto de los insumos
  const opciones = useMemo(() => {
    const deLista = datos.lista.map((p) => ({ id: p.stock_item_id, nombre: p.nombre, unidad: p.unidad, enLista: true }))
    const ids = new Set(deLista.map((p) => p.id))
    const resto = (datos.insumos ?? []).filter((i) => !ids.has(i.id)).map((i) => ({ id: i.id, nombre: i.name, unidad: i.unit, enLista: false }))
    return [...deLista, ...resto]
  }, [datos.lista, datos.insumos])
  const q = buscar.trim()
  const resultados = !elegido && q.length >= 1 ? opciones.filter((o) => coincideBusqueda(o.nombre, q)).slice(0, 8) : []
  const cant = leer(cantidad)

  async function cargar() {
    if (!elegido || cant == null || Number.isNaN(cant) || cant <= 0) return
    setGuardando(true)
    try {
      const { ok, j } = await pedir('/api/stock/waste', 'POST', { stockItemId: elegido.id, qty: cant, wasteReason: motivo, note: nota.trim() || null })
      if (!ok || j?.success === false) { toast.error(String(j?.error ?? 'No se pudo cargar la merma')); return }
      toast.success(`Merma cargada: ${num(cant)} ${elegido.unidad} de ${elegido.nombre}`)
      setElegido(null); setBuscar(''); setCantidad(''); setNota('')
      onListo()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2.5 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
        {elegido ? (
          <div className="flex items-center gap-2">
            <Package className="size-4 shrink-0 text-[#006d5a]" />
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#3d2c24]">{elegido.nombre}</p>
            <button type="button" onClick={() => setElegido(null)} className="text-[11px] font-semibold text-[#7d6c64] underline">cambiar</button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="¿Qué se tiró o se usó?" className="w-full rounded-xl border border-[#e6dfd7] bg-[#faf8f5] py-2.5 pl-8 pr-3 text-[13px] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:bg-white focus:outline-none" />
          </div>
        )}
        {resultados.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-[#ebe6df]">
            {resultados.map((o) => (
              <button key={o.id} type="button" onClick={() => setElegido(o)} className="flex w-full items-center gap-2 border-b border-[#f3efe9] px-3 py-2.5 text-left last:border-b-0 hover:bg-[#f8f5f0]">
                {o.enLista ? <ChefHat className="size-3.5 shrink-0 text-[#006d5a]" /> : <Package className="size-3.5 shrink-0 text-[#a39e97]" />}
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#3d2c24]">{o.nombre}</span>
                <span className="shrink-0 text-[10.5px] text-[#a39e97]">{o.unidad}</span>
              </button>
            ))}
          </div>
        )}

        {elegido && (
          <>
            <div className="flex items-center gap-2">
              <input value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode="decimal" placeholder="Cantidad" className={cn('w-full rounded-xl border px-3 py-2.5 text-[16px] tabular-nums focus:outline-none', cantidad && !(cant != null && cant > 0) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')} />
              <span className="shrink-0 text-[12px] text-[#7d6c64]">{elegido.unidad}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MOTIVOS.map((m) => (
                <button key={m.value} type="button" onClick={() => setMotivo(m.value)} className={cn('rounded-xl py-2.5 text-[12.5px] font-semibold', motivo === m.value ? 'bg-[#3d2c24] text-white' : 'bg-[#f3efe9] text-[#3d2c24]')}>
                  {m.label}
                </button>
              ))}
            </div>
            <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Nota (opcional)" className="w-full rounded-xl border border-[#e6dfd7] px-3 py-2 text-[12.5px] focus:border-[#006d5a] focus:outline-none" />
            <button type="button" onClick={() => void cargar()} disabled={guardando || !(cant != null && cant > 0)} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#ea504c] py-3 text-[14px] font-bold text-white active:scale-[0.99] disabled:opacity-40">
              {guardando ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Cargar merma
            </button>
          </>
        )}
      </div>

      {datos.mermas_hoy.length > 0 && (
        <div className="rounded-2xl bg-white px-3.5 py-2.5 ring-1 ring-[#ebe6df]">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#a39e97]">Merma de hoy</p>
          <ul className="mt-1 space-y-1">
            {datos.mermas_hoy.map((m) => (
              <li key={m.id} className="text-[12px] text-[#3d2c24]">
                <b className="tabular-nums">{num(m.cantidad)} {m.unidad}</b> · {m.nombre}
                <span className="text-[#a39e97]"> — {(m.nota ?? 'Merma').replace(/^Merma /, '').replace('consumo_interno', 'consumo del personal').replace('mal_guardado', 'mal guardado')}{m.quien ? ` · ${m.quien}` : ''} {hora(m.hora)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
