'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { corta, DC, dow } from '@/lib/operaciones/fechas'
import { fueraDeRango, type ControlCafe, type TurnoCafe } from '@/lib/tolva/cruce'
import { lunesDe, mermaAlta, type MermaCafe, type Totales } from '@/lib/tolva/merma'
import { Kpi, Vacio } from './ui'

// ---------------------------------------------------------------------------
// Café: lo que usó la tolva contra lo que piden las ventas
// ---------------------------------------------------------------------------
// Tolva = inicio + agregado − final (lo cargan los baristas en el control de
// tolva). Ventas = cada café vendido en Fudo por los gramos de su receta.
// Diferencia positiva: salió más café del que se vendió (purgas, invitaciones,
// consumo del personal o algo sin explicar). Negativa: se vendió más del que
// usó la tolva (la receta pide de más o el peso está mal cargado).
// ---------------------------------------------------------------------------

const kg = (g: number) => (Math.abs(g) >= 1000 ? `${(g / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} kg` : `${Math.round(g).toLocaleString('es-AR')} g`)

function Estado({ t }: { t: TurnoCafe }) {
  if (t.estado === 'falta_agregado') return <span className="font-semibold text-[#9a6418]">falta lo agregado</span>
  if (t.estado === 'sin_cerrar') return <span className="text-[#a39e97]">sin cerrar</span>
  if (t.estado === 'sin_registro') return <span className="font-semibold text-[#9a6418]">sin control</span>
  if (t.diferencia == null) return <span className="text-[#a39e97]">—</span>
  const txt = `${t.diferencia > 0 ? '+' : ''}${kg(t.diferencia)}`
  if (fueraDeRango(t)) return <span className={cn('font-bold', t.diferencia > 0 ? 'text-[#c8312c]' : 'text-[#9a6418]')}>{txt}</span>
  return <span className="text-[#006d5a]">{txt}</span>
}

