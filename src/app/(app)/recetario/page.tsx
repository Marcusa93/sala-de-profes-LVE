'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, BookOpen, ChevronRight, Info, Loader2, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { canon, toStockUnitStrict } from '@/lib/recipes/recipe-cost'
import { UNIDADES_RECETA, avisoCantidad, unidadSugerida } from '@/lib/recipes/recetario-platos'

// ---------------------------------------------------------------------------
// Recetario de platos — qué lleva cada plato de la carta, por porción
// ---------------------------------------------------------------------------
// No es producción: es la ficha del plato (el sándwich lleva pan, 60 g de
// jamón, 2 fetas de queso…). Sirve para el costo y el margen, para las
// compras sugeridas y para que cocina lo arme siempre igual. Editan socio,
// encargado y chef; el resto lo consulta.
// ---------------------------------------------------------------------------

type Plato = {
  id: string; nombre: string; categoria: string; precio: number | null; ingredientes: number
  costo: number | null; costoCompleto: boolean; revisar: string[]; editadaEnApp: boolean; enFudo: boolean
}
type Insumo = { id: string; nombre: string; unidad: string; costo: number | null; elaborado: boolean }
type Linea = { key: string; stock_item_id: string; nombre: string; unidadStock: string; qty: string; unidad: string; nota: string | null }
type Detalle = {
  plato: { id: string; nombre: string; precio: number | null }
  preparacion: string; editadaEnApp: string | null; editadaPor: string | null; desdeFudo: string | null
  ingredientes: { stock_item_id: string; nombre: string; unidadStock: string; qty: number; unidad: string; nota: string | null }[]
  insumos: Insumo[]; puedeEditar: boolean
}
type Filtro = 'todos' | 'sin_receta' | 'revisar' | 'editadas'

