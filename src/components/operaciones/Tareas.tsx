'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
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

/** Lo que falta arriba (en el orden del día), lo hecho y lo de antes del control al final */
const PESO: Record<EstadoTarea, number> = { late: 0, soon: 0, '': 0, done: 1, prev: 2 }
function pendientesPrimero<T>(items: T[], estados: EstadoTarea[]): { t: T; est: EstadoTarea }[] {
  return items.map((t, i) => ({ t, est: estados[i], i })).sort((a, b) => PESO[a.est] - PESO[b.est] || a.i - b.i)
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
        {pendientesPrimero(DIARIAS, estados).map(({ t, est }) => (
          <FilaTarea
            key={t.id}
            titulo={t.t}
            detalle={t.d}
            est={est}
            vence={est === 'done' ? 'hecho' : `hasta ${t.h}`}
            check={checkDe(datos, k, t.id)}
            nombres={datos.nombres}
            editar={editar}
            onCambiar={(v) => onMarcar(k, t.id, v)}
          >
            {t.caja && (
              <div className="mt-3 space-y-2 border-t border-dashed border-[#e6dfd7] pt-3">
                {diasDeCaja(n).map((f) => (
                  <FilaCaja key={f} fecha={f} actual={caja.get(f)} editar={editar} onGuardar={onCaja} />
                ))}
                <p className="text-[10.5px] text-[#a39e97]">Diferencia en pesos (0 si cerró bien; negativa si faltó plata). Si hay diferencia, el motivo va hoy. Se guarda sola.</p>
              </div>
            )}
          </FilaTarea>
        ))}
      </ul>
    </div>
  )
}

const aTexto = (n: number | null | undefined) => (n == null ? '' : String(n))

/**
 * Monto escrito a mano → número. Acepta '1500', '-1500', '1.500', '-1.500,50'
 * (punto de miles y coma decimal, como se escribe acá). '' → null; otra cosa → NaN.
 */
function leerMonto(s: string): number | null {
  const t = s.trim().replace(/\s|\$/g, '')
  if (!t) return null
  const limpio = t.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const n = Number(limpio)
  return Number.isFinite(n) ? n : NaN
}

type EstadoGuardado = '' | 'guardando' | 'guardado' | 'error'

/**
 * Diferencia de caja de un día. Se guarda sola mientras se escribe (un
 * segundo después de la última tecla), al salir de la fila y si se cierra o
 * se pasa a otra app: así no se pierde si Joaquín cierra la app de golpe.
 */
function FilaCaja({ fecha, actual, editar, onGuardar }: {
  fecha: string
  actual: CajaDia | undefined
  editar: boolean
  onGuardar: (fecha: string, diferencia: number | null, motivo: string | null) => Promise<boolean>
}) {
  const servDif = aTexto(actual?.diferencia)
  const servMot = actual?.motivo ?? ''
  const [dif, setDif] = useState(servDif)
  const [mot, setMot] = useState(servMot)
  const [base, setBase] = useState({ dif: servDif, mot: servMot })
  const [estado, setEstado] = useState<EstadoGuardado>('')
  const pendiente = useRef<number | null>(null)
  const guardarYa = useRef<() => void>(() => {})

  // Llegó otro valor del servidor (lo recién guardado u otro equipo): se
  // muestra, salvo que haya algo escrito que todavía no se guardó
  if (base.dif !== servDif || base.mot !== servMot) {
    const limpio = dif === base.dif && mot === base.mot
    setBase({ dif: servDif, mot: servMot })
    if (limpio) { setDif(servDif); setMot(servMot) }
  }

  const num = leerMonto(dif)
  const invalido = Number.isNaN(num)
  const sucio = (num ?? null) !== (actual?.diferencia ?? null) || mot.trim() !== servMot.trim()

  async function guardar() {
    setEstado('guardando')
    const ok = await onGuardar(fecha, num, mot.trim() || null)
    setEstado(ok ? 'guardado' : 'error')
  }

  // Guardado automático: un segundo después de la última tecla
  useEffect(() => {
    if (!editar || !sucio || invalido) return
    pendiente.current = window.setTimeout(() => { pendiente.current = null; void guardar() }, 1000)
    return () => { if (pendiente.current) { window.clearTimeout(pendiente.current); pendiente.current = null } }
  }, [dif, mot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Si hay un guardado esperando, que salga ya (al salir de la fila o de la app)
  useEffect(() => {
    guardarYa.current = () => {
      if (!pendiente.current) return
      window.clearTimeout(pendiente.current)
      pendiente.current = null
      void guardar()
    }
  })
  useEffect(() => {
    const alOcultar = () => { if (document.visibilityState === 'hidden') guardarYa.current() }
    document.addEventListener('visibilitychange', alOcultar)
    return () => document.removeEventListener('visibilitychange', alOcultar)
  }, [])

  const falta = cajaSinMotivo(actual)
  const aviso = invalido
    ? <span className="text-[10.5px] font-bold text-[#c8312c]">monto inválido</span>
    : estado === 'guardando' || (sucio && editar)
      ? <span className="flex items-center gap-1 text-[10.5px] font-semibold text-[#a39e97]"><Loader2 className="size-3 animate-spin" /> guardando</span>
      : estado === 'error'
        ? <span className="text-[10.5px] font-bold text-[#c8312c]">no se guardó</span>
        : falta
          ? <span className="text-[10.5px] font-bold text-[#c8312c]">falta el motivo</span>
          : actual
            ? <span className="flex items-center gap-0.5 text-[10.5px] font-semibold text-[#006d5a]"><CheckIcon className="size-3.5" /> guardado</span>
            : null

  return (
    <div
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) guardarYa.current() }}
      className={cn('rounded-xl p-2.5', falta && !sucio ? 'bg-[#fef2f2]' : 'bg-[#faf8f5]')}
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-bold text-[#3d2c24]">
        <span className="flex-1">Caja Santa Fe · {DIAS[dow(fecha)]} {corta(fecha)}</span>
        {aviso}
      </p>
      <div className="grid grid-cols-[7.5rem_1fr] gap-2">
        <input
          value={dif}
          onChange={(e) => setDif(e.target.value)}
          inputMode="decimal"
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
        {pendientesPrimero(SEMANALES, estados).map(({ t, est }) => (
          <FilaTarea
            key={t.id}
            titulo={t.t}
            detalle={t.d}
            sup={t.sup}
            est={est}
            vence={est === 'done' ? 'hecho' : est === 'prev' ? 'antes del control' : `${DC[t.dow]}${t.h !== '23:59' ? ` ${t.h}` : ''}`}
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
        {pendientesPrimero(MENSUALES, estados).map(({ t, est }) => (
          <FilaTarea
            key={t.id}
            titulo={t.t}
            detalle={t.d}
            sup={t.sup}
            est={est}
            vence={est === 'done' ? 'hecho' : est === 'prev' ? 'antes del control' : `día ${diaM(t, n)}`}
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