const porc = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)} %`)
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })

/** Gramos arriba y % abajo (en el celular no se corta en dos renglones) */
function GramosPct({ g, p, signo, className }: { g: number; p: number | null; signo?: boolean; className?: string }) {
  return (
    <span className={cn('inline-block whitespace-nowrap text-right leading-tight', className)}>
      {signo && g > 0 ? '+' : ''}{kg(g)}
      <span className="block text-[10px] font-normal opacity-80">{porc(p)}</span>
    </span>
  )
}

function CeldaMerma({ t }: { t: Totales }) {
  if (!t.tramos) return <span className="text-[#a39e97]">—</span>
  const tono = mermaAlta(t) ? 'font-bold text-[#c8312c]' : t.merma < 0 ? 'font-semibold text-[#9a6418]' : 'text-[#006d5a]'
  return <GramosPct g={t.merma} p={t.mermaPct} signo className={tono} />
}

// ---------------------------------------------------------------------------
// Merma de café por día y semana, de pesaje a pesaje (pedido de Joaquín)
// ---------------------------------------------------------------------------
function SeccionMerma({ m }: { m: MermaCafe }) {
  const esta = m.semanas.find((w) => w.lunes === lunesDe(m.hoy))
  const anterior = m.semanas.filter((w) => w.lunes < lunesDe(m.hoy) && w.tramos > 0).at(-1)
  const dias = [...m.dias].reverse().filter((d) => d.tramos > 0 || d.fecha >= (m.primerCompleto ?? m.hoy))

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[14px] font-bold text-[#3d2c24]">Merma de café</h3>
        <p className="text-[12px] leading-snug text-[#7d6c64]">
          De un pesaje de la tolva al siguiente: <b>usado</b> = peso anterior + recarga − peso actual, contra el <b>teórico</b> = cafés vendidos en Fudo × gramos de su receta. <b>Merma</b> = usado − teórico (en % de lo usado). El <b>descarte</b> (calibración y purga) ya está dentro de la merma; lo que queda es <b>sin explicar</b>.
        </p>
      </div>

      {!m.primerCompleto ? (
        <p className="rounded-xl bg-[#f3efe9] px-3 py-2.5 text-[12px] leading-snug text-[#7d6c64]">
          Arranca con los controles de tolva del 28/11: desde ese día cada pesaje trae la recarga y el descarte. Los números aparecen después del segundo control del día.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Kpi
              k="Merma esta semana"
              v={esta?.tramos ? porc(esta.mermaPct) : '—'}
              sub={esta?.tramos ? `usado ${kg(esta.usado)} · teórico ${kg(esta.teorico)} · ${esta.cafes.toLocaleString('es-AR')} cafés` : 'Sin tramos completos todavía'}
            />
            <Kpi
              k="Descarte esta semana"
              v={esta?.tramos ? kg(esta.descarte) : '—'}
              sub={esta?.tramos ? `${porc(esta.descartePct)} de lo usado · sin explicar ${kg(esta.sinExplicar)}` : undefined}
            />
          </div>
          {anterior && (
            <p className="text-[11.5px] text-[#7d6c64]">
              Semana anterior ({corta(anterior.lunes)} al {corta(anterior.hasta)}): merma <b>{porc(anterior.mermaPct)}</b> ({kg(anterior.merma)}), descarte {kg(anterior.descarte)} ({porc(anterior.descartePct)}), sin explicar {kg(anterior.sinExplicar)}.
            </p>
          )}

          <div className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[24rem] text-[11.5px]">
                <thead>
                  <tr className="text-[9.5px] font-semibold uppercase tracking-wide text-[#a39e97]">
                    <th className="px-1 pb-1 text-left">Día</th>
                    <th className="px-1 pb-1 text-right">Cafés</th>
                    <th className="px-1 pb-1 text-right">Teórico</th>
                    <th className="px-1 pb-1 text-right">Usado</th>
                    <th className="px-1 pb-1 text-right">Merma</th>
                    <th className="px-1 pb-1 text-right">Descarte</th>
                    <th className="px-1 pb-1 text-right">Sin explicar</th>
                  </tr>
                </thead>
                <tbody>
                  {dias.map((d) => (
                    <tr key={d.fecha} className={cn('border-t border-[#f3efe9]', mermaAlta(d) && 'bg-[#fff7f6]')}>
                      <td className="px-1 py-1.5 text-[#3d2c24]">
                        <span className="whitespace-nowrap">{DC[dow(d.fecha)]} {corta(d.fecha)}</span>{d.fecha === m.hoy && <span className="text-[#a39e97]"> · hoy</span>}
                        {d.alertas > 0 && <span className="ml-1 font-bold text-[#9a6418]" title="Caída de la tolva confirmada">⚠</span>}
                        {d.incompletos > 0 && <span className="block text-[10px] text-[#a39e97]">{d.incompletos} pesaje{d.incompletos === 1 ? '' : 's'} sin recarga</span>}
                      </td>
                      <td className="px-1 py-1.5 text-right tabular-nums">{d.tramos ? d.cafes : ''}</td>
                      <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums">{d.tramos ? kg(d.teorico) : ''}</td>
                      <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums">{d.tramos ? kg(d.usado) : ''}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums"><CeldaMerma t={d} /></td>
                      <td className="px-1 py-1.5 text-right tabular-nums">{d.tramos ? <GramosPct g={d.descarte} p={d.descartePct} /> : ''}</td>
                      <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums">{d.tramos ? kg(d.sinExplicar) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {m.semanas.some((w) => w.tramos > 0) && (
            <div className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#a39e97]">Por semana (lunes a domingo)</p>
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-[9.5px] font-semibold uppercase tracking-wide text-[#a39e97]">
                      <th className="px-1 pb-1 text-left">Semana</th>
                      <th className="px-1 pb-1 text-right">Cafés</th>
                      <th className="px-1 pb-1 text-right">Merma</th>
                      <th className="px-1 pb-1 text-right">Descarte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...m.semanas].reverse().filter((w) => w.tramos > 0).map((w) => (
                      <tr key={w.lunes} className={cn('border-t border-[#f3efe9]', mermaAlta(w) && 'bg-[#fff7f6]')}>
                        <td className="whitespace-nowrap px-1 py-1.5 text-[#3d2c24]">{corta(w.lunes)} al {corta(w.hasta)}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums">{w.cafes.toLocaleString('es-AR')}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums"><CeldaMerma t={w} /></td>
                        <td className="px-1 py-1.5 text-right tabular-nums"><GramosPct g={w.descarte} p={w.descartePct} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {m.tramos.length > 0 && (
        <details className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
          <summary className="cursor-pointer text-[12px] font-semibold text-[#3d2c24]">Pesaje por pesaje (últimos 7 días)</summary>
          <ul className="mt-2 space-y-1.5">
            {m.tramos.map((t) => (
              <li key={t.hasta} className="border-t border-[#f3efe9] pt-1.5 text-[11.5px] text-[#3d2c24] first:border-0 first:pt-0">
                <span className="font-semibold">{DC[dow(t.dia)]} {corta(t.dia)} · control {t.control}</span>
                <span className="text-[#a39e97]"> ({hora(t.desde)} → {hora(t.hasta)})</span>
                <span className="block tabular-nums text-[#7d6c64]">
                  {t.pesoAntes} g{t.recarga ? ` + ${t.recarga} g cargados` : ''} → {t.pesoDespues} g: usado <b className="text-[#3d2c24]">{kg(t.usado)}</b>
                  {t.completo
                    ? <> · {t.cafes} cafés piden {kg(t.teorico)}{t.descarte ? ` · descarte ${kg(t.descarte)}` : ''}</>
                    : <span className="text-[#9a6418]"> · sin recarga ni descarte cargados: no entra en la cuenta</span>}
                </span>
                {t.alerta && <span className="block font-semibold text-[#9a6418]">⚠ {t.alerta}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

export function TabCafe({ datos, cargando, error }: { datos: ControlCafe | undefined; cargando: boolean; error: string | null }) {
  if (cargando && !datos) return <p className="flex items-center gap-2 text-[12px] text-[#a39e97]"><Loader2 className="size-3.5 animate-spin" /> Cruzando la tolva con las ventas de Fudo…</p>
  if (error && !datos) return <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#c8312c]">{error}</p>
  if (!datos) return null

  const turnos = datos.turnos
  const completos = turnos.filter((t) => t.diferencia != null)
  const usado = completos.reduce((a, t) => a + Math.max(0, t.real ?? 0), 0)
  const pedido = completos.reduce((a, t) => a + t.esperado, 0)
  const dif = usado - pedido
  const pct = pedido > 0 ? Math.round((dif / pedido) * 100) : null
  const sinAgregado = turnos.filter((t) => t.estado === 'falta_agregado').length
  const sinControl = turnos.filter((t) => t.estado === 'sin_registro').length
  const cafes = turnos.reduce((a, t) => a + t.cafes, 0)

  return (
    <div className="space-y-3">
      {datos.merma && <SeccionMerma m={datos.merma} />}

      <h3 className="pt-1 text-[14px] font-bold text-[#3d2c24]">Turno por turno</h3>
      <p className="text-[12px] leading-snug text-[#7d6c64]">
        Lo que usó la tolva (inicio + lo que se cargó − final, lo cargan los baristas en el <b>Control de tolva</b>) contra lo que piden los cafés vendidos en Fudo, con los gramos de cada receta. Últimos 14 días, turno por turno.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Kpi
          k="Diferencia"
          v={completos.length ? `${dif > 0 ? '+' : ''}${kg(dif)}` : '—'}
          sub={completos.length ? `${pct != null ? `${pct > 0 ? '+' : ''}${pct} % · ` : ''}tolva ${kg(usado)} contra ventas ${kg(pedido)}` : 'Todavía no hay turnos completos'}
        />
        <Kpi
          k="Turnos que se pueden cruzar"
          v={`${completos.length} de ${turnos.length}`}
          sub={`${cafes.toLocaleString('es-AR')} cafés vendidos · ${datos.gr_por_cafe} g por café`}
          frac={turnos.length ? (completos.length / turnos.length) * 100 : null}
        />
      </div>

      {(sinAgregado > 0 || sinControl > 0) && (
        <p className="rounded-xl bg-[#fdf3e3] px-3 py-2.5 text-[12px] leading-snug text-[#9a6418]">
          {sinAgregado > 0 && <><b>{sinAgregado} turno{sinAgregado === 1 ? '' : 's'} sin lo agregado:</b> terminaron con más café del que empezaron, o sea que cargaron café y no lo anotaron. Esos turnos no se pueden cruzar. </>}
          {sinControl > 0 && <><b>{sinControl} turno{sinControl === 1 ? '' : 's'} con ventas de café y sin control de tolva.</b></>}
        </p>
      )}
      {datos.por_nombre && (
        <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#c8312c]">No hay recetas con el insumo «Cafe»: los cafés se cuentan por el nombre del plato y con 17 g cada uno.</p>
      )}

      <section className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
        {turnos.length === 0 ? <Vacio>Sin datos todavía.</Vacio> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-[11.5px]">
              <thead>
                <tr className="text-[9.5px] font-semibold uppercase tracking-wide text-[#a39e97]">
                  <th className="px-1 pb-1 text-left">Turno</th>
                  <th className="px-1 pb-1 text-right">Cafés</th>
                  <th className="px-1 pb-1 text-right">Ventas</th>
                  <th className="px-1 pb-1 text-right">Tolva</th>
                  <th className="px-1 pb-1 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {[...turnos].reverse().map((t) => (
                  <tr key={`${t.fecha}${t.turno}`} className={cn('border-t border-[#f3efe9]', fueraDeRango(t) && (t.diferencia ?? 0) > 0 && 'bg-[#fff7f6]')}>
                    <td className="px-1 py-1.5 text-[#3d2c24]">{DC[dow(t.fecha)]} {corta(t.fecha)} · {t.turno === 'TM' ? 'mañana' : 'tarde'}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{t.cafes}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{t.esperado ? kg(t.esperado) : ''}</td>
                    <td
                      className="px-1 py-1.5 text-right tabular-nums"
                      title={t.inicio != null || t.fin != null ? `${t.inicio ?? '—'} g + ${t.agregado} g cargados − ${t.fin ?? '—'} g` : undefined}
                    >
                      {t.real != null && t.estado === 'ok' ? kg(Math.max(0, t.real)) : ''}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums"><Estado t={t} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[10.5px] leading-snug text-[#a39e97]">
        Se cuentan {datos.productos} productos de Fudo que llevan café en la receta. Diferencia en rojo: la tolva usó más de 15 % (y más de 60 g) de lo que piden las ventas: purgas, invitaciones, consumo del personal o café sin explicar. En ámbar, al revés: se vendió más de lo que usó la tolva, la receta pide de más o el peso está mal cargado.
      </p>
    </div>
  )
}
