'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { ClipboardCheck, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/ui/LoadingState'
import { ahora, claveD, claveM, claveS, DIAS, MESES, pad, pct } from '@/lib/operaciones/fechas'
import { DIARIAS, MENSUALES, SEMANALES, estMensual, estSemanal } from '@/lib/operaciones/tareas'
import { alertas, analizarVentas, hechoDe, type Alerta, type Seccion } from '@/lib/operaciones/alertas'
import { statsPedidos } from '@/lib/operaciones/pedidos'
import type { DatosOperaciones, VentasOperaciones } from '@/lib/operaciones/tipos'
import type { ControlHorneado } from '@/lib/horneado/config'
import type { ControlCafe } from '@/lib/tolva/cruce'
import type { ControlLeche } from '@/lib/leche/cruce'
import { TabHoy, TabMes, TabSemana } from '@/components/operaciones/Tareas'
import { TabPedidos, type SubPedidos } from '@/components/operaciones/Pedidos'
import { TabDesempeno } from '@/components/operaciones/Desempeno'
import { TabVentas } from '@/components/operaciones/Ventas'
import { TabHorneado } from '@/components/operaciones/Horneado'
import { TabCafe } from '@/components/operaciones/Cafe'
import { SeccionLeche } from '@/components/operaciones/Leche'

// ---------------------------------------------------------------------------
// Control interno del Jefe de Operaciones — Santa Fe
// ---------------------------------------------------------------------------
// El tablero que Joaquín usaba en claude.ai, ahora en la app: alertas, tareas
// del día, la semana y el mes, caja de ayer, pedidos de socios, desempeño y
// ventas de ayer. Lo ven solo los socios y Joaquín (lib/operaciones/acceso);
// carga Joaquín, los socios ven y anotan pedidos. La 24 tiene el suyo en su app.
// ---------------------------------------------------------------------------

type Tab = 'hoy' | 'semana' | 'mes' | 'pedidos' | 'desempeno' | 'ventas' | 'horneado' | 'cafe'
const TABS: { v: Tab; label: string }[] = [
  { v: 'hoy', label: 'Hoy' },
  { v: 'semana', label: 'Semana' },
  { v: 'mes', label: 'Mes' },
  { v: 'pedidos', label: 'Pedidos socios' },
  { v: 'desempeno', label: 'Desempeño' },
  { v: 'ventas', label: 'Ventas' },
  { v: 'horneado', label: 'Horneado' },
  { v: 'cafe', label: 'Café y leche' },
]
const CLAVE_TAB = 'lve-operaciones-tab'

class ErrorApi extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function fetcher<T>(url: string): Promise<T> {
  const r = await fetch(url)
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw new ErrorApi(j?.error ?? 'No se pudo cargar', r.status)
  return j as T
}

/** De qué pestaña es cada alerta (los encargados están dentro de Pedidos) */
const tabDe = (s: Seccion): Tab => (s === 'encargados' ? 'pedidos' : s)