const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`
const nuevaKey = () => Math.random().toString(36).slice(2)
const parseNum = (s: string) => parseFloat(s.replace(',', '.'))

export default function RecetarioPlatos() {
  const [platos, setPlatos] = useState<Plato[] | null>(null)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [categoria, setCategoria] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(() => fetch('/api/recetario', { cache: 'no-store' })
    .then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error ?? 'No se pudo cargar'); return }
      setPlatos(j.platos)
      setPuedeEditar(j.puedeEditar)
    })
    .catch(() => setError('No se pudo cargar')), [])
  useEffect(() => { void cargar() }, [cargar])

  const categorias = useMemo(() => [...new Set((platos ?? []).map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, 'es')), [platos])
  const cuenta = useMemo(() => {
    const l = platos ?? []
    return { todos: l.length, sin_receta: l.filter((p) => p.ingredientes === 0).length, revisar: l.filter((p) => p.revisar.length > 0).length, editadas: l.filter((p) => p.editadaEnApp).length }
  }, [platos])
  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return (platos ?? []).filter((p) =>
      (!q || p.nombre.toLowerCase().includes(q)) &&
      (!categoria || p.categoria === categoria) &&
      (filtro === 'todos' || (filtro === 'sin_receta' && p.ingredientes === 0) || (filtro === 'revisar' && p.revisar.length > 0) || (filtro === 'editadas' && p.editadaEnApp)))
  }, [platos, buscar, categoria, filtro])
  const porCategoria = useMemo(() => {
    const m = new Map<string, Plato[]>()
    for (const p of visibles) m.set(p.categoria, [...(m.get(p.categoria) ?? []), p])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'))
  }, [visibles])

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-4">
      <div>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-[#3d2c24]"><BookOpen className="size-5 text-[#d4943a]" /> Recetario de platos</h1>
        <p className="text-[11.5px] text-[#a39e97]">Qué lleva cada plato por porción. Sirve para el costo, las compras y para que cocina lo arme siempre igual.</p>
      </div>

      <div className="flex gap-2 rounded-xl bg-[#eef4fc] px-3 py-2 text-[11.5px] text-[#2f5f9a]">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>Fudo descuenta el stock al vender con <b>su propia receta</b>. Si cambiás un plato acá, cambialo también en Fudo para que el stock baje bien. Lo que edites acá no se pisa cuando se importa el Excel de Fudo.</p>
      </div>

      {error && <div className="rounded-2xl bg-[#fef2f2] p-4 text-[13px] text-[#ea504c]">{error}</div>}
      {!platos && !error && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-[#f3efe9]" />)}</div>}

      {platos && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {([['todos', 'Todos'], ['sin_receta', 'Sin receta'], ['revisar', '⚠ Para revisar'], ['editadas', 'Editadas acá']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFiltro(k)} className={cn('rounded-full px-3 py-1 text-[11.5px] font-medium', filtro === k ? (k === 'revisar' ? 'bg-[#fef2f2] text-[#ea504c] ring-1 ring-[#ea504c]/30' : 'bg-[#e8f5f1] text-[#006d5a] ring-1 ring-[#006d5a]/30') : 'bg-white text-[#7d6c64] ring-1 ring-[#ebe6df]')}>
                {label} <span className="opacity-60">{cuenta[k]}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-[#ebe6df]">
              <Search className="size-4 text-[#a39e97]" />
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar plato (sándwich, milanesa…)" className="flex-1 bg-transparent text-[13px] outline-none" />
            </div>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="max-w-[40%] rounded-xl bg-white px-2 text-[12.5px] text-[#3d2c24] ring-1 ring-[#ebe6df]">
              <option value="">Todas</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {porCategoria.length === 0 && <p className="py-8 text-center text-[13px] text-[#a39e97]">No hay platos con ese filtro.</p>}
          {porCategoria.map(([cat, items]) => (
            <section key={cat} className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <p className="border-b border-[#f5f0ea] bg-[#faf8f5] px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-[#7d6c64]">{cat} <span className="font-normal opacity-70">· {items.length}</span></p>
              <ul className="divide-y divide-[#f5f0ea]">
                {items.map((p) => {
                  const pct = p.costo && p.precio ? Math.round((100 * p.costo) / p.precio) : null
                  return (
                    <li key={p.id}>
                      <button onClick={() => setAbierto(p.id)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left hover:bg-[#fcfbf9]">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-[#3d2c24]">{p.nombre}</p>
                          <p className="truncate text-[11px] text-[#a39e97]">
                            {p.ingredientes === 0
                              ? <span className="font-semibold text-[#b0762a]">Sin receta</span>
                              : <>{p.ingredientes} ingrediente{p.ingredientes !== 1 ? 's' : ''}{p.costo ? <> · costo {money(p.costo)}{!p.costoCompleto && '*'}{pct != null && <> · <b className={pct > 35 ? 'text-[#ea504c]' : 'text-[#006d5a]'}>{pct}%</b> del precio</>}</> : ''}</>}
                            {p.editadaEnApp && <span className="text-[#4a90d9]"> · editada acá</span>}
                          </p>
                          {p.revisar.length > 0 && <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#ea504c]"><AlertTriangle className="size-3" /> Revisar: {p.revisar.slice(0, 3).join(', ')}</p>}
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-[#cfc8bf]" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          <p className="px-1 text-[11px] text-[#a39e97]">* Costo aproximado: algún insumo no tiene precio de compra cargado. · Las recetas de producción (milanesas, medallones…) están en Cocina → Elaborados. · <Link href="/recetas" className="underline">Recetas con preparación (anteriores)</Link></p>
        </>
      )}

      {abierto && <EditorPlato id={abierto} puedeEditar={puedeEditar} onClose={() => setAbierto(null)} onGuardado={() => { setAbierto(null); void cargar() }} />}
    </div>
  )
}

function EditorPlato({ id, puedeEditar, onClose, onGuardado }: { id: string; puedeEditar: boolean; onClose: () => void; onGuardado: () => void }) {
  const [d, setD] = useState<Detalle | null>(null)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [prep, setPrep] = useState('')
  const [buscar, setBuscar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [cambio, setCambio] = useState(false)

  useEffect(() => {
    void (async () => {
      const r = await fetch(`/api/recetario/${id}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j.error ?? 'No se pudo abrir'); onClose(); return }
      setD(j)
      setPrep(j.preparacion ?? '')
      setLineas((j as Detalle).ingredientes.map((i) => ({ key: nuevaKey(), stock_item_id: i.stock_item_id, nombre: i.nombre, unidadStock: i.unidadStock, qty: String(i.qty).replace('.', ','), unidad: normalizarUnidad(i.unidad, i.unidadStock), nota: i.nota })))
    })()
  }, [id, onClose])

  const insumoPorId = useMemo(() => new Map((d?.insumos ?? []).map((i) => [i.id, i])), [d])
  const sugeridos = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    if (q.length < 2 || !d) return []
    return d.insumos.filter((i) => i.nombre.toLowerCase().includes(q)).slice(0, 8)
  }, [buscar, d])

  const avisos = lineas.map((l) => avisoCantidad(parseNum(l.qty), l.unidad, l.unidadStock, l.nombre))
  const hayAvisos = avisos.some((a) => a?.grave)
  // Costo aproximado en vivo (con el precio de cada insumo)
  const costo = lineas.reduce((s, l) => {
    const i = insumoPorId.get(l.stock_item_id)
    const q = parseNum(l.qty)
    if (!i?.costo || !(q > 0)) return s
    const c = canon(q, l.unidad)
    const enStock = toStockUnitStrict(c.qty, c.unit, i.unidad)
    return enStock == null ? s : s + enStock * Number(i.costo)
  }, 0)
  const pct = d?.plato.precio && costo > 0 ? Math.round((100 * costo) / d.plato.precio) : null

  const cambiar = (key: string, patch: Partial<Linea>) => { setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); setCambio(true) }

  function agregar(i: Insumo) {
    setLineas((ls) => [...ls, { key: nuevaKey(), stock_item_id: i.id, nombre: i.nombre, unidadStock: i.unidad, qty: '', unidad: unidadSugerida(i.unidad), nota: null }])
    setBuscar('')
    setCambio(true)
  }

  async function guardar() {
    if (hayAvisos || guardando) return
    setGuardando(true)
    try {
      const r = await fetch(`/api/recetario/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preparacion: prep, ingredientes: lineas.map((l) => ({ stock_item_id: l.stock_item_id, qty: parseNum(l.qty), unidad: l.unidad, nota: l.nota })) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'No se pudo guardar')
      toast.success('Receta guardada. Acordate de cambiarla también en Fudo si cambió algo.')
      onGuardado()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !guardando) onClose() }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto">
        <DialogHeader><DialogTitle>{d?.plato.nombre ?? 'Cargando…'}</DialogTitle></DialogHeader>
        {!d ? <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-[#a39e97]" /></div> : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Dato titulo="Precio" valor={d.plato.precio ? money(d.plato.precio) : '—'} />
              <Dato titulo="Costo" valor={costo > 0 ? money(costo) : '—'} />
              <Dato titulo="Costo / precio" valor={pct != null ? `${pct}%` : '—'} tono={pct != null && pct > 35 ? 'rojo' : undefined} />
            </div>
            <p className="text-[11px] text-[#a39e97]">
              {d.editadaEnApp ? `Editada en la app${d.editadaPor ? ` por ${d.editadaPor}` : ''}.` : d.desdeFudo ? 'Importada del Excel de Fudo.' : ''} Cantidades <b>por porción</b>.
            </p>

            <ul className="space-y-1.5">
              {lineas.length === 0 && <li className="rounded-xl bg-[#faf8f5] px-3 py-3 text-center text-[12px] text-[#a39e97]">Todavía no tiene ingredientes.</li>}
              {lineas.map((l, idx) => (
                <li key={l.key} className={cn('rounded-xl px-2.5 py-2 ring-1', avisos[idx]?.grave ? 'bg-[#fffafa] ring-[#f3d0cf]' : avisos[idx] ? 'bg-[#fffaf2] ring-[#f0c98a]' : 'bg-white ring-[#ebe6df]')}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{l.nombre}{insumoPorId.get(l.stock_item_id)?.elaborado && <span className="ml-1 rounded bg-[#fdf6ec] px-1 text-[9.5px] font-bold text-[#b0762a]">ELABORADO</span>}</p>
                      <p className="text-[10.5px] text-[#a39e97]">en stock se cuenta en {l.unidadStock}</p>
                    </div>
                    <input value={l.qty} disabled={!puedeEditar} onChange={(e) => cambiar(l.key, { qty: e.target.value })} inputMode="decimal" placeholder="0" className="w-16 rounded-lg border border-[#ebe6df] px-2 py-1.5 text-right text-[13px] outline-none focus:border-[#d4943a] disabled:bg-transparent" />
                    <select value={l.unidad} disabled={!puedeEditar} onChange={(e) => cambiar(l.key, { unidad: e.target.value })} className="rounded-lg border border-[#ebe6df] bg-white px-1.5 py-1.5 text-[12.5px] disabled:bg-transparent">
                      {UNIDADES_RECETA.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    {puedeEditar && <button onClick={() => { setLineas((ls) => ls.filter((x) => x.key !== l.key)); setCambio(true) }} aria-label="Quitar" className="p-1 text-[#cfc8bf] hover:text-[#ea504c]"><X className="size-4" /></button>}
                  </div>
                  {avisos[idx] && <p className={cn('mt-1 text-[11px] font-semibold', avisos[idx]!.grave ? 'text-[#ea504c]' : 'text-[#b0762a]')}>⚠ {avisos[idx]!.texto}</p>}
                </li>
              ))}
            </ul>

            {puedeEditar && (
              <div className="relative">
                <div className="flex items-center gap-2 rounded-xl bg-[#faf8f5] px-3 py-2 ring-1 ring-[#ebe6df]">
                  <Plus className="size-4 text-[#006d5a]" />
                  <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Agregar ingrediente (pan, jamón, medallón…)" className="flex-1 bg-transparent text-[13px] outline-none" />
                </div>
                {sugeridos.length > 0 && (
                  <div className="absolute inset-x-0 z-10 mt-1 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-[#ebe6df]">
                    {sugeridos.map((i) => (
                      <button key={i.id} onClick={() => agregar(i)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[#f8f5f0]">
                        <span className="flex-1 truncate">{i.nombre}</span>
                        {i.elaborado && <span className="text-[9.5px] font-bold text-[#b0762a]">ELABORADO</span>}
                        <span className="text-[10.5px] text-[#a39e97]">{i.unidad}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-[#3d2c24]">Cómo se arma</span>
              <textarea value={prep} disabled={!puedeEditar} onChange={(e) => { setPrep(e.target.value); setCambio(true) }} rows={3} placeholder="Ej.: pan tostado, mayonesa de un lado, jamón, queso, gratinar 2 min…" className="w-full rounded-xl border border-[#ebe6df] px-3 py-2 text-[13px] outline-none placeholder:text-[#c4bdb7] focus:border-[#d4943a] disabled:bg-[#faf8f5]" />
            </label>

            {puedeEditar ? (
              <button onClick={() => void guardar()} disabled={guardando || hayAvisos || !cambio} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-[14px] font-bold text-white disabled:opacity-40">
                {guardando && <Loader2 className="size-4 animate-spin" />} {hayAvisos ? 'Corregí lo marcado en rojo' : 'Guardar receta'}
              </button>
            ) : (
              <p className="text-center text-[11.5px] text-[#a39e97]">Solo encargados, chef y socios pueden cambiar recetas.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Unidad guardada ('gramos', 'kg'…) → una de las del selector */
function normalizarUnidad(u: string | null, unidadStock: string): string {
  const x = (u ?? '').trim().toLowerCase()
  if (['g', 'gr', 'grs', 'gramos'].includes(x)) return 'g'
  if (['ml', 'cc'].includes(x)) return 'ml'
  if (['l', 'lt', 'litro', 'litros'].includes(x)) return 'l'
  if (['kg', 'kilo', 'kilos'].includes(x)) return 'kg'
  if (['u', 'un', 'unid', 'unidad', 'unidades'].includes(x)) return 'unidad'
  return unidadStock === 'kg' ? 'kg' : unidadStock === 'l' ? 'l' : 'unidad'
}

function Dato({ titulo, valor, tono }: { titulo: string; valor: string; tono?: 'rojo' }) {
  return (
    <div className="rounded-xl bg-[#faf8f5] px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">{titulo}</p>
      <p className={cn('text-[15px] font-bold', tono === 'rojo' ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>{valor}</p>
    </div>
  )
}
