'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChefHat, ClipboardList, Clock, Loader2, Package, Plus, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isKitchenRole } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { coincideBusqueda } from '@/lib/buscar'
import { BackToHoy } from '@/components/layout/BackToHoy'
import { LoadingState } from '@/components/ui/LoadingState'
import type { InsumoEnviable } from '@/lib/envios/salientes'
import type { Parte, ParteResumen } from '@/lib/produccion/parte'
import { CONTROLES, calcularTarea, controlesSugeridos, type ControlId, type SalidaParte, type TareaParte } from '@/lib/produccion/parte-calculo'

// ---------------------------------------------------------------------------
// Parte de cierre — lo que el encargado de producción escribía por WhatsApp
// ---------------------------------------------------------------------------
// Hora de entrada y salida, y por cada tarea: qué materia prima entró y
// cuántos kilos, qué salió (porciones y kilos, y cocidos si hubo cocción), lo
// que volvió al freezer y el desperdicio. El rendimiento se calcula mientras
// se carga. Se va guardando; al cerrar, cada tarea queda como producción a
// confirmar por la jefa de cocina.
// ---------------------------------------------------------------------------

const TZ = 'America/Argentina/Buenos_Aires'
const URL = '/api/produccion/parte'

type Datos = { parte: Parte; falta_migracion: boolean; insumos: InsumoEnviable[]; historial: ParteResumen[] | null }

type SalidaUI = { id: string; stock_item_id: string | null; nombre: string; unidad: string | null; porciones: string; kg: string; kg_cocido: string; cocido: boolean; en_proceso: boolean }
type TareaUI = { id: string; crudo_stock_item_id: string | null; crudo_nombre: string; crudo_unidad: string | null; entrada_kg: string; vuelve_kg: string; desperdicio_kg: string; controles: ControlId[]; salidas: SalidaUI[]; nota: string; motivo: string; production_order_id: number | null }
type Borrador = { entrada: string; salida: string; nota: string; tareas: TareaUI[] }

async function fetcher(url: string): Promise<Datos> {
  const r = await fetch(url)
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw new Error(j?.error ?? 'No se pudo cargar')
  return j as Datos
}

const nuevoId = () => Math.random().toString(36).slice(2, 10)
const aTexto = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
/** '' → null; '12,615' → 12.615; inválido → NaN */
const leer = (s: string): number | null => {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}
const numOk = (s: string) => { const n = leer(s); return n == null || Number.isNaN(n) ? null : n }
const kg = (n: number) => `${Number(n.toFixed(3)).toLocaleString('es-AR')} kg`
const horaDe = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const ahoraHHMM = () => new Date().toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const fechaTxt = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const esMasa = (u: string | null) => /^(kg|g)$/i.test((u ?? '').trim())

const salidaUI = (s: SalidaParte): SalidaUI => ({ id: s.id, stock_item_id: s.stock_item_id, nombre: s.nombre, unidad: s.unidad, porciones: aTexto(s.porciones), kg: aTexto(s.kg), kg_cocido: aTexto(s.kg_cocido), cocido: s.kg_cocido != null, en_proceso: s.en_proceso })
const tareaUI = (t: TareaParte): TareaUI => ({ id: t.id, crudo_stock_item_id: t.crudo_stock_item_id, crudo_nombre: t.crudo_nombre, crudo_unidad: t.crudo_unidad, entrada_kg: aTexto(t.entrada_kg), vuelve_kg: aTexto(t.vuelve_kg), desperdicio_kg: aTexto(t.desperdicio_kg), controles: t.controles, salidas: t.salidas.map(salidaUI), nota: t.nota ?? '', motivo: t.motivo ?? '', production_order_id: t.production_order_id ?? null })
const aTarea = (t: TareaUI): TareaParte => ({
  id: t.id,
  crudo_stock_item_id: t.crudo_stock_item_id,
  crudo_nombre: t.crudo_nombre,
  crudo_unidad: t.crudo_unidad,
  entrada_kg: numOk(t.entrada_kg),
  vuelve_kg: numOk(t.vuelve_kg),
  desperdicio_kg: numOk(t.desperdicio_kg),
  controles: t.controles,
  salidas: t.salidas.map((s) => ({ id: s.id, stock_item_id: s.en_proceso ? null : s.stock_item_id, nombre: s.nombre, unidad: s.unidad, porciones: numOk(s.porciones), kg: numOk(s.kg), kg_cocido: s.cocido ? numOk(s.kg_cocido) : null, en_proceso: s.en_proceso })),
  nota: t.nota.trim() || null,
  motivo: t.motivo.trim() || null,
  production_order_id: t.production_order_id,
})
const borradorDe = (p: Parte): Borrador => ({ entrada: horaDe(p.entrada_at), salida: horaDe(p.salida_at), nota: p.nota ?? '', tareas: p.tareas.map(tareaUI) })
const firma = (b: Borrador) => JSON.stringify({ e: b.entrada, s: b.salida, n: b.nota.trim(), t: b.tareas.map(aTarea) })
const tareaVacia = (): TareaUI => ({ id: nuevoId(), crudo_stock_item_id: null, crudo_nombre: '', crudo_unidad: null, entrada_kg: '', vuelve_kg: '', desperdicio_kg: '', controles: [], salidas: [], nota: '', motivo: '', production_order_id: null })
const salidaVacia = (): SalidaUI => ({ id: nuevoId(), stock_item_id: null, nombre: '', unidad: null, porciones: '', kg: '', kg_cocido: '', cocido: false, en_proceso: false })

