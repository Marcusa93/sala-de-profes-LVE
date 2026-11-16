'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChefHat, ClipboardList, Loader2, Package, Search, Send, Trash2, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isKitchenRole } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { coincideBusqueda } from '@/lib/buscar'
import { BackToHoy } from '@/components/layout/BackToHoy'
import { LoadingState } from '@/components/ui/LoadingState'
import type { InsumoEnviable } from '@/lib/envios/salientes'
import type { EstadoCatalogo24, Linea24, ProductoLista, ResultadoCatalogo, Stock24 } from '@/lib/produccion/lista'

// ---------------------------------------------------------------------------
// Lista de producción y mínimos — sistema de producción, punto 1
// ---------------------------------------------------------------------------
// Qué produce la cocina y cuánto tiene que haber como mínimo, en Santa Fe y
// en la 24. La cambian los socios; el resto la ve. Al guardar, a la 24 se le
// manda su parte (qué cuenta al cierre y su mínimo). Abajo de cada producto:
// cómo está en la 24 (si ya lo eligieron allá, cuánto hay y cuánto falta).
// ---------------------------------------------------------------------------

const TZ = 'America/Argentina/Buenos_Aires'
const URL = '/api/produccion/lista?insumos=1&con24=1'

type Datos = {
  productos: ProductoLista[]
  falta_migracion: boolean
  puede_editar: boolean
  estado_24: EstadoCatalogo24
  la_24: Stock24 | null
  falta_configurar: string | null
  candidatos?: InsumoEnviable[]
}

type Fila = {
  stock_item_id: string
  nombre: string
  unidad: string
  stock: number
  en_fudo: boolean
  minimo_sf: string
  va_a_la_24: boolean
  minimo_24: string
}

async function fetcher(url: string): Promise<Datos> {
  const r = await fetch(url)
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw new Error(j?.error ?? 'No se pudo cargar')
  return j as Datos
}

const num = (n: number) => Number(n.toFixed(3)).toLocaleString('es-AR')
const aTexto = (n: number | null) => (n == null || n === 0 ? '' : String(Number(n.toFixed(3))).replace('.', ','))
/** '' → null; número ≥ 0 → número; otra cosa → NaN */
const leer = (s: string) => {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}
const cuando = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

const aFila = (p: ProductoLista): Fila => ({
  stock_item_id: p.stock_item_id,
  nombre: p.nombre,
  unidad: p.unidad,
  stock: p.stock,
  en_fudo: p.en_fudo,
  minimo_sf: aTexto(p.minimo_sf),
  va_a_la_24: p.va_a_la_24,
  minimo_24: aTexto(p.minimo_24),
})
const firma = (fs: Fila[]) => JSON.stringify(fs.map((f) => [f.stock_item_id, leer(f.minimo_sf) ?? 0, f.va_a_la_24, f.va_a_la_24 ? leer(f.minimo_24) : null]))

