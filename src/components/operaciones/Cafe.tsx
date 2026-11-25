'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { corta, DC, dow } from '@/lib/operaciones/fechas'
import { fueraDeRango, type ControlCafe, type TurnoCafe } from '@/lib/tolva/cruce'
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
