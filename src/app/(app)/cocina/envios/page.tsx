'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChefHat, Loader2, Package, PlugZap, RefreshCw, Search, Trash2, Truck, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isKitchenRole, isManagerOrAbove } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { coincideBusqueda } from '@/lib/buscar'
import { BackToHoy } from '@/components/layout/BackToHoy'
import { LoadingState } from '@/components/ui/LoadingState'
import type { EnvioVista, InsumoEnviable } from '@/lib/envios/salientes'

// ---------------------------------------------------------------------------
// Enviar a la 24 — la cocina de Santa Fe manda producción a la otra sucursal
// ---------------------------------------------------------------------------
// Arriba: armar el envío (buscador de insumos, elaborados primero, cantidad
// en la unidad del insumo y una nota). Al mandarlo, en cuanto la 24 lo acepta
// baja el stock de acá. Abajo: los envíos recientes y en qué quedaron (en
// camino, llegó, llegó con faltantes, anulado). Mientras está en camino se
// puede anular y el stock vuelve.
// ---------------------------------------------------------------------------

const TZ = 'America/Argentina/Buenos_Aires'
const URL = '/api/envios/salientes?insumos=1'

type Datos = { envios: EnvioVista[]; insumos: InsumoEnviable[]; falta_configurar: string | null }
type Renglon = { id: string; cantidad: string }

async function fetcher(url: string): Promise<Datos> {
  const r = await fetch(url)
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw new Error(j?.error ?? 'No se pudo cargar')
  return j as Datos
}

async function postJson(url: string, body?: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => null)
  return { ok: r.ok, status: r.status, j: j as Record<string, unknown> | null }
}

