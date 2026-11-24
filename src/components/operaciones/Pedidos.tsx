'use client'

import { useState } from 'react'
import { Check, Loader2, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { corta, diaDe, diasEntre, pct, sumar, type Ahora } from '@/lib/operaciones/fechas'
import { estDelegado, estPedido, nombreCorto, statsPedidos, textoResultado } from '@/lib/operaciones/pedidos'
import { ENCARGADOS, QUIENES, type DatosOperaciones, type PedidoSocio } from '@/lib/operaciones/tipos'
import { Chip, Kpi, Pills, Vacio, inputCls, type Tono } from './ui'

// ---------------------------------------------------------------------------
// Pedidos de socios: anotar, delegar, verificar y seguir a los encargados
// ---------------------------------------------------------------------------

export type Enviar = (body: Record<string, unknown>) => Promise<boolean>
export type SubPedidos = 'anotar' | 'verificar' | 'encargados'

type Props = {
  n: Ahora
  datos: DatosOperaciones
  editar: boolean
  sub: SubPedidos
  setSub: (s: SubPedidos) => void
  enviar: Enviar
}

const OPC_ENCARGADO = [{ v: '', label: 'Joaquín' }, ...ENCARGADOS.map((e) => ({ v: e as string, label: e.split(' ')[0] }))]

export function TabPedidos({ n, datos, editar, sub, setSub, enviar }: Props) {
  const mes = n.hoy.slice(0, 7)
  const abiertos = datos.pedidos.filter((p) => p.estado !== 'hecho').sort((a, b) => a.vence.localeCompare(b.vence))
  const vencidos = abiertos.filter((p) => p.vence < n.hoy).length
  const st = statsPedidos(datos.pedidos.filter((p) => p.cerrado?.slice(0, 7) === mes))
  const sinSegEnc = abiertos.filter((p) => estDelegado(p, n)).length

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-snug text-[#7d6c64]">Todo lo que pide un socio se anota, se delega y después se verifica. Respuesta en 48 h; delegar no lo saca de la lista.</p>

      <div className="grid grid-cols-3 gap-2">
        <Kpi k="Abiertos" v={String(abiertos.length)} sub={vencidos ? `${vencidos} vencidos` : 'ninguno vencido'} />
        <Kpi k="Cumplidos del mes" v={st.verificados ? `${pct(st.cumplidos, st.verificados)} %` : '—'} sub={`${st.cumplidos} de ${st.verificados}`} frac={pct(st.cumplidos, st.verificados)} />
        <Kpi k="A tiempo" v={st.cumplidos ? `${pct(st.aTiempo, st.cumplidos)} %` : '—'} sub={`${st.aTiempo} de ${st.cumplidos}`} frac={pct(st.aTiempo, st.cumplidos)} />
      </div>

      <div className="flex gap-1.5 rounded-2xl bg-[#f3efe9] p-1" role="group" aria-label="Vista de pedidos">
        {([['anotar', 'Anotar', 0], ['verificar', 'Verificar', vencidos], ['encargados', 'Encargados', sinSegEnc]] as const).map(([v, label, badge]) => (
          <button
            key={v}
            type="button"
            aria-pressed={sub === v}
            onClick={() => setSub(v)}
            className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[12.5px] font-bold transition-colors', sub === v ? 'bg-white text-[#006d5a] shadow-sm' : 'text-[#7d6c64]')}
          >
            {label}
            {badge > 0 && <span className="rounded-full bg-[#ea504c] px-1.5 text-[10px] text-white">{badge}</span>}
          </button>
        ))}
      </div>

      {sub === 'anotar' && (
        <>
          <FormPedido n={n} editar={editar} enviar={enviar} />
          {abiertos.length === 0 ? <Vacio ok>No hay pedidos abiertos.</Vacio> : abiertos.map((p) => <Tarjeta key={p.id} p={p} n={n} datos={datos} editar={editar} modo="anotar" enviar={enviar} />)}
        </>
      )}

      {sub === 'verificar' && (
        <>
          {abiertos.length === 0 ? <Vacio ok>Nada por verificar.</Vacio> : abiertos.map((p) => <Tarjeta key={p.id} p={p} n={n} datos={datos} editar={editar} modo="verificar" enviar={enviar} />)}
          <p className="pt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#a39e97]">Verificados</p>
          {(() => {
            const hechos = datos.pedidos.filter((p) => p.estado === 'hecho').slice(0, 25)
            return hechos.length === 0 ? <Vacio>Todavía no se verificó ningún pedido.</Vacio> : hechos.map((p) => <Tarjeta key={p.id} p={p} n={n} datos={datos} editar={editar} modo="verificar" enviar={enviar} />)
          })()}
        </>
      )}

      {sub === 'encargados' && <Encargados n={n} datos={datos} editar={editar} enviar={enviar} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Plegado detrás de un botón: así se ven primero los pedidos abiertos */
function FormPedido({ n, editar, enviar }: { n: Ahora; editar: boolean; enviar: Enviar }) {
  const [abierto, setAbierto] = useState(false)
  const [que, setQue] = useState('')
  const [quien, setQuien] = useState<string>(QUIENES[0])
  const [del, setDel] = useState('')
  const [vence, setVence] = useState(() => sumar(n.hoy, 2))
  const [comp, setComp] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function anotar(e: React.FormEvent) {
    e.preventDefault()
    if (!que.trim() || !vence) return
    setGuardando(true)
    const ok = await enviar({ accion: 'pedido_nuevo', que: que.trim(), pedido_por: quien, delegado_a: del || null, vence, compromiso: del && comp ? comp : null })
    setGuardando(false)
    if (ok) { setQue(''); setComp(''); setDel(''); setVence(sumar(n.hoy, 2)); setAbierto(false) }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#cfe4dd] bg-white py-3 text-[13.5px] font-bold text-[#006d5a] active:scale-[0.98]"
      >
        <Plus className="size-4" /> Anotar pedido
      </button>
    )
  }

  return (
    <form onSubmit={(e) => void anotar(e)} className="space-y-3 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
      <label className="block">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#7d6c64]">Qué pidieron</span>
        <input value={que} onChange={(e) => setQue(e.target.value)} required autoFocus maxLength={200} placeholder="Ej.: presupuesto de la cámara de frío" className={cn(inputCls, 'mt-1')} />
      </label>
      <div>
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#7d6c64]">Quién lo pidió</span>
        <div className="mt-1"><Pills opciones={QUIENES.map((q) => ({ v: q as string, label: q }))} valor={quien} onCambiar={setQuien} etiqueta="Quién lo pidió" /></div>
      </div>
      {editar && (
        <div>
          <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#7d6c64]">Quién se encarga</span>
          <div className="mt-1"><Pills opciones={OPC_ENCARGADO} valor={del} onCambiar={setDel} etiqueta="Quién se encarga" /></div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#7d6c64]">Vence (para el socio)</span>
          <input type="date" value={vence} min={n.hoy} onChange={(e) => setVence(e.target.value)} required className={cn(inputCls, 'mt-1')} />
        </label>
        {editar && del && (
          <label className="block">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#7d6c64]">Compromiso de {del.split(' ')[0]}</span>
            <input type="date" value={comp} min={n.hoy} onChange={(e) => setComp(e.target.value)} className={cn(inputCls, 'mt-1')} />
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setAbierto(false)} disabled={guardando} className="rounded-xl bg-[#f3efe9] px-4 py-3 text-[13px] font-semibold text-[#7d6c64]">
          Cancelar
        </button>
        <button type="submit" disabled={guardando || !que.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-[13.5px] font-bold text-white active:scale-[0.98] disabled:opacity-50">
          {guardando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Anotar pedido
        </button>
      </div>
      {!editar && <p className="text-center text-[11px] text-[#a39e97]">Joaquín lo ve en su lista y decide quién se encarga.</p>}
    </form>
  )
}

// ---------------------------------------------------------------------------

function chipVence(p: PedidoSocio, n: Ahora): { tono: Tono; txt: string } {
  const d = diasEntre(n.hoy, p.vence)
  if (d < 0) return { tono: 'rojo', txt: `Venció ${corta(p.vence)}` }
  if (d === 0) return { tono: 'ambar', txt: 'Vence hoy' }
  if (d === 1) return { tono: 'gris', txt: 'Vence mañana' }
  return { tono: 'gris', txt: `Vence ${corta(p.vence)}` }
}

function Tarjeta({ p, n, datos, editar, modo, enviar }: { p: PedidoSocio; n: Ahora; datos: DatosOperaciones; editar: boolean; modo: 'anotar' | 'verificar'; enviar: Enviar }) {
  const [ocupado, setOcupado] = useState(false)
  const [borrar, setBorrar] = useState(false)
  const [seg, setSeg] = useState('')
  const cerrado = p.estado === 'hecho'
  const est = estPedido(p, n)
  const ed = estDelegado(p, n)
  const nivel = cerrado ? '' : est === 'late' || ed === 'late' ? 'late' : est === 'soon' || ed === 'soon' ? 'soon' : ''
  const puedeBorrar = editar || p.created_by === datos.yo
  const cv = chipVence(p, n)

  async function cambio(c: Record<string, unknown>) {
    setOcupado(true)
    await enviar({ accion: 'pedido', id: p.id, ...c })
    setOcupado(false)
  }
  async function anotarSeg(e: React.FormEvent) {
    e.preventDefault()
    if (!seg.trim()) return
    setOcupado(true)
    const ok = await enviar({ accion: 'seguimiento', id: p.id, texto: seg.trim() })
    setOcupado(false)
    if (ok) setSeg('')
  }

  return (
    <div className={cn(
      'space-y-2.5 rounded-2xl p-3.5 ring-1',
      nivel === 'late' ? 'bg-[#fff7f6] ring-[#f3c9c6]' : nivel === 'soon' ? 'bg-[#fffaf0] ring-[#f1dcb2]' : 'bg-white ring-[#ebe6df]',
      ocupado && 'opacity-70',
    )}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13.5px] font-bold leading-snug text-[#3d2c24]">{p.que}</p>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {cerrado ? (
            <Chip tono={p.resultado === 'cumplido' ? (p.a_tiempo ? 'verde' : 'ambar') : 'rojo'}>{textoResultado(p)}</Chip>
          ) : (
            <>
              <Chip tono={cv.tono}>{cv.txt}</Chip>
              <Chip tono={p.delegado_a ? 'azul' : 'verde'}>{nombreCorto(p.delegado_a)}</Chip>
              {!p.respondido && <Chip tono="ambar">Sin responder</Chip>}
            </>
          )}
        </div>
      </div>

      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#7d6c64]">
        <span>Pidió {p.pedido_por}</span>
        <span>Anotado {diaDe(p.created_at)}{p.created_by && datos.nombres[p.created_by] && p.created_by !== datos.yo ? ` por ${datos.nombres[p.created_by]}` : ''}</span>
        {p.delegado_a && p.compromiso && <span>Compromiso {corta(p.compromiso)}</span>}
        {p.reprogramado > 0 && <span>Reprogramado {p.reprogramado}×</span>}
        {cerrado && p.cerrado && <span>Verificado {corta(p.cerrado)}</span>}
      </p>

      {!cerrado && modo === 'anotar' && editar && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#a39e97]">Se encarga</span>
            <Pills opciones={OPC_ENCARGADO} valor={p.delegado_a ?? ''} disabled={ocupado} onCambiar={(v) => void cambio({ cambio: 'delegar', delegado_a: v || null })} etiqueta="Quién se encarga" />
          </div>
          {p.delegado_a && (
            <label className="flex items-center gap-2">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#a39e97]">Compromiso</span>
              <input type="date" value={p.compromiso ?? ''} disabled={ocupado} onChange={(e) => void cambio({ cambio: 'compromiso', compromiso: e.target.value || null })} className={cn(inputCls, 'w-auto py-1.5 text-[13px]')} />
            </label>
          )}
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#3d2c24]">
            <input type="checkbox" checked={p.respondido} disabled={ocupado} onChange={(e) => void cambio({ cambio: e.target.checked ? 'respondido' : 'no_respondido' })} className="size-4.5 accent-[#006d5a]" />
            Le respondí al socio
          </label>
        </div>
      )}

      {modo === 'anotar' && p.seguimiento.length > 0 && (
        <ul className="space-y-0.5 border-t border-dashed border-[#ebe6df] pt-2">
          {p.seguimiento.slice(-3).map((s) => (
            <li key={s.id} className="text-[11.5px] text-[#7d6c64]"><b className="text-[#3d2c24]">{diaDe(s.created_at)}</b> {s.texto}</li>
          ))}
        </ul>
      )}

      {!cerrado && modo === 'anotar' && editar && p.delegado_a && (
        <form onSubmit={(e) => void anotarSeg(e)} className="flex gap-2">
          <input value={seg} onChange={(e) => setSeg(e.target.value)} maxLength={200} placeholder={`Cómo viene (lo que te dijo ${nombreCorto(p.delegado_a)})`} className={cn(inputCls, 'py-2 text-[13px]')} />
          <button type="submit" disabled={ocupado || !seg.trim()} className="shrink-0 rounded-xl bg-[#f3efe9] px-3 text-[12px] font-bold text-[#3d2c24] disabled:opacity-50">Anotar</button>
        </form>
      )}

      {!cerrado && modo === 'verificar' && editar && (
        <div className="grid grid-cols-3 gap-2">
          <button type="button" disabled={ocupado} onClick={() => void cambio({ cambio: 'cumplido' })} className="flex items-center justify-center gap-1 rounded-xl bg-[#e8f5f1] py-2.5 text-[12px] font-bold text-[#006d5a] active:scale-95"><Check className="size-4" /> Cumplido</button>
          <button type="button" disabled={ocupado} onClick={() => void cambio({ cambio: 'no_cumplido' })} className="flex items-center justify-center gap-1 rounded-xl bg-[#fef2f2] py-2.5 text-[12px] font-bold text-[#c8312c] active:scale-95"><X className="size-4" /> No cumplido</button>
          <button type="button" disabled={ocupado} onClick={() => void cambio({ cambio: 'reprogramar' })} className="flex items-center justify-center gap-1 rounded-xl bg-[#f3efe9] py-2.5 text-[12px] font-bold text-[#3d2c24] active:scale-95"><RotateCcw className="size-3.5" /> +3 días</button>
        </div>
      )}

      {cerrado && editar && (
        <button type="button" disabled={ocupado} onClick={() => void cambio({ cambio: 'reabrir' })} className="flex items-center gap-1 rounded-full bg-[#f3efe9] px-3 py-1.5 text-[11.5px] font-semibold text-[#3d2c24]"><Undo2 className="size-3.5" /> Deshacer</button>
      )}

      {!cerrado && modo === 'anotar' && puedeBorrar && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              if (borrar) void cambio({ cambio: 'borrar' })
              else { setBorrar(true); window.setTimeout(() => setBorrar(false), 3000) }
            }}
            className={cn('flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold', borrar ? 'bg-[#ea504c] text-white' : 'text-[#a39e97] hover:bg-[#fef2f2] hover:text-[#ea504c]')}
            aria-label="Borrar pedido"
          >
            <Trash2 className="size-3.5" /> {borrar ? '¿Borrar?' : ''}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Encargados({ n, datos, editar, enviar }: { n: Ahora; datos: DatosOperaciones; editar: boolean; enviar: Enviar }) {
  const delegados = datos.pedidos
    .filter((p) => p.delegado_a && p.estado !== 'hecho')
    .sort((a, b) => (a.compromiso ?? a.vence).localeCompare(b.compromiso ?? b.vence))
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {ENCARGADOS.map((nom) => {
          const mios = datos.pedidos.filter((p) => p.delegado_a === nom)
          const st = statsPedidos(mios)
          const ab = mios.filter((p) => p.estado !== 'hecho')
          const vencido = ab.filter((p) => estDelegado(p, n) === 'late').length
          const sinSeg = ab.filter((p) => estDelegado(p, n) === 'soon').length
          return (
            <div key={nom} className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
              <p className="text-[12.5px] font-bold text-[#3d2c24]">{nom}</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-[#006d5a]">{st.verificados ? `${pct(st.cumplidos, st.verificados)} %` : '—'}</p>
              <p className="text-[10.5px] text-[#7d6c64]">{st.verificados ? `cumplió ${st.cumplidos} de ${st.verificados}` : 'sin pedidos verificados'}</p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-[11px]">
                <dt className="text-[#7d6c64]">Abiertos</dt><dd className="text-right font-bold tabular-nums">{ab.length}</dd>
                <dt className="text-[#7d6c64]">Compromiso vencido</dt><dd className={cn('text-right font-bold tabular-nums', vencido && 'text-[#c8312c]')}>{vencido}</dd>
                <dt className="text-[#7d6c64]">Sin seguimiento 48 h</dt><dd className={cn('text-right font-bold tabular-nums', sinSeg && 'text-[#9a6418]')}>{sinSeg}</dd>
                <dt className="text-[#7d6c64]">A tiempo</dt><dd className="text-right font-bold tabular-nums">{st.cumplidos ? `${pct(st.aTiempo, st.cumplidos)} %` : '—'}</dd>
              </dl>
            </div>
          )
        })}
      </div>
      {delegados.length === 0 ? <Vacio ok>No hay pedidos delegados abiertos.</Vacio> : delegados.map((p) => <Tarjeta key={p.id} p={p} n={n} datos={datos} editar={editar} modo="anotar" enviar={enviar} />)}
    </div>
  )
}