export default function ListaProduccionPage() {
  const { profile, loading: cargandoPerfil } = useProfileContext()
  const puedeVer = isKitchenRole(profile?.role)
  const { data, error, isLoading, mutate } = useSWR(puedeVer ? URL : null, fetcher, { revalidateOnFocus: false })
  // Borrador: existe solo mientras se edita; si no, se muestra lo del servidor
  const [edicion, setEdicion] = useState<Fila[] | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [mandando, setMandando] = useState(false)

  const servidor = useMemo(() => (data ? data.productos.map(aFila) : null), [data])
  const filas = edicion ?? servidor
  const sucio = !!edicion && !!servidor && firma(edicion) !== firma(servidor)
  const editarFilas = (fn: (fs: Fila[]) => Fila[]) => setEdicion((e) => fn(e ?? servidor ?? []))

  if (cargandoPerfil) return <LoadingState />
  if (!puedeVer) return <p className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-[#7d6c64]">Esta pantalla es de cocina, chef, encargados y socios.</p>
  if (isLoading && !data) return <LoadingState />
  if (error && !data) return <p className="mx-auto max-w-lg rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#ea504c]">{error.message}</p>
  if (!data || !filas) return <LoadingState />

  const editar = data.puede_editar && !data.falta_migracion
  const info24 = (id: string): Linea24 | null => {
    if (data.la_24?.ok) return data.la_24.productos[id] ?? null
    const r = data.estado_24.resultado?.find((x) => x.item_id === id)
    return r ? { vinculado: r.vinculado, producto_24: r.producto_24, unidad_24: r.unidad_24, unidad_compatible: r.unidad_compatible, stock: null, en_camino: 0, falta: null, contado_hoy: false, contado_at: null } : null
  }
  const invalidas = filas.filter((f) => Number.isNaN(leer(f.minimo_sf)) || (f.va_a_la_24 && Number.isNaN(leer(f.minimo_24))))

  function cambiar(id: string, patch: Partial<Fila>) {
    editarFilas((fs) => fs.map((f) => (f.stock_item_id === id ? { ...f, ...patch } : f)))
  }

  async function guardar() {
    if (!filas) return
    if (invalidas.length) { toast.error(`Revisá los mínimos de: ${invalidas.map((f) => f.nombre).join(', ')}`); return }
    setGuardando(true)
    try {
      const r = await fetch('/api/produccion/lista', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productos: filas.map((f) => ({ stock_item_id: f.stock_item_id, minimo_sf: leer(f.minimo_sf), va_a_la_24: f.va_a_la_24, minimo_24: f.va_a_la_24 ? leer(f.minimo_24) : null })),
        }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) { toast.error(j?.error ?? 'No se pudo guardar'); return }
      toast.success('Lista guardada')
      avisar24(j?.la_24 as ResultadoCatalogo | null)
      setEdicion(null)
      await mutate()
    } finally {
      setGuardando(false)
    }
  }

  async function mandar24() {
    setMandando(true)
    try {
      const r = await fetch('/api/produccion/lista', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'mandar_24' }) })
      const j = await r.json().catch(() => null)
      if (!r.ok) toast.error(j?.error ?? 'No se pudo mandar a la 24')
      else avisar24(j as ResultadoCatalogo)
      await mutate()
    } finally {
      setMandando(false)
    }
  }

  const enLista = new Set(filas.map((f) => f.stock_item_id))

  return (
    <div className={cn('mx-auto max-w-lg space-y-4', sucio ? 'pb-44' : 'pb-32')}>
      <BackToHoy />

      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-[#006d5a]/10">
          <ClipboardList className="size-4 text-[#006d5a]" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-[#3d2c24]">Lista y mínimos</h1>
          <p className="text-[12px] text-[#7d6c64]">Lo que produce la cocina y cuánto tiene que haber en cada local</p>
        </div>
      </div>

      {data.falta_migracion && (
        <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] font-semibold text-[#ea504c]">Falta correr la migración de la lista de producción (20261116_produccion_lista.sql).</p>
      )}
      {!data.puede_editar && (
        <p className="rounded-xl bg-[#f3efe9] px-3 py-2 text-[11.5px] text-[#7d6c64]">La lista y los mínimos los cambian los socios.</p>
      )}

      <EstadoLa24 datos={data} editar={editar} mandando={mandando} onMandar={() => void mandar24()} />

      {editar && <AgregarProducto candidatos={data.candidatos ?? []} enLista={enLista} onAgregar={(i) => editarFilas((fs) => [...fs, { stock_item_id: i.id, nombre: i.name, unidad: i.unit, stock: i.current_qty, en_fudo: i.en_fudo, minimo_sf: '', va_a_la_24: true, minimo_24: '' }])} />}

      {filas.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-8 text-center text-[12.5px] text-[#a39e97] ring-1 ring-[#ebe6df]">
          {editar ? 'Todavía no hay productos en la lista. Agregalos con el buscador de arriba.' : 'Todavía no hay productos en la lista.'}
        </p>
      ) : (
        <section className="space-y-2">
          {filas.map((f) => (
            <FilaProducto
              key={f.stock_item_id}
              fila={f}
              editar={editar}
              la24={info24(f.stock_item_id)}
              onCambiar={(patch) => cambiar(f.stock_item_id, patch)}
              onQuitar={() => editarFilas((fs) => fs.filter((x) => x.stock_item_id !== f.stock_item_id))}
            />
          ))}
        </section>
      )}

      {editar && sucio && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 flex justify-center gap-2 px-4">
          <button type="button" onClick={() => setEdicion(null)} disabled={guardando} className="pointer-events-auto rounded-full bg-white px-4 py-3 text-sm font-semibold text-[#7d6c64] shadow-xl ring-1 ring-[#ebe6df] active:scale-95">
            Deshacer
          </button>
          <button type="button" onClick={() => void guardar()} disabled={guardando} className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#006d5a] px-6 py-3 text-sm font-bold text-white shadow-xl active:scale-95 disabled:opacity-60">
            {guardando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Guardar cambios
          </button>
        </div>
      )}
    </div>
  )
}

function avisar24(r: ResultadoCatalogo | null) {
  if (!r) return
  if (!r.ok) { toast.warning(`La 24 todavía no tiene la lista: ${r.error}${r.reintenta ? ' (se reintenta sola)' : ''}`, { duration: 8_000 }); return }
  const partes = [
    r.sin_vincular ? `${r.sin_vincular} sin elegir allá` : null,
    r.unidad_incompatible ? `${r.unidad_incompatible} con otra unidad` : null,
  ].filter(Boolean)
  toast.success(`La 24 ya tiene la lista (${r.productos.length} productos)${partes.length ? ` · ${partes.join(' · ')}` : ''}`)
}

// ---------------------------------------------------------------------------
// Cómo está la lista en la 24
// ---------------------------------------------------------------------------

function EstadoLa24({ datos, editar, mandando, onMandar }: { datos: Datos; editar: boolean; mandando: boolean; onMandar: () => void }) {
  const e = datos.estado_24
  const pendiente = !!e.cambiado_at && (!e.enviado_at || e.enviado_at < e.cambiado_at)
  const cierre = datos.la_24?.ok ? datos.la_24.conteo_cierre : null
  const resultado = datos.la_24?.ok
    ? Object.values(datos.la_24.productos)
    : (e.resultado ?? []).map((r) => ({ vinculado: r.vinculado, unidad_compatible: r.unidad_compatible }))
  const sinVincular = resultado.filter((r) => !r.vinculado).length
  const otraUnidad = resultado.filter((r) => r.unidad_compatible === false).length

  return (
    <section className="space-y-2 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
      <div className="flex items-center gap-2">
        <Truck className="size-4 shrink-0 text-[#006d5a]" />
        <p className="flex-1 text-[13px] font-bold text-[#3d2c24]">La 24</p>
        {editar && !datos.falta_configurar && (
          <button type="button" onClick={onMandar} disabled={mandando} className="flex items-center gap-1 rounded-full bg-[#f3efe9] px-3 py-1.5 text-[11.5px] font-semibold text-[#3d2c24] active:scale-95 disabled:opacity-60">
            {mandando ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Mandar a la 24
          </button>
        )}
      </div>

      {datos.falta_configurar ? (
        <p className="text-[11.5px] text-[#ea504c]">{datos.falta_configurar}</p>
      ) : e.ultimo_error ? (
        <p className="flex items-start gap-1 text-[11.5px] text-[#b0762a]"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> {e.ultimo_error}{!e.rechazado && ' · se reintenta sola'}</p>
      ) : pendiente ? (
        <p className="text-[11.5px] text-[#b0762a]">Hay cambios que la 24 todavía no tiene.</p>
      ) : e.enviado_at ? (
        <p className="text-[11.5px] text-[#006d5a]">Tiene la lista al día (mandada {cuando(e.enviado_at)}).</p>
      ) : (
        <p className="text-[11.5px] text-[#a39e97]">Todavía no se le mandó la lista.</p>
      )}

      {datos.la_24 && !datos.la_24.ok && <p className="text-[11px] text-[#a39e97]">No se pudo leer el stock de la 24 ahora ({datos.la_24.error}).</p>}
      {cierre && (
        <p className={cn('text-[11.5px]', cierre.hecho_hoy ? 'text-[#006d5a]' : 'text-[#7d6c64]')}>
          {cierre.hecho_hoy && cierre.ultimo
            ? `Conteo de cierre de hoy: ${hora(cierre.ultimo.hora)}${cierre.ultimo.quien ? ` (${cierre.ultimo.quien})` : ''}`
            : cierre.ultimo ? `Todavía no contó hoy (último: ${cuando(cierre.ultimo.hora)})` : 'Todavía no hizo ningún conteo de cierre'}
        </p>
      )}
      {sinVincular > 0 && (
        <p className="text-[11.5px] text-[#b0762a]">{sinVincular} producto{sinVincular === 1 ? '' : 's'} que la 24 todavía no eligió: lo hace un encargado de la 24, una sola vez.</p>
      )}
      {otraUnidad > 0 && (
        <p className="text-[11.5px] text-[#ea504c]">{otraUnidad} producto{otraUnidad === 1 ? '' : 's'} que la 24 cuenta en otra unidad (ej. kg contra unidad): no se puede comparar.</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Agregar a la lista
// ---------------------------------------------------------------------------

function AgregarProducto({ candidatos, enLista, onAgregar }: { candidatos: InsumoEnviable[]; enLista: Set<string>; onAgregar: (i: InsumoEnviable) => void }) {
  const [buscar, setBuscar] = useState('')
  const q = buscar.trim()
  const resultados = q.length >= 1 ? candidatos.filter((i) => !enLista.has(i.id) && coincideBusqueda(i.name, q)).slice(0, 8) : []

  return (
    <section className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Agregar a la lista (masa de wrap, milanesa…)"
          className="w-full rounded-xl border border-[#e6dfd7] bg-white py-2.5 pl-8 pr-3 text-[13px] text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none"
        />
      </div>
      {resultados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#ebe6df] bg-white">
          {resultados.map((i) => (
            <button key={i.id} type="button" onClick={() => { onAgregar(i); setBuscar('') }} className="flex w-full items-center gap-2 border-b border-[#f3efe9] px-3 py-2.5 text-left last:border-b-0 hover:bg-[#f8f5f0]">
              {i.elaborado ? <ChefHat className="size-3.5 shrink-0 text-[#006d5a]" /> : <Package className="size-3.5 shrink-0 text-[#a39e97]" />}
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#3d2c24]">{i.name}</span>
              {!i.en_fudo && <span className="shrink-0 text-[10px] font-semibold text-[#ea504c]">sin Fudo</span>}
              <span className="shrink-0 text-[10.5px] text-[#a39e97]">{i.unit}</span>
            </button>
          ))}
        </div>
      )}
      {q.length >= 2 && resultados.length === 0 && <p className="px-1 text-[11.5px] text-[#a39e97]">No hay ningún insumo activo con ese nombre (o ya está en la lista).</p>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Un producto de la lista
// ---------------------------------------------------------------------------

function FilaProducto({ fila: f, editar, la24, onCambiar, onQuitar }: { fila: Fila; editar: boolean; la24: Linea24 | null; onCambiar: (p: Partial<Fila>) => void; onQuitar: () => void }) {
  const minSf = leer(f.minimo_sf)
  const min24 = leer(f.minimo_24)
  const faltaAca = minSf && minSf > 0 && f.stock < minSf ? minSf - f.stock : 0

  return (
    <div className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-[#3d2c24]">{f.nombre}</p>
          <p className={cn('text-[11px]', f.stock < 0 || faltaAca > 0 ? 'text-[#ea504c]' : 'text-[#7d6c64]')}>
            Hay {num(f.stock)} {f.unidad} acá{faltaAca > 0 && <> · faltan {num(faltaAca)}</>}
            {!f.en_fudo && <span className="ml-1 font-semibold text-[#ea504c]">· sin Fudo</span>}
          </p>
        </div>
        {editar && (
          <button type="button" onClick={onQuitar} className="shrink-0 rounded-lg p-1.5 text-[#a39e97] hover:bg-[#fef2f2] hover:text-[#ea504c]" aria-label={`Sacar ${f.nombre} de la lista`}>
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      {editar ? (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10.5px] font-semibold text-[#7d6c64]">Mínimo Santa Fe</span>
            <div className="mt-0.5 flex items-center gap-1">
              <input
                value={f.minimo_sf}
                onChange={(e) => onCambiar({ minimo_sf: e.target.value })}
                inputMode="decimal"
                placeholder="0"
                className={cn('w-full rounded-xl border bg-white px-3 py-2.5 text-[15px] tabular-nums focus:outline-none', Number.isNaN(minSf) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')}
              />
              <span className="shrink-0 text-[11px] text-[#a39e97]">{f.unidad}</span>
            </div>
          </label>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-semibold text-[#7d6c64]">Mínimo la 24</span>
              <button type="button" onClick={() => onCambiar({ va_a_la_24: !f.va_a_la_24 })} className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', f.va_a_la_24 ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#f3efe9] text-[#a39e97]')}>
                {f.va_a_la_24 ? 'va a la 24' : 'no va'}
              </button>
            </div>
            {f.va_a_la_24 ? (
              <div className="mt-0.5 flex items-center gap-1">
                <input
                  value={f.minimo_24}
                  onChange={(e) => onCambiar({ minimo_24: e.target.value })}
                  inputMode="decimal"
                  placeholder="sin mínimo"
                  className={cn('w-full rounded-xl border bg-white px-3 py-2.5 text-[15px] tabular-nums focus:outline-none', Number.isNaN(min24) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')}
                />
                <span className="shrink-0 text-[11px] text-[#a39e97]">{f.unidad}</span>
              </div>
            ) : (
              <p className="mt-0.5 rounded-xl bg-[#faf8f5] px-3 py-2.5 text-[12px] text-[#a39e97]">No se manda</p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[12px] text-[#3d2c24]">
          Mínimo Santa Fe: <b>{minSf ? `${num(minSf)} ${f.unidad}` : '—'}</b>
          {' · '}la 24: <b>{f.va_a_la_24 ? (min24 ? `${num(min24)} ${f.unidad}` : 'sin mínimo') : 'no va'}</b>
        </p>
      )}

      {f.va_a_la_24 && <Linea24Info la24={la24} unidad={f.unidad} />}
    </div>
  )
}

function Linea24Info({ la24, unidad }: { la24: Linea24 | null; unidad: string }) {
  if (!la24) return <p className="mt-2 text-[11px] text-[#a39e97]">La 24 todavía no lo tiene en su lista.</p>
  if (!la24.vinculado) return <p className="mt-2 text-[11px] text-[#b0762a]">La 24 todavía no eligió cuál es este producto allá.</p>
  if (la24.unidad_compatible === false) {
    return <p className="mt-2 text-[11px] text-[#ea504c]">En la 24 es «{la24.producto_24}» y se cuenta en {la24.unidad_24}: no se puede comparar con {unidad}.</p>
  }
  return (
    <p className="mt-2 text-[11px] text-[#7d6c64]">
      En la 24: «{la24.producto_24}»
      {la24.stock != null && <> · hay {num(la24.stock)}</>}
      {la24.en_camino > 0 && <> · {num(la24.en_camino)} en camino</>}
      {la24.falta != null && la24.falta > 0 && <span className="font-semibold text-[#ea504c]"> · faltan {num(la24.falta)}</span>}
      {la24.stock != null && !la24.contado_hoy && <span className="text-[#a39e97]"> (sin contar hoy)</span>}
    </p>
  )
}