export default function ControlOperacionesPage() {
  const { data, error, isLoading, mutate } = useSWR<DatosOperaciones>('/api/operaciones', fetcher, { refreshInterval: 60_000 })
  const { data: ventas, isLoading: cargandoVentas } = useSWR<VentasOperaciones>(data ? '/api/operaciones/ventas' : null, fetcher, { revalidateOnFocus: false })
  const { data: horneado, isLoading: cargandoHorneado, error: errorHorneado } = useSWR<ControlHorneado>(data ? '/api/operaciones/horneado' : null, fetcher, { revalidateOnFocus: false })
  const { data: cafe, isLoading: cargandoCafe, error: errorCafe } = useSWR<ControlCafe>(data ? '/api/operaciones/cafe' : null, fetcher, { revalidateOnFocus: false })
  const { data: leche, isLoading: cargandoLeche, error: errorLeche } = useSWR<ControlLeche>(data ? '/api/operaciones/leche' : null, fetcher, { revalidateOnFocus: false })
  const [n, setN] = useState(() => ahora())
  const [tab, setTab] = useState<Tab>('hoy')
  const [sub, setSub] = useState<SubPedidos>('anotar')
  const [todas, setTodas] = useState(false)

  // El reloj avanza solo (las tareas pasan a "vence pronto" y "vencida")
  useEffect(() => {
    const iv = window.setInterval(() => setN(ahora()), 30_000)
    return () => window.clearInterval(iv)
  }, [])
  // Última pestaña abierta, solo en este equipo
  useEffect(() => {
    try {
      const t = window.localStorage.getItem(CLAVE_TAB) as Tab | null
      if (t && TABS.some((x) => x.v === t)) setTab(t)
    } catch { /* sin almacenamiento local */ }
  }, [])

  const hecho = useMemo(() => hechoDe(data?.checks ?? []), [data?.checks])
  const analisis = useMemo(() => analizarVentas(ventas), [ventas])
  const lista = useMemo<Alerta[]>(() => (data ? alertas(n, data, hecho, analisis, horneado ?? null, cafe ?? null, leche ?? null) : []), [n, data, hecho, analisis, horneado, cafe, leche])

  if (isLoading && !data) return <LoadingState />
  if (error && !data) {
    const e = error as ErrorApi
    return (
      <p className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-[#7d6c64]">
        {e.status === 403 ? 'El control interno lo ven solo los socios y el Jefe de Operaciones.' : e.message}
      </p>
    )
  }
  if (!data) return <LoadingState />

  const editar = data.puede_editar && !data.falta_migracion

  function ir(t: Tab, s?: SubPedidos) {
    setTab(t)
    if (s) setSub(s)
    try { window.localStorage.setItem(CLAVE_TAB, t) } catch { /* sin almacenamiento local */ }
  }

  async function enviar(body: Record<string, unknown>, optimista?: (d: DatosOperaciones) => DatosOperaciones): Promise<boolean> {
    if (optimista && data) void mutate(optimista(data), { revalidate: false })
    try {
      const r = await fetch('/api/operaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => null)
      if (!r.ok) { toast.error(j?.error ?? 'No se pudo guardar'); return false }
      return true
    } catch {
      toast.error('Sin conexión: no se guardó')
      return false
    } finally {
      await mutate()
    }
  }

  function marcar(periodo: string, tarea: string, v: boolean) {
    void enviar({ accion: 'marcar', periodo, tarea, hecho: v }, (d) => ({
      ...d,
      checks: v
        ? [...d.checks, { periodo, tarea, hecho_por: d.yo, hecho_at: new Date().toISOString() }]
        : d.checks.filter((c) => !(c.periodo === periodo && c.tarea === tarea)),
    }))
  }

  // Avance de cada pestaña (va al lado del nombre): tareas hechas de hoy, la
  // semana y el mes, y pedidos cumplidos del mes
  const sv = SEMANALES.map((t) => estSemanal(t, n, hecho(claveS(n.hoy), t.id), data.inicio)).filter((e) => e !== 'prev')
  const mv = MENSUALES.map((t) => estMensual(t, n, hecho(claveM(n.hoy), t.id), data.inicio)).filter((e) => e !== 'prev')
  const stMes = statsPedidos(data.pedidos.filter((p) => p.cerrado?.slice(0, 7) === n.hoy.slice(0, 7)))
  const avance: Partial<Record<Tab, { v: number | null; titulo: string }>> = {
    hoy: { v: n.dow === 0 ? null : pct(DIARIAS.filter((t) => hecho(claveD(n.hoy), t.id)).length, DIARIAS.length), titulo: 'Tareas de hoy hechas' },
    semana: { v: pct(sv.filter((e) => e === 'done').length, sv.length), titulo: 'Tareas de la semana hechas' },
    mes: { v: pct(mv.filter((e) => e === 'done').length, mv.length), titulo: 'Tareas del mes hechas' },
    pedidos: { v: pct(stMes.cumplidos, stMes.verificados), titulo: 'Pedidos cumplidos este mes' },
  }

  // Las alertas de tareas vienen agrupadas: se cuentan las tareas, no las filas
  const suma = (l: Alerta[]) => l.reduce((a, x) => a + x.cantidad, 0)
  const rojas = suma(lista.filter((a) => a.nivel === 'rojo'))
  const ambar = suma(lista.filter((a) => a.nivel === 'ambar'))
  const badge = (t: Tab) => {
    const de = lista.filter((a) => tabDe(a.seccion) === t)
    const r = suma(de.filter((a) => a.nivel === 'rojo'))
    return { n: r || suma(de), rojo: r > 0 }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-32">
      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-[#006d5a]/10">
          <ClipboardCheck className="size-4 text-[#006d5a]" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold tracking-tight text-[#3d2c24]">Control interno</h1>
          <p className="text-[12px] text-[#7d6c64]">Jefe de Operaciones · Santa Fe · {DIAS[n.dow]} {n.d} de {MESES[n.mo - 1]} · {pad(n.h)}:{pad(n.mi)}</p>
        </div>
      </div>

      {data.falta_migracion && (
        <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] font-semibold text-[#ea504c]">Falta correr la migración del control interno (20261123_control_operaciones.sql).</p>
      )}
      {data.falta_prioridad && !data.falta_migracion && data.puede_editar && (
        <p className="rounded-xl bg-[#fdf3e3] px-3 py-2.5 text-[12px] font-semibold text-[#9a6418]">La prioridad de los pedidos todavía no está activa: falta correr la migración 20261124_prioridad_pedidos_socios.sql.</p>
      )}
      {!data.puede_editar && (
        <p className="flex items-start gap-2 rounded-xl bg-[#f3efe9] px-3 py-2 text-[11.5px] text-[#7d6c64]">
          <Eye className="mt-0.5 size-3.5 shrink-0" /> Lo carga Joaquín. Vos ves todo y podés anotar pedidos.
        </p>
      )}

      <section className="space-y-2 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]" aria-live="polite">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[13px] font-bold text-[#3d2c24]">Alertas</p>
          {rojas > 0 && <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[10.5px] font-bold text-[#c8312c]">{rojas} vencida{rojas === 1 ? '' : 's'}</span>}
          {ambar > 0 && <span className="rounded-full bg-[#fdf3e3] px-2 py-0.5 text-[10.5px] font-bold text-[#9a6418]">{ambar} por vencer</span>}
        </div>
        {lista.length === 0 ? (
          <p className="rounded-xl bg-[#f2f9f6] px-3 py-2.5 text-[12px] font-semibold text-[#006d5a]">Sin alertas. Va al día.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {(todas ? lista : lista.slice(0, 6)).map((a, i) => (
                <li key={i} className={cn('flex items-center gap-2 rounded-xl px-2.5 py-2', a.nivel === 'rojo' ? 'bg-[#fef2f2]' : 'bg-[#fdf6ea]')}>
                  <span className={cn('size-2 shrink-0 rounded-full', a.nivel === 'rojo' ? 'bg-[#ea504c]' : 'bg-[#d4943a]')} />
                  <span className="min-w-0 flex-1 text-[12px] leading-snug text-[#3d2c24]">{a.texto}</span>
                  <button type="button" onClick={() => ir(tabDe(a.seccion), a.seccion === 'encargados' ? 'encargados' : a.seccion === 'pedidos' ? 'anotar' : undefined)} className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#006d5a] ring-1 ring-[#ebe6df]">
                    Ver
                  </button>
                </li>
              ))}
            </ul>
            {lista.length > 6 && (
              <button type="button" onClick={() => setTodas(!todas)} className="w-full rounded-xl bg-[#f3efe9] py-2 text-[12px] font-semibold text-[#3d2c24]">
                {todas ? 'Mostrar menos' : `Ver las ${lista.length - 6} restantes`}
              </button>
            )}
          </>
        )}
      </section>

      <nav aria-label="Secciones" className="sticky top-0 z-10 -mx-4 overflow-x-auto bg-background/95 px-4 py-2 backdrop-blur [scrollbar-width:none]">
        <div className="flex gap-1.5" role="tablist">
          {TABS.map((t) => {
            const b = badge(t.v)
            const av = avance[t.v]
            return (
              <button
                key={t.v}
                type="button"
                role="tab"
                aria-selected={tab === t.v}
                onClick={() => ir(t.v)}
                title={av ? `${av.titulo}: ${av.v == null ? 'sin datos' : `${av.v} %`}` : undefined}
                className={cn('flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition-colors', tab === t.v ? 'bg-[#006d5a] text-white' : 'bg-white text-[#3d2c24] ring-1 ring-[#ebe6df]')}
              >
                {t.label}
                {av && av.v != null && (
                  <span className={cn('text-[11px] font-semibold tabular-nums', tab === t.v ? 'text-white/75' : av.v >= 80 ? 'text-[#006d5a]' : av.v >= 50 ? 'text-[#b0762a]' : 'text-[#c8312c]')}>{av.v}%</span>
                )}
                {b.n > 0 && <span className={cn('rounded-full px-1.5 text-[10px] text-white', b.rojo ? 'bg-[#ea504c]' : 'bg-[#d4943a]')}>{b.n}</span>}
              </button>
            )
          })}
        </div>
      </nav>

      {tab === 'hoy' && (
        <TabHoy
          n={n}
          datos={data}
          hecho={hecho}
          editar={editar}
          onMarcar={marcar}
          onCaja={(fecha, diferencia, motivo) => enviar({ accion: 'caja', fecha, diferencia, motivo })}
        />
      )}
      {tab === 'semana' && <TabSemana n={n} datos={data} hecho={hecho} editar={editar} onMarcar={marcar} />}
      {tab === 'mes' && <TabMes n={n} datos={data} hecho={hecho} editar={editar} onMarcar={marcar} />}
      {tab === 'pedidos' && <TabPedidos n={n} datos={data} editar={editar} sub={sub} setSub={setSub} enviar={(b) => enviar(b)} />}
      {tab === 'desempeno' && <TabDesempeno n={n} datos={data} hecho={hecho} />}
      {tab === 'ventas' && <TabVentas ventas={ventas} analisis={analisis} cargando={cargandoVentas} />}
      {tab === 'horneado' && <TabHorneado datos={horneado} cargando={cargandoHorneado} error={errorHorneado ? (errorHorneado as Error).message : null} />}
      {tab === 'cafe' && (
        <div className="space-y-6">
          <TabCafe datos={cafe} cargando={cargandoCafe} error={errorCafe ? (errorCafe as Error).message : null} />
          <SeccionLeche datos={leche} cargando={cargandoLeche} error={errorLeche ? (errorLeche as Error).message : null} />
        </div>
      )}

      <details className="rounded-2xl bg-white p-3.5 text-[12px] text-[#7d6c64] ring-1 ring-[#ebe6df]">
        <summary className="cursor-pointer text-[13px] font-bold text-[#3d2c24]">Cómo se usa</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 leading-snug">
          <li><b>Primero las alertas:</b> rojo es vencido, ámbar es lo que vence pronto. «Ver» lleva a la tarea.</li>
          <li><b>Hoy:</b> tildá cada tarea al terminarla. En «Cierre de ayer» cargá la diferencia de caja de Santa Fe (0 si cerró bien) y, si hay diferencia, el motivo en el día. El lunes se cargan el sábado y el domingo.</li>
          <li><b>Semana y Mes:</b> tildá cuando lo entregás. Se reinician solas el lunes y el día 1.</li>
          <li><b>Pedidos socios:</b> anotá todo lo que pida un socio con su vencimiento. Tildá «Le respondí» cuando le contestás (48 h). Si lo pasás a Noelia o Ricardo, poné la fecha de compromiso y anotá cada 48 h cómo viene: sigue siendo tuyo.</li>
          <li><b>Prioridad:</b> cada pedido es de prioridad alta, media o baja. La lista muestra primero lo urgente, y en «Prioridad» elegís «Alta» para ver solo eso. La cambian Joaquín o quien anotó el pedido.</li>
          <li><b>Verificar:</b> cuando llega la fecha, marcá Cumplido o No cumplido, o +3 días si se reprograma. Con eso se arma Desempeño.</li>
          <li><b>Horneado:</b> cocina carga cada tanda de medialunas, bollitos y tortillas, y al cierre lo que sobró, lo que fue al budín de pan y lo que se tiró. Acá se cruza con lo vendido en Fudo: «faltan» son piezas sin explicación.</li>
          <li><b>Café:</b> lo que usó la tolva (lo pesan los baristas en el control de tolva, con lo que cargaron) contra los cafés vendidos en Fudo por los gramos de su receta. En rojo, salió más café del que se vendió. <b>Leche:</b> el barista cuenta toda la leche cada noche; entre un conteo y el otro, lo usado contra lo que piden los cafés con leche vendidos.</li>
          <li><b>Martes antes de la reunión:</b> lo que quedó en rojo en la semana es la lista de temas para los socios.</li>
        </ol>
      </details>
    </div>
  )
}
