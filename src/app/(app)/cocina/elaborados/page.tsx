'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNowStrict } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { ArrowLeft, Check, ChefHat, ClipboardList, Clock, Loader2, Minus, Plus, Scale } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isKitchenRole } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { LoHiceDialog } from '@/components/produccion/LoHiceDialog'
import { RecetaEditorDialog } from '@/components/produccion/RecetaEditorDialog'
import type { Elaborado, ElaboradosPayload } from '@/lib/produccion/elaborados'

// ---------------------------------------------------------------------------
// Elaborados de cocina — todo lo que se prepara, en un lugar
// ---------------------------------------------------------------------------
// Por cada elaborado: cuánto se usa por día, cuánto hay, qué lleva (receta de
// producción), cuánto dura, cuándo se hizo por última vez. Acciones: "Lo hice"
// (registra la tanda), cargar la receta, vida útil y conteo rápido.
// ---------------------------------------------------------------------------

const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 })
const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`
const hace = (iso: string | null) => (iso ? formatDistanceToNowStrict(new Date(iso), { locale: es, addSuffix: true }) : null)

// Misma regla que el servidor (lib/fudo/stock-sync): diferencias grandes piden nota
function necesitaNota(actual: number, nuevo: number, unit: string) {
  const abs = Math.abs(nuevo - actual)
  const pct = actual > 0 ? abs / actual : abs > 0 ? 1 : 0
  const kg = unit.toLowerCase().includes('kg')
  return abs >= (kg ? Math.max(0.5, actual * 0.12) : Math.max(2, actual * 0.15)) || pct >= 0.25
}

type Filtro = 'todos' | 'sin_receta' | 'sin_vida'

export default function ElaboradosPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const puedeVer = isKitchenRole(profile?.role)
  const [data, setData] = useState<ElaboradosPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modo, setModo] = useState<'lista' | 'contar'>('lista')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [loHice, setLoHice] = useState<Elaborado | null>(null)
  const [receta, setReceta] = useState<Elaborado | null>(null)

  const load = useCallback(async (fresh = false) => {
    try {
      const res = await fetch(`/api/produccion/elaborados${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar')
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }, [])

  useEffect(() => { if (puedeVer) void load() }, [puedeVer, load])

  const lista = useMemo(() => {
    const e = data?.elaborados ?? []
    if (filtro === 'sin_receta') return e.filter((x) => !x.receta)
    if (filtro === 'sin_vida') return e.filter((x) => !x.shelf_life_days)
    return e
  }, [data, filtro])

  if (profileLoading) return <Centro><Loader2 className="size-6 animate-spin text-[#006d5a]" /></Centro>
  if (!puedeVer) return <Centro><p className="text-sm text-[#3d2c24]">Solo para cocina, encargados y socios</p></Centro>

  const usados = (data?.elaborados ?? []).filter((e) => e.uso_diario > 0)
  const sinReceta = usados.filter((e) => !e.receta).length
  const sinVida = usados.filter((e) => !e.shelf_life_days).length

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-4">
      <div className="flex items-center gap-2">
        <Link href="/cocina/produccion" aria-label="Volver" className="-ml-1.5 rounded-full p-1.5 hover:bg-black/5">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[#3d2c24]">Elaborados</h1>
          <p className="text-[11.5px] text-[#a39e97]">Lo que prepara la cocina: qué lleva, cuánto hay, cuánto dura</p>
        </div>
      </div>

      {error && !data && <div className="rounded-2xl bg-[#fef2f2] p-4 text-[13px] text-[#ea504c]">{error}</div>}
      {!data && !error && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-[#f3efe9]" />)}</div>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Dato titulo="Se usan" valor={usados.length} />
            <Dato titulo="Sin receta" valor={sinReceta} tono={sinReceta ? 'ambar' : 'ok'} />
            <Dato titulo="Sin vida útil" valor={sinVida} tono={sinVida ? 'ambar' : 'ok'} />
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[#f3efe9] p-1">
            {([['lista', 'Elaborados', ChefHat], ['contar', 'Contar', Scale]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => setModo(k)} className={cn('flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12.5px] font-semibold', modo === k ? 'bg-white text-[#3d2c24] shadow-sm' : 'text-[#7d6c64]')}>
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>

          {modo === 'lista' ? (
            <>
              <div className="flex gap-1.5">
                {([['todos', 'Todos'], ['sin_receta', `Sin receta (${sinReceta})`], ['sin_vida', `Sin vida útil (${sinVida})`]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setFiltro(k)} className={cn('rounded-full px-3 py-1 text-[11.5px] font-medium', filtro === k ? 'bg-[#e8f5f1] text-[#006d5a] ring-1 ring-[#006d5a]/30' : 'text-[#a39e97]')}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                {lista.map((e) => (
                  <TarjetaElaborado
                    key={e.id}
                    e={e}
                    puedeVida={data.permisos.vida_util}
                    puedeReceta={data.permisos.receta}
                    onLoHice={() => (e.receta ? setLoHice(e) : setReceta(e))}
                    onReceta={() => setReceta(e)}
                    onVidaGuardada={() => void load(true)}
                  />
                ))}
                {lista.length === 0 && <p className="py-8 text-center text-[13px] text-[#a39e97]">Nada con ese filtro</p>}
              </div>
            </>
          ) : (
            <Conteo elaborados={usados.length > 0 ? usados : data.elaborados} onListo={() => void load(true)} />
          )}
        </>
      )}

      {loHice && data && (
        <LoHiceDialog
          elaborado={loHice}
          puedeCerrar={data.permisos.cerrar_produccion}
          onClose={() => setLoHice(null)}
          onDone={() => { setLoHice(null); void load(true) }}
          onCargarReceta={data.permisos.receta ? () => { setReceta(loHice); setLoHice(null) } : undefined}
        />
      )}
      {receta && data && (
        data.permisos.receta ? (
          <RecetaEditorDialog elaborado={receta} insumos={data.insumos} onClose={() => setReceta(null)} onSaved={() => { setReceta(null); void load(true) }} />
        ) : (
          <LoHiceDialog elaborado={receta} puedeCerrar={false} onClose={() => setReceta(null)} onDone={() => setReceta(null)} />
        )
      )}
    </div>
  )
}

function TarjetaElaborado({ e, puedeVida, puedeReceta, onLoHice, onReceta, onVidaGuardada }: {
  e: Elaborado
  puedeVida: boolean
  puedeReceta: boolean
  onLoHice: () => void
  onReceta: () => void
  onVidaGuardada: () => void
}) {
  const [editVida, setEditVida] = useState(false)
  const [dias, setDias] = useState(e.shelf_life_days ?? 2)
  const [guardando, setGuardando] = useState(false)
  const sinStock = e.current_qty <= 0

  async function guardarVida() {
    setGuardando(true)
    try {
      const res = await fetch(`/api/stock/items/${e.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shelf_life_days: dias }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      toast.success(`${e.name}: dura ${dias} día${dias === 1 ? '' : 's'}`)
      setEditVida(false)
      onVidaGuardada()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-[#3d2c24]">{e.name}</p>
          <p className="text-[11.5px] text-[#7d6c64]">
            {e.uso_diario > 0 ? <>Se usan ~<b>{num(e.uso_diario)}</b>/día · </> : 'Sin uso en ventas · '}
            <span className={cn(sinStock && 'font-semibold text-[#ea504c]')}>hay {num(e.current_qty)} {e.unit}</span>
            {e.last_counted_at && <span className="text-[#a39e97]"> · contado {hace(e.last_counted_at)}</span>}
          </p>
        </div>
        <button
          onClick={onLoHice}
          className={cn('flex shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-semibold active:scale-95', e.receta ? 'bg-[#006d5a] text-white' : 'bg-[#fef7ed] text-[#d4943a] ring-1 ring-[#d4943a]/30')}
        >
          {e.receta ? <><Check className="size-3.5" /> Lo hice</> : <><ClipboardList className="size-3.5" /> {puedeReceta ? 'Cargar receta' : 'Sin receta'}</>}
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
        {e.receta ? (
          <button onClick={onReceta} disabled={!puedeReceta} className="rounded-full bg-[#e8f5f1] px-2.5 py-1 font-medium text-[#006d5a] disabled:cursor-default">
            Tanda: {num(e.receta.rinde)} {e.unit} · {e.receta.ingredientes.length} ingredientes
          </button>
        ) : (
          <span className="rounded-full bg-[#fef7ed] px-2.5 py-1 font-medium text-[#d4943a]">Sin receta</span>
        )}
        {e.receta?.costo_por_unidad != null && (
          <span className="rounded-full bg-[#f3efe9] px-2.5 py-1 text-[#7d6c64]">{money(e.receta.costo_por_unidad)} c/u según receta</span>
        )}
        <button
          onClick={() => puedeVida && setEditVida((v) => !v)}
          className={cn('flex items-center gap-1 rounded-full px-2.5 py-1', e.shelf_life_days ? 'bg-[#f3efe9] text-[#7d6c64]' : 'bg-[#fef7ed] font-medium text-[#d4943a]', !puedeVida && 'cursor-default')}
        >
          <Clock className="size-3" /> {e.shelf_life_days ? `Dura ${e.shelf_life_days} día${e.shelf_life_days === 1 ? '' : 's'}` : 'Sin vida útil'}
        </button>
        {e.ultima_produccion && <span className="rounded-full px-1 py-1 text-[#a39e97]">hecho {hace(e.ultima_produccion)}</span>}
      </div>

      {editVida && (
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-[#faf8f5] px-3 py-2">
          <span className="text-[12px] text-[#3d2c24]">Dura</span>
          <div className="flex items-center rounded-lg bg-white ring-1 ring-[#ebe6df]">
            <button onClick={() => setDias((d) => Math.max(1, d - 1))} aria-label="Menos" className="p-1.5"><Minus className="size-3.5" /></button>
            <span className="min-w-[4.5rem] text-center text-[13px] font-semibold">{dias} día{dias === 1 ? '' : 's'}</span>
            <button onClick={() => setDias((d) => Math.min(365, d + 1))} aria-label="Más" className="p-1.5"><Plus className="size-3.5" /></button>
          </div>
          <button onClick={() => void guardarVida()} disabled={guardando} className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
            {guardando ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Guardar
          </button>
        </div>
      )}
    </div>
  )
}

// Conteo rápido: se escribe lo que hay y se guarda todo junto
function Conteo({ elaborados, onListo }: { elaborados: Elaborado[]; onListo: () => void }) {
  const [valores, setValores] = useState<Record<string, string>>({})
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)

  const cargados = elaborados.filter((e) => (valores[e.id] ?? '').trim() !== '')
  const falta = cargados.filter((e) => {
    const n = parseFloat((valores[e.id] ?? '').replace(',', '.'))
    return !Number.isFinite(n) || n < 0 || (necesitaNota(e.current_qty, n, e.unit) && !(notas[e.id] ?? '').trim())
  })

  async function guardar() {
    setGuardando(true)
    setErrores({})
    let ok = 0
    const errs: Record<string, string> = {}
    for (const e of cargados) {
      const n = parseFloat((valores[e.id] ?? '').replace(',', '.'))
      try {
        const res = await fetch('/api/stock/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stockItemId: e.id, newQty: n, reason: 'physical_count', note: (notas[e.id] ?? '').trim() || 'Conteo rápido de elaborados' }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || json.success === false) throw new Error(json.error ?? 'No se pudo guardar')
        ok++
      } catch (err) {
        errs[e.id] = err instanceof Error ? err.message : 'Error'
      }
    }
    setGuardando(false)
    setErrores(errs)
    if (ok > 0) {
      toast.success(`${ok} elaborado${ok === 1 ? '' : 's'} contado${ok === 1 ? '' : 's'}`)
      setValores((v) => Object.fromEntries(Object.entries(v).filter(([id]) => errs[id])))
      onListo()
    }
    if (Object.keys(errs).length > 0) toast.error(`${Object.keys(errs).length} no se pudo guardar: revisalos`)
  }

  return (
    <div className="space-y-2">
      <p className="px-1 text-[11.5px] text-[#7d6c64]">
        Escribí cuánto hay de cada uno (en su unidad) y guardá todo junto. Lo que no contás, dejalo vacío.
      </p>
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
        {elaborados.map((e) => {
          const v = valores[e.id] ?? ''
          const n = parseFloat(v.replace(',', '.'))
          const pideNota = v.trim() !== '' && Number.isFinite(n) && necesitaNota(e.current_qty, n, e.unit)
          return (
            <div key={e.id} className="border-b border-[#f5f0ea] px-3.5 py-2.5 last:border-0">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[#3d2c24]">{e.name}</p>
                  <p className="text-[10.5px] text-[#a39e97]">Sistema: {num(e.current_qty)} {e.unit}{e.uso_diario > 0 && ` · ~${num(e.uso_diario)}/día`}</p>
                </div>
                <input
                  inputMode="decimal"
                  value={v}
                  onChange={(ev) => setValores((x) => ({ ...x, [e.id]: ev.target.value }))}
                  placeholder="—"
                  className="w-20 rounded-lg border border-[#ebe6df] px-2 py-1.5 text-right text-[14px] font-semibold tabular-nums outline-none focus:border-[#006d5a]"
                />
                <span className="w-12 text-[11px] text-[#a39e97]">{e.unit}</span>
              </div>
              {pideNota && (
                <input
                  value={notas[e.id] ?? ''}
                  onChange={(ev) => setNotas((x) => ({ ...x, [e.id]: ev.target.value }))}
                  placeholder="Diferencia grande: ¿qué pasó? (obligatorio)"
                  className="mt-1.5 w-full rounded-lg border border-[#d4943a]/50 bg-[#fef7ed] px-2 py-1.5 text-[12px] outline-none"
                />
              )}
              {errores[e.id] && <p className="mt-1 text-[11px] font-semibold text-[#ea504c]">{errores[e.id]}</p>}
            </div>
          )
        })}
      </div>
      <button
        onClick={() => void guardar()}
        disabled={guardando || cargados.length === 0 || falta.length > 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {guardando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Guardar conteo{cargados.length > 0 ? ` (${cargados.length})` : ''}
      </button>
      {falta.length > 0 && <p className="text-center text-[11px] text-[#d4943a]">Completá la nota de {falta.length === 1 ? 'la diferencia grande' : `las ${falta.length} diferencias grandes`}</p>}
    </div>
  )
}

function Dato({ titulo, valor, tono }: { titulo: string; valor: number; tono?: 'ambar' | 'ok' }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-[#ebe6df]">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#a39e97]">{titulo}</p>
      <p className={cn('mt-0.5 text-[20px] font-bold tabular-nums', tono === 'ambar' ? 'text-[#d4943a]' : tono === 'ok' ? 'text-[#006d5a]' : 'text-[#3d2c24]')}>{valor}</p>
    </div>
  )
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center">{children}</div>
}
