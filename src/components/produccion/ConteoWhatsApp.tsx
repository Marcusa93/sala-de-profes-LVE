'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, ClipboardPaste, HelpCircle, Loader2, MessageSquareText, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LineaConteo } from '@/lib/stock/conteo-texto'

// ---------------------------------------------------------------------------
// Pegar el mensaje del conteo (el mismo que se manda al grupo de WhatsApp)
// y guardarlo como conteo. Lo que no se reconoce solo se elige una vez y la
// app lo recuerda para los próximos días.
// ---------------------------------------------------------------------------

// Misma regla que el servidor: diferencias grandes piden nota
function necesitaNota(actual: number, nuevo: number, unit: string) {
  const abs = Math.abs(nuevo - actual)
  const pct = actual > 0 ? abs / actual : abs > 0 ? 1 : 0
  const kg = unit.toLowerCase().includes('kg')
  return abs >= (kg ? Math.max(0.5, actual * 0.12) : Math.max(2, actual * 0.15)) || pct >= 0.25
}
const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })

type Fila = LineaConteo & { elegido: string | null | undefined; qtyTxt: string; recordar: boolean }

export function ConteoWhatsApp({ onGuardado }: { onGuardado: () => void }) {
  const [texto, setTexto] = useState('')
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [nota, setNota] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})

  async function analizar() {
    setCargando(true)
    setErrores({})
    try {
      const res = await fetch('/api/stock/conteo-texto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'analizar', texto }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo leer el mensaje')
      setFilas((json.lineas as LineaConteo[]).map((l) => ({
        ...l,
        // undefined = falta elegir · null = no contar · id = insumo
        elegido: l.origen === 'ignorado' ? null : l.item?.id ?? undefined,
        qtyTxt: l.qty != null ? String(l.qty) : '',
        recordar: true,
      })))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setCargando(false)
    }
  }

  const conteos = (filas ?? []).filter((f) => f.origen !== 'comentario')
  const faltan = conteos.filter((f) => f.elegido === undefined)
  const aGuardar = conteos.filter((f) => f.elegido)
  const itemDe = (f: Fila) => f.item && f.item.id === f.elegido ? f.item : null
  const qtyDe = (f: Fila) => parseFloat(f.qtyTxt.replace(',', '.'))
  const conDiferenciaGrande = aGuardar.filter((f) => {
    const it = itemDe(f)
    return it && Number.isFinite(qtyDe(f)) && necesitaNota(it.current_qty, qtyDe(f), it.unit)
  })
  const qtyInvalida = aGuardar.some((f) => !Number.isFinite(qtyDe(f)) || qtyDe(f) < 0)
  const puedeGuardar = aGuardar.length > 0 && faltan.length === 0 && !qtyInvalida && (conDiferenciaGrande.length === 0 || nota.trim().length > 0)

  async function guardar() {
    if (!filas) return
    setGuardando(true)
    try {
      const res = await fetch('/api/stock/conteo-texto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'guardar',
          nota: nota.trim() || null,
          lineas: conteos.map((f) => ({
            alias: f.alias,
            stock_item_id: f.elegido ?? null,
            qty: f.elegido ? qtyDe(f) : null,
            // se recuerda lo que eligió una persona (lo automático ya se reconoce solo)
            recordar: f.recordar && (f.origen === 'dudoso' || f.origen === 'sin_coincidencia' || f.elegido === null || (f.item && f.item.id !== f.elegido)),
          })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      const fallidos = (json.resultados ?? []).filter((r: { ok: boolean }) => !r.ok) as { stock_item_id: string; error?: string }[]
      if (json.guardados > 0) toast.success(`Conteo guardado: ${json.guardados} producto${json.guardados === 1 ? '' : 's'}`)
      if (fallidos.length > 0) {
        setErrores(Object.fromEntries(fallidos.map((r) => [r.stock_item_id, r.error ?? 'Error'])))
        setFilas((fs) => fs && fs.filter((f) => fallidos.some((r) => r.stock_item_id === f.elegido)))
        toast.error(`${fallidos.length} no se pudo guardar: revisalos`)
      } else {
        setFilas(null)
        setTexto('')
        setNota('')
      }
      if (json.guardados > 0) onGuardado()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (!filas) {
    return (
      <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#3d2c24]">
          <MessageSquareText className="size-4 text-[#006d5a]" /> Pegar el conteo de WhatsApp
        </p>
        <p className="mt-0.5 text-[11.5px] text-[#7d6c64]">El mismo mensaje que mandás al grupo: un producto por renglón con su cantidad.</p>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={5}
          placeholder={'Bolognesa 8 porciones\nMilanesas 28 unidades\nEmpanadas de carne 72…'}
          className="mt-2 w-full resize-y rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-[13px] text-[#3d2c24] outline-none focus:border-[#006d5a]"
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={async () => { try { setTexto(await navigator.clipboard.readText()) } catch { toast.info('Mantené apretado el cuadro y tocá "Pegar"') } }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-[#3d2c24] ring-1 ring-[#ebe6df]"
          >
            <ClipboardPaste className="size-3.5" /> Pegar
          </button>
          <button
            onClick={() => void analizar()}
            disabled={cargando || !texto.trim()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-2 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {cargando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Leer conteo
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[12.5px] font-semibold text-[#3d2c24]">
          {conteos.length} producto{conteos.length === 1 ? '' : 's'} · {faltan.length > 0 ? <span className="text-[#d4943a]">{faltan.length} para confirmar</span> : <span className="text-[#006d5a]">todo reconocido</span>}
        </p>
        <button onClick={() => setFilas(null)} className="flex items-center gap-1 text-[11.5px] text-[#a39e97]"><X className="size-3.5" /> Volver</button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
        {filas.map((f, i) => {
          if (f.origen === 'comentario') {
            return <p key={i} className="border-b border-[#f5f0ea] px-3.5 py-2 text-[11px] italic text-[#a39e97] last:border-0">Comentario (no se cuenta): {f.texto}</p>
          }
          const it = itemDe(f)
          const q = qtyDe(f)
          const diferencia = it && Number.isFinite(q) ? q - it.current_qty : null
          const set = (patch: Partial<Fila>) => setFilas((fs) => fs && fs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          const err = f.elegido ? errores[f.elegido] : undefined
          return (
            <div key={i} className={cn('border-b border-[#f5f0ea] px-3.5 py-2.5 last:border-0', f.elegido === undefined && 'bg-[#fef7ed]/60', err && 'bg-[#fef2f2]')}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-[#a39e97]">“{f.nombre}”</p>
                  {f.elegido === undefined ? (
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.target.value
                        if (v === '__no') { set({ elegido: null }); return }
                        const c = f.candidatos.find((x) => x.id === v)
                        set({ elegido: v, item: c ? { id: c.id, name: c.name, unit: c.unit, current_qty: c.current_qty } : f.item })
                      }}
                      className="mt-0.5 w-full rounded-lg border border-[#d4943a]/50 bg-white px-2 py-1.5 text-[12.5px]"
                    >
                      <option value="">¿Qué producto es?</option>
                      {f.candidatos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      <option value="__no">No contar este renglón</option>
                    </select>
                  ) : f.elegido === null ? (
                    <p className="text-[12.5px] text-[#a39e97]">No se cuenta <button onClick={() => set({ elegido: undefined })} className="ml-1 underline">cambiar</button></p>
                  ) : (
                    <p className="truncate text-[13px] font-semibold text-[#3d2c24]">
                      {it?.name ?? f.candidatos.find((c) => c.id === f.elegido)?.name}
                      {f.origen === 'recordado' && <span className="ml-1 text-[10px] font-normal text-[#006d5a]">recordado</span>}
                    </p>
                  )}
                </div>
                {f.elegido && (
                  <div className="flex shrink-0 items-center gap-1">
                    <input
                      inputMode="decimal"
                      value={f.qtyTxt}
                      onChange={(e) => set({ qtyTxt: e.target.value })}
                      className="w-16 rounded-lg border border-[#ebe6df] px-2 py-1 text-right text-[14px] font-semibold tabular-nums outline-none focus:border-[#006d5a]"
                    />
                    <span className="w-10 text-[10.5px] text-[#a39e97]">{it?.unit ?? f.candidatos.find((c) => c.id === f.elegido)?.unit}</span>
                  </div>
                )}
              </div>
              {it && Number.isFinite(it.current_qty) && (
                <p className="mt-0.5 text-[10.5px] text-[#a39e97]">
                  Sistema: {num(it.current_qty)}
                  {diferencia !== null && Math.abs(diferencia) >= 0.01 && <span className={cn(diferencia < 0 ? 'text-[#ea504c]' : 'text-[#006d5a]')}> · {diferencia > 0 ? '+' : ''}{num(diferencia)}</span>}
                </p>
              )}
              {f.problema && <p className="mt-0.5 text-[10.5px] font-semibold text-[#d4943a]">{f.problema}</p>}
              {err && <p className="mt-0.5 text-[10.5px] font-semibold text-[#ea504c]">{err}</p>}
            </div>
          )
        })}
      </div>

      {conDiferenciaGrande.length > 0 && (
        <label className="block rounded-xl bg-[#fef7ed] p-3 ring-1 ring-[#d4943a]/25">
          <span className="flex items-center gap-1 text-[12px] font-semibold text-[#3d2c24]">
            <HelpCircle className="size-3.5 text-[#d4943a]" /> {conDiferenciaGrande.length} con diferencia grande: ¿qué pasó?
          </span>
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="ej. primer conteo del mes, se usó en un evento…"
            className="mt-1.5 w-full rounded-lg border border-[#d4943a]/40 bg-white px-2 py-1.5 text-[12.5px] outline-none"
          />
        </label>
      )}

      <button
        onClick={() => void guardar()}
        disabled={guardando || !puedeGuardar}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {guardando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Guardar conteo ({aGuardar.length})
      </button>
      {faltan.length > 0 && <p className="text-center text-[11px] text-[#d4943a]">Elegí qué producto es en los {faltan.length} marcados. La app lo recuerda para los próximos días.</p>}
    </div>
  )
}