export default function ParteDeCierrePage() {
  const { profile, loading: cargandoPerfil } = useProfileContext()
  const puede = isKitchenRole(profile?.role)
  const { data, error, isLoading, mutate } = useSWR(puede ? URL : null, fetcher, { revalidateOnFocus: false })
  const [edicion, setEdicion] = useState<Borrador | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [erroresServidor, setErroresServidor] = useState<string[]>([])

  const servidor = useMemo(() => (data ? borradorDe(data.parte) : null), [data])
  const b = edicion ?? servidor
  const sucio = !!edicion && !!servidor && firma(edicion) !== firma(servidor)
  const cambiar = (fn: (x: Borrador) => Borrador) => setEdicion((e) => fn(e ?? servidor!))

  if (cargandoPerfil) return <LoadingState />
  if (!puede) return <p className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-[#7d6c64]">Esta pantalla es de cocina, chef, encargados y socios.</p>
  if (isLoading && !data) return <LoadingState />
  if (error && !data) return <p className="mx-auto max-w-lg rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#ea504c]">{error.message}</p>
  if (!data || !b) return <LoadingState />

  const parte = data.parte
  const cerrado = parte.estado === 'cerrado'

  /** Guarda el borrador; devuelve el id del parte (o null si falló) */
  async function guardar(silencioso = false): Promise<string | null> {
    if (!b) return null
    setGuardando(true)
    try {
      const r = await fetch(URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: parte.fecha, entrada: b.entrada || null, salida: b.salida || null, nota: b.nota || null, tareas: b.tareas.map(aTarea) }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) { toast.error(j?.error ?? 'No se pudo guardar'); return null }
      await mutate({ ...data!, parte: j.parte as Parte }, { revalidate: false })
      setEdicion(null)
      if (!silencioso) toast.success('Parte guardado')
      return (j.parte as Parte).id
    } finally {
      setGuardando(false)
    }
  }

  async function cerrar() {
    setErroresServidor([])
    const id = sucio || !parte.id ? await guardar(true) : parte.id
    if (!id) return
    setCerrando(true)
    try {
      const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'cerrar', id }) })
      const j = await r.json().catch(() => null)
      if (!r.ok) {
        setErroresServidor(Array.isArray(j?.errores) ? j.errores : [])
        toast.error(j?.error ?? 'No se pudo cerrar el parte')
        return
      }
      toast.success('Parte cerrado: la jefa de cocina confirma la producción')
      for (const a of (j?.avisos ?? []) as string[]) toast(a)
      setEdicion(null)
      await mutate()
    } finally {
      setCerrando(false)
    }
  }

  // Lo que falta para cerrar (misma regla que el servidor)
  const tareas = b.tareas.map(aTarea)
  const faltan = [
    ...(!b.entrada ? ['Falta la hora de entrada'] : []),
    ...(!b.salida ? ['Falta la hora de salida'] : []),
    ...(b.tareas.length === 0 ? ['Cargá al menos una tarea'] : []),
    ...tareas.flatMap((t) => calcularTarea(t).errores),
  ]

  return (
    <div className={cn('mx-auto max-w-lg space-y-4', cerrado ? 'pb-32' : 'pb-48')}>
      <BackToHoy />

      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-[#006d5a]/10">
          <ClipboardList className="size-4 text-[#006d5a]" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-[#3d2c24]">Parte de cierre</h1>
          <p className="text-[12px] text-[#7d6c64]">Noche del {fechaTxt(parte.fecha)} · {cerrado ? 'cerrado' : 'se va guardando'}</p>
        </div>
      </div>

      {data.falta_migracion && <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] font-semibold text-[#ea504c]">Falta correr la migración del parte (20261117_partes_produccion.sql).</p>}

      {cerrado ? (
        <ParteCerrado parte={parte} />
      ) : (
        <>
          {/* Horario */}
          <section className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#3d2c24]"><Clock className="size-4 text-[#006d5a]" /> Horario</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10.5px] font-semibold text-[#7d6c64]">Entrada</span>
                <input type="time" value={b.entrada} onChange={(e) => { const v = e.target.value; cambiar((x) => ({ ...x, entrada: v })) }} className="mt-0.5 w-full rounded-xl border border-[#ebe6df] px-3 py-2.5 text-[16px] tabular-nums focus:border-[#006d5a] focus:outline-none" />
                {parte.entrada_fichaje && b.entrada !== horaDe(parte.entrada_fichaje) && (
                  <button type="button" onClick={() => cambiar((x) => ({ ...x, entrada: horaDe(parte.entrada_fichaje) }))} className="mt-1 text-[11px] font-semibold text-[#006d5a] underline">Fichaste a las {horaDe(parte.entrada_fichaje)}</button>
                )}
              </label>
              <label className="block">
                <span className="text-[10.5px] font-semibold text-[#7d6c64]">Salida</span>
                <input type="time" value={b.salida} onChange={(e) => { const v = e.target.value; cambiar((x) => ({ ...x, salida: v })) }} className="mt-0.5 w-full rounded-xl border border-[#ebe6df] px-3 py-2.5 text-[16px] tabular-nums focus:border-[#006d5a] focus:outline-none" />
                <button type="button" onClick={() => cambiar((x) => ({ ...x, salida: ahoraHHMM() }))} className="mt-1 text-[11px] font-semibold text-[#006d5a] underline">Ahora</button>
              </label>
            </div>
          </section>

          {/* Tareas */}
          {b.tareas.map((t, i) => (
            <TareaCard
              key={t.id}
              n={i + 1}
              tarea={t}
              insumos={data.insumos}
              onCambiar={(fn) => cambiar((x) => ({ ...x, tareas: x.tareas.map((y) => (y.id === t.id ? fn(y) : y)) }))}
              onQuitar={() => cambiar((x) => ({ ...x, tareas: x.tareas.filter((y) => y.id !== t.id) }))}
            />
          ))}
          <button type="button" onClick={() => cambiar((x) => ({ ...x, tareas: [...x.tareas, tareaVacia()] }))} className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-[#cfe5de] bg-[#f6fbf9] py-3.5 text-[14px] font-bold text-[#006d5a] active:scale-[0.99]">
            <Plus className="size-4" /> Agregar tarea (pollo, lomo, bondiola…)
          </button>

          <textarea value={b.nota} onChange={(e) => { const v = e.target.value; cambiar((x) => ({ ...x, nota: v })) }} rows={2} maxLength={1000} placeholder="Nota general de la noche (opcional)" className="w-full resize-none rounded-xl border border-[#e6dfd7] bg-white px-3 py-2 text-[12.5px] focus:border-[#006d5a] focus:outline-none" />

          {(faltan.length > 0 || erroresServidor.length > 0) && b.tareas.length > 0 && (
            <div className="rounded-xl bg-[#fdf6ec] px-3 py-2.5 text-[11.5px] text-[#b0762a]">
              <p className="font-semibold">Para cerrar falta:</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">{[...new Set([...faltan, ...erroresServidor])].slice(0, 8).map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}

          {/* Barra fija: guardar y cerrar */}
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 flex justify-center gap-2 px-4">
            <button type="button" onClick={() => void guardar()} disabled={guardando || cerrando || !sucio} className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#3d2c24] shadow-xl ring-1 ring-[#ebe6df] active:scale-95 disabled:opacity-50">
              {guardando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {sucio ? 'Guardar' : 'Guardado'}
            </button>
            <button type="button" onClick={() => void cerrar()} disabled={guardando || cerrando || faltan.length > 0} className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-[#006d5a] px-6 py-3 text-sm font-bold text-white shadow-xl active:scale-95 disabled:opacity-40">
              {cerrando ? <Loader2 className="size-4 animate-spin" /> : <ClipboardList className="size-4" />} Cerrar parte
            </button>
          </div>
        </>
      )}

      {data.historial && data.historial.length > 0 && <Historial partes={data.historial} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Una tarea
// ---------------------------------------------------------------------------

function TareaCard({ n, tarea: t, insumos, onCambiar, onQuitar }: { n: number; tarea: TareaUI; insumos: InsumoEnviable[]; onCambiar: (fn: (t: TareaUI) => TareaUI) => void; onQuitar: () => void }) {
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)
  const calc = calcularTarea(aTarea(t))
  const crudos = useMemo(() => [...insumos].sort((a, b) => Number(a.elaborado) - Number(b.elaborado) || a.name.localeCompare(b.name, 'es')), [insumos])
  const crudo = t.crudo_stock_item_id ? insumos.find((i) => i.id === t.crudo_stock_item_id) : undefined
  const mal = (s: string) => Number.isNaN(leer(s))
  const set = (patch: Partial<TareaUI>) => onCambiar((x) => ({ ...x, ...patch }))
  const setSalida = (id: string, patch: Partial<SalidaUI>) => onCambiar((x) => ({ ...x, salidas: x.salidas.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const entrada = numOk(t.entrada_kg)

  return (
    <section className="space-y-3 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
      <div className="flex items-start gap-2">
        <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#006d5a] text-[11px] font-bold text-white">{n}</span>
        <div className="min-w-0 flex-1">
          {t.crudo_stock_item_id ? (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[14px] font-bold text-[#3d2c24]">{t.crudo_nombre}</p>
              {!t.production_order_id && <button type="button" onClick={() => set({ crudo_stock_item_id: null, crudo_nombre: '', crudo_unidad: null })} className="text-[11px] font-semibold text-[#7d6c64] underline">cambiar</button>}
            </div>
          ) : (
            <Elegir items={crudos} placeholder="¿Qué entró? (pollo, lomo, nalga…)" onElegir={(i) => set({ crudo_stock_item_id: i.id, crudo_nombre: i.name, crudo_unidad: i.unit, controles: t.controles.length ? t.controles : controlesSugeridos(i.name) })} />
          )}
          {crudo && entrada != null && crudo.current_qty < entrada && (
            <p className="mt-1 text-[10.5px] text-[#b0762a]">En la app hay {kg(crudo.current_qty)}: si no se cuenta antes, la confirmación se va a trabar.</p>
          )}
        </div>
        {!t.production_order_id && (confirmarQuitar ? (
          <span className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setConfirmarQuitar(false)} className="rounded-lg p-1.5 text-[#7d6c64]" aria-label="No quitar"><X className="size-4" /></button>
            <button type="button" onClick={onQuitar} className="rounded-lg bg-[#ea504c] px-2 py-1 text-[11px] font-bold text-white">Quitar</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmarQuitar(true)} className="shrink-0 rounded-lg p-1.5 text-[#a39e97] hover:bg-[#fef2f2] hover:text-[#ea504c]" aria-label="Quitar tarea"><Trash2 className="size-4" /></button>
        ))}
      </div>

      <label className="block">
        <span className="text-[10.5px] font-semibold text-[#7d6c64]">Entró (kg)</span>
        <input value={t.entrada_kg} onChange={(e) => set({ entrada_kg: e.target.value })} inputMode="decimal" placeholder="ej. 12,615" className={cn('mt-0.5 w-full rounded-xl border px-3 py-2.5 text-[17px] tabular-nums focus:outline-none', mal(t.entrada_kg) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')} />
      </label>

      {/* Salidas */}
      <div className="space-y-2">
        <p className="text-[10.5px] font-semibold text-[#7d6c64]">Salió</p>
        {t.salidas.map((s) => (
          <div key={s.id} className="space-y-2 rounded-xl bg-[#faf8f5] p-2.5 ring-1 ring-[#f0ebe4]">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {s.en_proceso ? (
                  <input value={s.nombre} onChange={(e) => setSalida(s.id, { nombre: e.target.value })} placeholder="¿Qué quedó en proceso? (ej. nalga en huevada)" className="w-full rounded-lg border border-[#ebe6df] bg-white px-2.5 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none" />
                ) : s.stock_item_id ? (
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#3d2c24]">{s.nombre}</p>
                    <button type="button" onClick={() => setSalida(s.id, { stock_item_id: null, nombre: '', unidad: null })} className="text-[11px] font-semibold text-[#7d6c64] underline">cambiar</button>
                  </div>
                ) : (
                  <Elegir items={insumos} placeholder="¿A qué producto va?" onElegir={(i) => setSalida(s.id, { stock_item_id: i.id, nombre: i.name, unidad: i.unit })} />
                )}
                {!s.en_proceso && s.stock_item_id && !insumos.find((i) => i.id === s.stock_item_id)?.en_fudo && (
                  <p className="mt-1 text-[10.5px] text-[#ea504c]">Este producto no está vinculado a Fudo: la producción no se va a poder confirmar.</p>
                )}
              </div>
              <button type="button" onClick={() => onCambiar((x) => ({ ...x, salidas: x.salidas.filter((y) => y.id !== s.id) }))} className="shrink-0 rounded-lg p-1 text-[#a39e97] hover:text-[#ea504c]" aria-label="Quitar salida"><X className="size-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {!s.en_proceso && !esMasa(s.unidad) && (
                <label className="block">
                  <span className="text-[10px] font-semibold text-[#7d6c64]">Porciones</span>
                  <input value={s.porciones} onChange={(e) => setSalida(s.id, { porciones: e.target.value })} inputMode="decimal" placeholder="0" className={cn('mt-0.5 w-full rounded-lg border bg-white px-2.5 py-2 text-[15px] tabular-nums focus:outline-none', mal(s.porciones) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')} />
                </label>
              )}
              <label className="block">
                <span className="text-[10px] font-semibold text-[#7d6c64]">Kilos</span>
                <input value={s.kg} onChange={(e) => setSalida(s.id, { kg: e.target.value })} inputMode="decimal" placeholder="0" className={cn('mt-0.5 w-full rounded-lg border bg-white px-2.5 py-2 text-[15px] tabular-nums focus:outline-none', mal(s.kg) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')} />
              </label>
              {s.cocido && (
                <label className="block">
                  <span className="text-[10px] font-semibold text-[#7d6c64]">Kilos cocido</span>
                  <input value={s.kg_cocido} onChange={(e) => setSalida(s.id, { kg_cocido: e.target.value })} inputMode="decimal" placeholder="0" className={cn('mt-0.5 w-full rounded-lg border bg-white px-2.5 py-2 text-[15px] tabular-nums focus:outline-none', mal(s.kg_cocido) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')} />
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setSalida(s.id, { cocido: !s.cocido })} className={cn('rounded-full px-2.5 py-1 text-[10.5px] font-semibold', s.cocido ? 'bg-[#3d2c24] text-white' : 'bg-white text-[#7d6c64] ring-1 ring-[#ebe6df]')}>Se cocinó</button>
              <button type="button" onClick={() => setSalida(s.id, { en_proceso: !s.en_proceso, stock_item_id: null, nombre: s.en_proceso ? '' : s.nombre, unidad: null })} className={cn('rounded-full px-2.5 py-1 text-[10.5px] font-semibold', s.en_proceso ? 'bg-[#3d2c24] text-white' : 'bg-white text-[#7d6c64] ring-1 ring-[#ebe6df]')}>Queda en proceso</button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => onCambiar((x) => ({ ...x, salidas: [...x.salidas, salidaVacia()] }))} className="flex w-full items-center justify-center gap-1 rounded-xl bg-[#f3efe9] py-2.5 text-[12.5px] font-semibold text-[#3d2c24]">
          <Plus className="size-3.5" /> Agregar lo que salió
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10.5px] font-semibold text-[#7d6c64]">Volvió al freezer (kg)</span>
          <input value={t.vuelve_kg} onChange={(e) => set({ vuelve_kg: e.target.value })} inputMode="decimal" placeholder="0" className={cn('mt-0.5 w-full rounded-xl border px-3 py-2 text-[15px] tabular-nums focus:outline-none', mal(t.vuelve_kg) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')} />
        </label>
        <label className="block">
          <span className="text-[10.5px] font-semibold text-[#7d6c64]">Desperdicio (kg)</span>
          <input value={t.desperdicio_kg} onChange={(e) => set({ desperdicio_kg: e.target.value })} inputMode="decimal" placeholder={calc.desperdicio_calculado != null ? `${String(calc.desperdicio_calculado).replace('.', ',')} (calculado)` : '0'} className={cn('mt-0.5 w-full rounded-xl border px-3 py-2 text-[15px] tabular-nums focus:outline-none', mal(t.desperdicio_kg) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')} />
        </label>
      </div>

      {/* Rendimiento */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CONTROLES) as ControlId[]).map((id) => (
            <button key={id} type="button" onClick={() => set({ controles: t.controles.includes(id) ? t.controles.filter((c) => c !== id) : [...t.controles, id] })} className={cn('rounded-full px-2.5 py-1 text-[10.5px] font-semibold', t.controles.includes(id) ? 'bg-[#006d5a] text-white' : 'bg-[#f3efe9] text-[#a39e97]')}>
              {CONTROLES[id].nombre}
            </button>
          ))}
        </div>
        {calc.controles.map((c) => (
          <p key={c.control} className={cn('rounded-lg px-2.5 py-1.5 text-[12px]', c.estado === 'ok' ? 'bg-[#e8f5f1] text-[#006d5a]' : c.estado === 'bajo' ? 'bg-[#fef2f2] font-semibold text-[#ea504c]' : 'bg-[#f3efe9] text-[#7d6c64]')}>
            {c.estado === 'ok' ? '✓' : c.estado === 'bajo' ? '✗' : '…'} <b>{c.nombre}:</b> {c.detalle}
          </p>
        ))}
        {calc.diferencia_kg != null && Math.abs(calc.diferencia_kg) >= 0.01 && (
          <p className="flex items-start gap-1 text-[11px] text-[#b0762a]"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> No cierran {kg(Math.abs(calc.diferencia_kg))} entre lo que entró, lo que salió y el desperdicio.</p>
        )}
      </div>

      {calc.bajo && (
        <textarea value={t.motivo} onChange={(e) => set({ motivo: e.target.value })} rows={2} maxLength={500} placeholder="¿Por qué dio bajo? (obligatorio)" className={cn('w-full resize-none rounded-xl border px-3 py-2 text-[13px] focus:outline-none', t.motivo.trim().length >= 3 ? 'border-[#ebe6df] focus:border-[#006d5a]' : 'border-[#ea504c]')} />
      )}
      <input value={t.nota} onChange={(e) => set({ nota: e.target.value })} maxLength={500} placeholder="Nota (ej. cajón abierto, faltaban ~2 kg)" className="w-full rounded-xl border border-[#e6dfd7] px-3 py-2 text-[12.5px] focus:border-[#006d5a] focus:outline-none" />
      {t.production_order_id && <p className="text-[11px] text-[#006d5a]">✓ Producción creada (la confirma la jefa de cocina)</p>}
    </section>
  )
}

function Elegir({ items, placeholder, onElegir }: { items: InsumoEnviable[]; placeholder: string; onElegir: (i: InsumoEnviable) => void }) {
  const [q, setQ] = useState('')
  const t = q.trim()
  const resultados = t.length >= 1 ? items.filter((i) => coincideBusqueda(i.name, t)).slice(0, 8) : []
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-[#e6dfd7] bg-white py-2.5 pl-8 pr-3 text-[13px] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none" />
      </div>
      {resultados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#ebe6df] bg-white">
          {resultados.map((i) => (
            <button key={i.id} type="button" onClick={() => { onElegir(i); setQ('') }} className="flex w-full items-center gap-2 border-b border-[#f3efe9] px-3 py-2.5 text-left last:border-b-0 hover:bg-[#f8f5f0]">
              {i.elaborado ? <ChefHat className="size-3.5 shrink-0 text-[#006d5a]" /> : <Package className="size-3.5 shrink-0 text-[#a39e97]" />}
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#3d2c24]">{i.name}</span>
              <span className="shrink-0 text-[10.5px] text-[#a39e97]">{i.unit}</span>
            </button>
          ))}
        </div>
      )}
      {t.length >= 2 && resultados.length === 0 && <p className="text-[11px] text-[#a39e97]">No hay ningún insumo activo con ese nombre.</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Parte cerrado e historial
// ---------------------------------------------------------------------------

function ParteCerrado({ parte }: { parte: Parte }) {
  const r = parte.resultado
  return (
    <section className="space-y-2">
      <p className="rounded-xl bg-[#e8f5f1] px-3 py-2.5 text-[12.5px] text-[#006d5a]">
        ✓ Cerrado {parte.cerrado_at ? `a las ${horaDe(parte.cerrado_at)}` : ''} · {horaDe(parte.entrada_at)} a {horaDe(parte.salida_at)}{r ? ` (${r.horas.toLocaleString('es-AR')} h)` : ''}.
        {r && r.producciones.length > 0 && ' La producción la confirma la jefa de cocina.'}
      </p>
      {(r?.tareas ?? []).map((t) => (
        <div key={t.id} className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
          <p className="text-[13px] font-bold text-[#3d2c24]">{t.crudo}</p>
          {t.controles.map((c) => (
            <p key={c.nombre} className={cn('mt-1 text-[12px]', c.estado === 'ok' ? 'text-[#006d5a]' : c.estado === 'bajo' ? 'font-semibold text-[#ea504c]' : 'text-[#7d6c64]')}>
              {c.estado === 'ok' ? '✓' : c.estado === 'bajo' ? '✗' : '…'} {c.nombre}: {c.detalle}
            </p>
          ))}
          {t.motivo && <p className="mt-1 text-[11.5px] italic text-[#7d6c64]">Motivo: «{t.motivo}»</p>}
          {t.desperdicio_kg != null && t.desperdicio_kg > 0 && <p className="mt-1 text-[11.5px] text-[#7d6c64]">Desperdicio: {kg(t.desperdicio_kg)}</p>}
        </div>
      ))}
      <Link href="/cocina/a-producir" className="block rounded-xl bg-[#f3efe9] px-3 py-2.5 text-center text-[12.5px] font-semibold text-[#3d2c24]">Ver qué falta y armar el envío a la 24 →</Link>
    </section>
  )
}

function Historial({ partes }: { partes: ParteResumen[] }) {
  return (
    <section className="space-y-1.5 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#a39e97]">Últimos partes</p>
      {partes.map((p) => (
        <div key={p.id} className="flex items-start justify-between gap-2 border-b border-[#f3efe9] pb-1.5 text-[12px] last:border-b-0">
          <div className="min-w-0">
            <p className="font-semibold text-[#3d2c24]">{fechaTxt(p.fecha)} · {p.quien ?? 'Alguien'}</p>
            <p className="text-[11px] text-[#7d6c64]">{p.entrada_at ? `${horaDe(p.entrada_at)} a ${horaDe(p.salida_at) || '—'}` : 'sin horario'} · {p.tareas} tarea{p.tareas === 1 ? '' : 's'}</p>
            {p.bajos.length > 0 && <p className="text-[11px] font-semibold text-[#ea504c]">Bajo: {p.bajos.join(', ')}</p>}
          </div>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', p.estado === 'cerrado' ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#fdf6ec] text-[#b0762a]')}>{p.estado === 'cerrado' ? 'cerrado' : 'abierto'}</span>
        </div>
      ))}
    </section>
  )
}