const num = (n: number) => Number(n.toFixed(3)).toLocaleString('es-AR')
const parseCantidad = (s: string) => {
  const n = parseFloat(s.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const cuando = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function estadoVisible(e: EnvioVista): { txt: string; cls: string } {
  if (e.estado === 'pendiente_envio') return { txt: 'Pendiente de enviar', cls: 'bg-[#fdf6ec] text-[#b0762a]' }
  if (e.estado === 'en_camino') return { txt: 'En camino', cls: 'bg-[#eef4fc] text-[#2f5f9a]' }
  if (e.estado === 'recibido') return e.faltantes.length > 0
    ? { txt: 'Llegó con faltantes', cls: 'bg-[#fef2f2] text-[#ea504c]' }
    : { txt: 'Llegó', cls: 'bg-[#e8f5f1] text-[#006d5a]' }
  if (!e.stock_descontado && e.ultimo_error?.startsWith('La 24 lo rechazó')) return { txt: 'No salió', cls: 'bg-[#fef2f2] text-[#ea504c]' }
  return { txt: 'Anulado', cls: 'bg-[#f3efe9] text-[#a39e97]' }
}

export default function EnviarALa24Page() {
  const { profile, loading: cargandoPerfil } = useProfileContext()
  const puede = isKitchenRole(profile?.role)
  const esManager = isManagerOrAbove(profile?.role)
  const { data, error, isLoading, mutate } = useSWR(puede ? URL : null, fetcher, { refreshInterval: 60_000, keepPreviousData: true })
  const [consultando, setConsultando] = useState(false)

  async function consultarTodos() {
    setConsultando(true)
    try {
      const d = await fetcher(`${URL}&consultar=1`)
      await mutate(d, { revalidate: false })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo consultar')
    } finally {
      setConsultando(false)
    }
  }

  if (cargandoPerfil) return <LoadingState />
  if (!puede) return <p className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-[#7d6c64]">Esta pantalla es de cocina, chef, encargados y socios.</p>

  const enCamino = data?.envios.filter((e) => e.estado === 'en_camino' || e.estado === 'pendiente_envio').length ?? 0

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-32">
      <BackToHoy />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[#006d5a]/10">
            <Truck className="size-4.5 text-[#006d5a]" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-[#3d2c24]">Enviar a la 24</h1>
            <p className="text-[12px] text-[#7d6c64]">Producción de esta cocina para la otra sucursal</p>
          </div>
        </div>
        <button
          onClick={() => void consultarTodos()}
          disabled={consultando || !data}
          title="Preguntarle a la 24 si ya llegaron los envíos en camino"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[#3d2c24] ring-1 ring-[#ebe6df] active:scale-95 disabled:opacity-50"
          aria-label="Actualizar"
        >
          {consultando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </button>
      </div>

      {data?.falta_configurar && (
        <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] font-semibold text-[#ea504c]">{data.falta_configurar}. Hasta que esté, no se puede mandar.</p>
      )}

      {error && !data && <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#ea504c]">{error.message}</p>}
      {isLoading && !data && <LoadingState />}

      {data && !data.falta_configurar && (
        <NuevoEnvio insumos={data.insumos} onEnviado={() => void mutate()} />
      )}

      {data && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-[13px] font-bold text-[#3d2c24]">Envíos recientes</h2>
            {enCamino > 0 && <span className="text-[11px] text-[#7d6c64]">{enCamino} sin llegar todavía</span>}
          </div>
          {data.envios.length === 0 && <p className="rounded-2xl bg-white px-4 py-6 text-center text-[12.5px] text-[#a39e97] ring-1 ring-[#ebe6df]">Todavía no se mandó nada en los últimos 30 días.</p>}
          {data.envios.map((e) => <EnvioCard key={e.id} envio={e} onCambio={() => void mutate()} />)}
        </section>
      )}

      {esManager && <ProbarConexion />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Armar un envío
// ---------------------------------------------------------------------------

function NuevoEnvio({ insumos, onEnviado }: { insumos: InsumoEnviable[]; onEnviado: () => void }) {
  const [buscar, setBuscar] = useState('')
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [nota, setNota] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const porId = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos])
  const elegidos = new Set(renglones.map((r) => r.id))
  const q = buscar.trim()
  const resultados = q.length >= 1 ? insumos.filter((i) => !elegidos.has(i.id) && coincideBusqueda(i.name, q)).slice(0, 8) : []
  const cantidades = renglones.map((r) => parseCantidad(r.cantidad))
  const listo = renglones.length > 0 && cantidades.every((c) => c > 0)

  function agregar(i: InsumoEnviable) {
    if (!i.en_fudo) return
    setRenglones((rs) => [...rs, { id: i.id, cantidad: '' }])
    setBuscar('')
    setConfirmando(false)
  }

  async function enviar() {
    setEnviando(true)
    try {
      const { ok, status, j } = await postJson('/api/envios/salientes', {
        items: renglones.map((r) => ({ stock_item_id: r.id, cantidad: parseCantidad(r.cantidad) })),
        nota: nota.trim() || null,
      })
      if (!ok) {
        toast.error(String(j?.error ?? 'No se pudo mandar'))
        if (j?.id) onEnviado()
        return
      }
      if (status === 201) toast.success('En camino a la 24: el stock de acá ya bajó')
      else toast.warning(String(j?.mensaje ?? 'Quedó pendiente: se manda solo cuando la 24 responda'))
      const errores = Array.isArray(j?.erroresStock) ? (j.erroresStock as string[]) : []
      if (errores.length) toast.warning(`Stock que no se pudo bajar: ${errores.join('; ')}`, { duration: 10_000 })
      setRenglones([])
      setNota('')
      setConfirmando(false)
      onEnviado()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
      <p className="text-[13px] font-bold text-[#3d2c24]">Nuevo envío</p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscá qué mandás (bondiola, empanadas…)"
          className="w-full rounded-xl border border-[#e6dfd7] bg-[#faf8f5] py-2.5 pl-8 pr-3 text-[13px] text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:bg-white focus:outline-none"
        />
      </div>

      {resultados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#ebe6df]">
          {resultados.map((i) => (
            <button
              key={i.id}
              type="button"
              disabled={!i.en_fudo}
              onClick={() => agregar(i)}
              className="flex w-full items-center gap-2 border-b border-[#f3efe9] px-3 py-2 text-left last:border-b-0 hover:bg-[#f8f5f0] disabled:opacity-60"
            >
              {i.elaborado ? <ChefHat className="size-3.5 shrink-0 text-[#006d5a]" /> : <Package className="size-3.5 shrink-0 text-[#a39e97]" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-[#3d2c24]">{i.name}</span>
                {!i.en_fudo && <span className="block text-[10.5px] text-[#ea504c]">Sin vínculo con Fudo: vinculalo en su ficha de Stock para poder mandarlo</span>}
              </span>
              <span className={cn('shrink-0 text-[10.5px] tabular-nums', i.current_qty <= 0 ? 'text-[#ea504c]' : 'text-[#a39e97]')}>hay {num(i.current_qty)} {i.unit}</span>
            </button>
          ))}
        </div>
      )}
      {q.length >= 2 && resultados.length === 0 && <p className="text-[11.5px] text-[#a39e97]">No hay ningún insumo activo que se llame así.</p>}

      {renglones.length > 0 && (
        <div className="space-y-2">
          {renglones.map((r, idx) => {
            const i = porId.get(r.id)
            if (!i) return null
            const c = cantidades[idx]
            const queda = c > 0 ? i.current_qty - c : null
            return (
              <div key={r.id} className="flex items-center gap-2 rounded-xl bg-[#f6fbf9] px-3 py-2 ring-1 ring-[#cfe5de]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-[#3d2c24]">{i.name}</p>
                  <p className={cn('text-[10.5px]', queda != null && queda < 0 ? 'text-[#ea504c]' : 'text-[#7d6c64]')}>
                    hay {num(i.current_qty)} {i.unit}{queda != null && <> · queda {num(queda)}</>}
                  </p>
                </div>
                <input
                  value={r.cantidad}
                  onChange={(e) => { const v = e.target.value; setRenglones((rs) => rs.map((x) => (x.id === r.id ? { ...x, cantidad: v } : x))); setConfirmando(false) }}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`Cantidad de ${i.name}`}
                  className={cn('w-20 rounded-lg border bg-white px-2 py-1.5 text-right text-[13px] tabular-nums focus:outline-none', r.cantidad && !(c > 0) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')}
                />
                <span className="w-12 shrink-0 text-[11px] text-[#7d6c64]">{i.unit}</span>
                <button type="button" onClick={() => { setRenglones((rs) => rs.filter((x) => x.id !== r.id)); setConfirmando(false) }} className="shrink-0 rounded-lg p-1 text-[#a39e97] hover:bg-[#fef2f2] hover:text-[#ea504c]" aria-label="Quitar">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {renglones.length > 0 && (
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Nota para la 24 (opcional)"
          className="w-full resize-none rounded-xl border border-[#e6dfd7] bg-white px-3 py-2 text-[12.5px] text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none"
        />
      )}

      {confirmando ? (
        <div className="space-y-2 rounded-xl bg-[#3d2c24] p-3 text-white">
          <p className="text-[12px] font-semibold">¿Mandás esto a la 24?</p>
          <ul className="space-y-0.5 text-[12px] text-white/85">
            {renglones.map((r, idx) => <li key={r.id}>{num(cantidades[idx])} {porId.get(r.id)?.unit} · {porId.get(r.id)?.name}</li>)}
          </ul>
          <p className="text-[10.5px] text-white/60">En cuanto la 24 lo acepta, baja el stock de acá (y de Fudo). Hasta que lo reciban se puede anular.</p>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setConfirmando(false)} disabled={enviando} className="flex-1 rounded-lg bg-white/10 py-2 text-[12.5px] font-semibold">Volver</button>
            <button type="button" onClick={() => void enviar()} disabled={enviando} className="flex flex-[2] items-center justify-center gap-1.5 rounded-lg bg-[#006d5a] py-2 text-[12.5px] font-bold disabled:opacity-60">
              {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />} Sí, mandar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!listo}
          onClick={() => setConfirmando(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-2.5 text-[13px] font-bold text-white active:scale-[0.99] disabled:opacity-40"
        >
          <Truck className="size-4" />
          {renglones.length === 0 ? 'Elegí qué mandar' : `Enviar ${renglones.length} producto${renglones.length === 1 ? '' : 's'}`}
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Un envío de la lista
// ---------------------------------------------------------------------------

function EnvioCard({ envio: e, onCambio }: { envio: EnvioVista; onCambio: () => void }) {
  const [accion, setAccion] = useState<'anular' | 'reintentar' | 'consultar' | null>(null)
  const [confirmarAnular, setConfirmarAnular] = useState(false)
  const est = estadoVisible(e)
  const puedeAnular = e.estado === 'en_camino' || e.estado === 'pendiente_envio'

  async function hacer(a: 'anular' | 'reintentar' | 'consultar') {
    setAccion(a)
    try {
      const { ok, j } = await postJson(`/api/envios/salientes/${e.id}`, { accion: a })
      if (!ok) { toast.error(String(j?.error ?? 'No se pudo')); return }
      if (a === 'anular') toast.success(String(j?.mensaje ?? 'Anulado'))
      if (a === 'reintentar') {
        if (j?.estado === 'en_camino') toast.success('En camino a la 24')
        else toast.warning(String(j?.mensaje ?? 'La 24 sigue sin responder'))
      }
      if (a === 'consultar') toast(j?.estado === 'recibido' ? 'La 24 ya lo recibió' : 'Todavía no llegó')
      const errores = Array.isArray(j?.erroresStock) ? (j.erroresStock as string[]) : []
      if (errores.length) toast.warning(`Stock que no se pudo mover: ${errores.join('; ')}`, { duration: 10_000 })
    } finally {
      setAccion(null)
      setConfirmarAnular(false)
      onCambio()
    }
  }

  return (
    <div className={cn('rounded-2xl bg-white p-3.5 ring-1', e.estado === 'recibido' && e.faltantes.length ? 'ring-[#f5c6c4]' : 'ring-[#ebe6df]')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold capitalize text-[#3d2c24]">{cuando(e.created_at)}</p>
          <p className="truncate text-[11px] text-[#a39e97]">{e.enviado_por ? `Mandó ${e.enviado_por}` : 'Envío a la 24'}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold', est.cls)}>{est.txt}</span>
      </div>

      <ul className="mt-2 space-y-1">
        {e.items.map((i) => {
          const falto = e.estado === 'recibido' && i.recibida_aca != null && i.recibida_aca < i.cantidad - 0.0005
          return (
            <li key={i.id} className="text-[12px] text-[#3d2c24]">
              <span className="font-semibold tabular-nums">{num(i.cantidad)} {i.unidad}</span> · {i.nombre}
              {e.estado === 'recibido' && i.cantidad_recibida != null && (
                <span className={cn('ml-1 text-[11px]', falto ? 'font-semibold text-[#ea504c]' : 'text-[#006d5a]')}>
                  {falto ? `→ llegaron ${num(i.recibida_aca ?? 0)}` : i.recibida_aca == null ? `→ llegaron ${num(i.cantidad_recibida)} ${i.unidad_recibida ?? ''}` : '✓'}
                </span>
              )}
              {i.producto_24 && i.producto_24.toLowerCase() !== i.nombre.toLowerCase() && (
                <span className="block pl-3 text-[10.5px] text-[#a39e97]">en la 24: {i.producto_24}</span>
              )}
            </li>
          )
        })}
      </ul>

      {e.nota && <p className="mt-2 text-[11.5px] italic text-[#7d6c64]">«{e.nota}»</p>}
      {e.estado === 'recibido' && (
        <p className="mt-2 text-[11px] text-[#7d6c64]">
          Llegó {e.recibido_at ? cuando(e.recibido_at) : ''}{e.recibido_por ? ` · recibió ${e.recibido_por}` : ''}
          {e.nota_recepcion && <span className="block italic">«{e.nota_recepcion}»</span>}
        </p>
      )}
      {e.estado === 'anulado' && e.anulado_at && est.txt === 'Anulado' && (
        <p className="mt-2 text-[11px] text-[#a39e97]">Anulado {cuando(e.anulado_at)}{e.stock_descontado ? ' · el stock volvió' : ''}</p>
      )}
      {e.ultimo_error && (
        <p className="mt-2 flex items-start gap-1 rounded-lg bg-[#fdf6ec] px-2 py-1.5 text-[11px] text-[#b0762a]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {e.ultimo_error}
        </p>
      )}

      {puedeAnular && (
        confirmarAnular ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#fef2f2] p-2">
            <p className="flex-1 text-[11.5px] font-semibold text-[#ea504c]">¿Anular? {e.stock_descontado ? 'El stock vuelve acá.' : ''}</p>
            <button type="button" onClick={() => setConfirmarAnular(false)} disabled={!!accion} className="rounded-lg p-1.5 text-[#7d6c64]" aria-label="No anular"><X className="size-4" /></button>
            <button type="button" onClick={() => void hacer('anular')} disabled={!!accion} className="flex items-center gap-1 rounded-lg bg-[#ea504c] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-60">
              {accion === 'anular' ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Sí, anular
            </button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            {e.estado === 'pendiente_envio' && (
              <button type="button" onClick={() => void hacer('reintentar')} disabled={!!accion} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#006d5a] py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
                {accion === 'reintentar' ? <Loader2 className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />} Reintentar
              </button>
            )}
            {e.estado === 'en_camino' && (
              <button type="button" onClick={() => void hacer('consultar')} disabled={!!accion} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#f3efe9] py-1.5 text-[12px] font-semibold text-[#3d2c24] disabled:opacity-60">
                {accion === 'consultar' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} ¿Llegó?
              </button>
            )}
            <button type="button" onClick={() => setConfirmarAnular(true)} disabled={!!accion} className="flex-1 rounded-lg bg-white py-1.5 text-[12px] font-semibold text-[#ea504c] ring-1 ring-[#f5c6c4] disabled:opacity-60">
              Anular
            </button>
          </div>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Prueba de conexión (socios y encargados): no toca nada de acá
// ---------------------------------------------------------------------------

function ProbarConexion() {
  const [probando, setProbando] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; pasos: { paso: string; ok: boolean; detalle: string }[] } | null>(null)

  async function probar() {
    setProbando(true)
    setRes(null)
    try {
      const { ok, j } = await postJson('/api/envios/salientes/prueba')
      if (!ok || !j) { toast.error(String(j?.error ?? 'No se pudo probar')); return }
      setRes(j as unknown as { ok: boolean; pasos: { paso: string; ok: boolean; detalle: string }[] })
    } finally {
      setProbando(false)
    }
  }

  return (
    <section className="rounded-2xl bg-[#f3efe9] p-3.5">
      <button type="button" onClick={() => void probar()} disabled={probando} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white py-2 text-[12.5px] font-semibold text-[#3d2c24] ring-1 ring-[#ebe6df] disabled:opacity-60">
        {probando ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} Probar conexión con la 24
      </button>
      <p className="mt-1.5 text-center text-[10.5px] text-[#a39e97]">Manda un envío de prueba (sin aviso), lo consulta y lo anula. No toca el stock.</p>
      {res && (
        <ul className="mt-2 space-y-1">
          {res.pasos.map((p) => (
            <li key={p.paso} className={cn('flex items-start gap-1.5 text-[11.5px]', p.ok ? 'text-[#006d5a]' : 'text-[#ea504c]')}>
              {p.ok ? <Check className="mt-0.5 size-3 shrink-0" /> : <X className="mt-0.5 size-3 shrink-0" />}
              <span><b>{p.paso}:</b> {p.detalle}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
