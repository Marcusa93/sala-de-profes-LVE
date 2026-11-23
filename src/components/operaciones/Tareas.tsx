'use client'

import { useState, type ReactNode } from 'react'
import { Check as CheckIcon, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { claveD, claveM, claveS, corta, cuando, DC, DIAS, dow, lunes, MESES, sumar, type Ahora } from '@/lib/operaciones/fechas'
import { DIARIAS, MENSUALES, SEMANALES, diaM, diasDeCaja, estDiaria, estMensual, estSemanal, type EstadoTarea } from '@/lib/operaciones/tareas'
import { cajaSinMotivo, type Hecho } from '@/lib/operaciones/alertas'
import type { CajaDia, Check, DatosOperaciones } from '@/lib/operaciones/tipos'
import { Progreso, Vacio, inputCls } from './ui'

// ---------------------------------------------------------------------------
// Hoy, Semana y Mes: tareas para tildar (y la caja de ayer en Hoy)
// ---------------------------------------------------------------------------

export type Marcar = (periodo: string, tarea: string, hecho: boolean) => void

type Comun = {
  n: Ahora
  datos: DatosOperaciones
  hecho: Hecho
  editar: boolean
  onMarcar: Marcar
}

const ESTILO: Record<EstadoTarea, string> = {
  done: 'bg-[#f7faf8] ring-[#d7ebe4]',
  late: 'bg-[#fff7f6] ring-[#f3c9c6]',
  soon: 'bg-[#fffaf0] ring-[#f1dcb2]',
  prev: 'bg-[#faf8f5] ring-[#ebe6df] opacity-70',
  '': 'bg-white ring-[#ebe6df]',
}
const VENCE: Record<EstadoTarea, string> = {
  done: 'text-[#006d5a]',
  late: 'text-[#c8312c]',
  soon: 'text-[#9a6418]',
  prev: 'text-[#a39e97]',
  '': 'text-[#a39e97]',
}

function checkDe(datos: DatosOperaciones, periodo: string, tarea: string): Check | undefined {
  return datos.checks.find((c) => c.periodo === periodo && c.tarea === tarea)
}

function FilaTarea({ titulo, detalle, sup, est, vence, check, nombres, editar, onCambiar, children }: {
  titulo: string
  detalle: string
  sup?: boolean
  est: EstadoTarea
  vence: string
  check?: Check
  nombres: Record<string, string>
  editar: boolean
  onCambiar: (v: boolean) => void
  children?: ReactNode
}) {
  const hecho = est === 'done'
  const quien = check?.hecho_por ? nombres[check.hecho_por] : null
  return (
    <li className={cn('rounded-2xl p-3 ring-1 transition-colors', ESTILO[est])}>
      <label className={cn('flex items-start gap-3', editar ? 'cursor-pointer' : 'cursor-default')}>
        <input
          type="checkbox"
          checked={hecho}
          disabled={!editar || est === 'prev'}
          onChange={(e) => onCambiar(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[#006d5a]"
        />
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[13.5px] font-bold text-[#3d2c24]', hecho && 'text-[#7d6c64] line-through decoration-[#006d5a]')}>{titulo}</span>
          <span className="mt-0.5 block text-[12px] leading-snug text-[#7d6c64]">{detalle}</span>
          {sup && <span className="mt-0.5 block text-[10.5px] font-semibold text-[#b0762a]">Fecha a confirmar con Marco</span>}
          {hecho && check && (
            <span className="mt-0.5 block text-[10.5px] text-[#006d5a]">Hecho {cuando(check.hecho_at)}{quien ? ` · ${quien}` : ''}</span>
          )}
        </span>
        <span className={cn('shrink-0 text-right text-[11px] font-semibold tabular-nums', VENCE[est])}>{vence}</span>
      </label>
      {children}
    </li>
  )
}

// ---------------------------------------------------------------------------

export function TabHoy({ n, datos, hecho, editar, onMarcar, onCaja }: Comun & { onCaja: (fecha: string, diferencia: number | null, motivo: string | null) => Promise<boolean> }) {
  if (n.dow === 0) return <Vacio>Domingo: no hay tareas diarias.</Vacio>
  const k = claveD(n.hoy)
  const estados = DIARIAS.map((t) => estDiaria(t, n, hecho(k, t.id)))
  const caja = new Map(datos.caja.map((c) => [c.fecha, c]))

  return (
    <div className="space-y-3">
      <Progreso hechos={estados.filter((e) => e === 'done').length} total={DIARIAS.length} />
      <ul className="space-y-2">
        {DIARIAS.map((t, i) => (
          <FilaTarea
            key={t.id}
            titulo={t.t}
            detalle={t.d}
            est={estados[i]}
            vence={estados[i] === 'done' ? 'hecho' : `hasta ${t.h}`}
            check={checkDe(datos, k, t.id)}
            nombres={datos.nombres}
            editar={editar}
            onCambiar={(v) => onMarcar(k, t.id, v)}
          >
            {t.caja && (
              <div className="mt-3 space-y-2 border-t border-dashed border-[#e6dfd7] pt-3">
                {/* La key incluye lo guardado: si cambia desde otro equipo, la fila se rearma con eso */}
                {diasDeCaja(n).map((f) => (
                  <FilaCaja key={`${f}|${caja.get(f)?.updated_at ?? ''}`} fecha={f} actual={caja.get(f)} editar={editar} onGuardar={onCaja} />
                ))}
                <p className="text-[10.5px] text-[#a39e97]">Diferencia en pesos (0 si cerró bien; negativa si faltó plata). Si hay diferencia, el motivo va hoy.</p>
              </div>
            )}
          </FilaTarea>
        ))}
      </ul>
    </div>
  )
}

const aTexto = (n: number | null | undefined) => (n == null ? '' : String(n))

function FilaCaja({ fecha, actual, editar, onGuardar }: {
  fecha: string
  actual: CajaDia | undefined
  editar: boolean
  onGuardar: (fecha: string, diferencia: number | null, motivo: string | null) => Promise<boolean>
}) {
  const [dif, setDif] = useState(aTexto(actual?.diferencia))
  const [mot, setMot] = useState(actual?.motivo ?? '')
  const [guardando, setGuardando] = useState(false)

  const num = dif.trim() === '' ? null : Number(dif.replace(',', '.'))
  const invalido = num !== null && !Number.isFinite(num)
  const falta = cajaSinMotivo(actual)

  async function guardar() {
    if (invalido) return
    if (`${num == null ? '' : num}|${mot.trim()}` === `${aTexto(actual?.diferencia)}|${(actual?.motivo ?? '').trim()}`) return
    setGuardando(true)
    await onGuardar(fecha, num, mot.trim() || null)
    setGuardando(false)
  }

  return (
    // Se guarda al salir de la fila (no de cada casillero): así pasar de la
    // diferencia al motivo no dispara un guardado a mitad de camino
    <div
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void guardar() }}
      className={cn('rounded-xl p-2.5', falta ? 'bg-[#fef2f2]' : 'bg-[#faf8f5]')}
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-bold text-[#3d2c24]">
        Caja Santa Fe · {DIAS[dow(fecha)]} {corta(fecha)}
        {guardando && <Loader2 className="size-3 animate-spin text-[#a39e97]" />}
        {!guardando && actual && !falta && <CheckIcon className="size-3.5 text-[#006d5a]" />}
        {falta && <span className="text-[10.5px] font-bold text-[#c8312c]">falta el motivo</span>}
      </p>
      <div className="grid grid-cols-[7.5rem_1fr] gap-2">
        <input
          value={dif}
          onChange={(e) => setDif(e.target.value)}
          inputMode="numeric"
          placeholder="Dif. $"
          disabled={!editar}
          aria-label={`Diferencia de caja del ${corta(fecha)}`}
          className={cn(inputCls, 'tabular-nums', invalido && 'border-[#ea504c]')}
        />
        <input
          value={mot}
          onChange={(e) => setMot(e.target.value)}
          maxLength={300}
          placeholder="Motivo (si hay diferencia)"
          disabled={!editar}
          aria-label={`Motivo de la diferencia del ${corta(fecha)}`}
          className={inputCls}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function TabSemana({ n, datos, hecho, editar, onMarcar }: Comun) {
  const k = claveS(n.hoy)
  const l = lunes(n.hoy)
  const estados = SEMANALES.map((t) => estSemanal(t, n, hecho(k, t.id), datos.inicio))
  const cuentan = estados.filter((e) => e !== 'prev')
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[#7d6c64]">Semana del {corta(l)} al {corta(sumar(l, 6))}. Se reinicia sola cada lunes.</p>
      <Progreso hechos={cuentan.filter((e) => e === 'done').length} total={cuentan.length} />
      <ul className="space-y-2">
        {SEMANALES.map((t, i) => (
          <FilaTarea
            key={t.id}
            titulo={t.t}
            detalle={t.d}
            sup={t.sup}
            est={estados[i]}
            vence={estados[i] === 'done' ? 'hecho' : estados[i] === 'prev' ? 'antes del control' : `${DC[t.dow]}${t.h !== '23:59' ? ` ${t.h}` : ''}`}
            check={checkDe(datos, k, t.id)}
            nombres={datos.nombres}
            editar={editar}
            onCambiar={(v) => onMarcar(k, t.id, v)}
          />
        ))}
      </ul>
    </div>
  )
}

export function TabMes({ n, datos, hecho, editar, onMarcar }: Comun) {
  const k = claveM(n.hoy)
  const estados = MENSUALES.map((t) => estMensual(t, n, hecho(k, t.id), datos.inicio))
  const cuentan = estados.filter((e) => e !== 'prev')
  const mes = MESES[n.mo - 1]
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[#7d6c64]">{mes.charAt(0).toUpperCase() + mes.slice(1)} {n.y}. Se reinicia solo el día 1.</p>
      <Progreso hechos={cuentan.filter((e) => e === 'done').length} total={cuentan.length} />
      <ul className="space-y-2">
        {MENSUALES.map((t, i) => (
          <FilaTarea
            key={t.id}
            titulo={t.t}
            detalle={t.d}
            sup={t.sup}
            est={estados[i]}
            vence={estados[i] === 'done' ? 'hecho' : estados[i] === 'prev' ? 'antes del control' : `día ${diaM(t, n)}`}
            check={checkDe(datos, k, t.id)}
            nombres={datos.nombres}
            editar={editar}
            onCambiar={(v) => onMarcar(k, t.id, v)}
          />
        ))}
      </ul>
    </div>
  )
}
