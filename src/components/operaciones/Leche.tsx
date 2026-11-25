'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { corta, DC, dow } from '@/lib/operaciones/fechas'
import { lecheFuera, type ControlLeche, type IntervaloLeche } from '@/lib/leche/cruce'
import { Vacio } from './ui'

// ---------------------------------------------------------------------------
// Leche: lo que se usó entre dos conteos contra lo que piden las ventas
// ---------------------------------------------------------------------------
// Usada = lo que había + lo que entró (compras) − lo que quedó. Piden = cada
// plato vendido en Fudo con esa leche en la receta × los litros de la receta.
// Positiva: salió leche sin venta. Negativa: la receta pide de más o una
// compra no se cargó.
// ---------------------------------------------------------------------------

const lt = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })} l`
const AR_MS = 3 * 3_600_000
const fechaAR = (iso: string) => new Date(Date.parse(iso) - AR_MS).toISOString().slice(0, 10)
const horaAR = (iso: string) => new Date(Date.parse(iso) - AR_MS).toISOString().slice(11, 16)
const dia = (iso: string) => { const f = fechaAR(iso); return `${DC[dow(f)]} ${corta(f)}` }

function Diferencia({ i }: { i: IntervaloLeche }) {
  const txt = `${i.diferencia > 0 ? '+' : ''}${lt(i.diferencia)}`
  if (!lecheFuera(i)) return <span className="text-[#006d5a]">{txt}</span>
  return <span className={cn('font-bold', i.diferencia > 0 ? 'text-[#c8312c]' : 'text-[#9a6418]')}>{txt}</span>
}

export function SeccionLeche({ datos, cargando, error }: { datos: ControlLeche | undefined; cargando: boolean; error: string | null }) {
  if (cargando && !datos) return <p className="flex items-center gap-2 text-[12px] text-[#a39e97]"><Loader2 className="size-3.5 animate-spin" /> Cruzando la leche con las ventas…</p>
  if (error && !datos) return <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#c8312c]">{error}</p>
  if (!datos) return null

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[15px] font-bold text-[#3d2c24]">Leche</p>
        <p className="text-[12px] leading-snug text-[#7d6c64]">
          El barista cuenta toda la leche (barra y depósito, en litros) en el <b>Control de leche</b> de la noche. Entre un conteo y el siguiente: lo que había + lo que entró − lo que quedó, contra lo que piden los cafés con leche vendidos en Fudo.
        </p>
      </div>
      {datos.leches.length === 0 && <Vacio>No hay leches en el stock de barra.</Vacio>}

      {datos.leches.map((l) => {
        const tot = l.intervalos.reduce((a, i) => ({ usada: a.usada + i.usada, piden: a.piden + i.piden }), { usada: 0, piden: 0 })
        const dif = tot.usada - tot.piden
        const sinContar = l.diasSinContar.length
        return (
          <section key={l.id} className="space-y-2 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
            <div>
              <p className="text-[14px] font-bold text-[#3d2c24]">{l.nombre}</p>
              <p className="text-[11.5px] leading-snug text-[#7d6c64]">
                {l.ultimoConteo
                  ? <>Último conteo: <b>{lt(l.ultimoConteo.litros)}</b> el {dia(l.ultimoConteo.at).toLowerCase()} a las {horaAR(l.ultimoConteo.at)}. Desde ahí las ventas piden <b>{lt(l.desdeUltimo.piden)}</b>{l.desdeUltimo.ingresos > 0 && <> y entraron <b>{lt(l.desdeUltimo.ingresos)}</b></>}.</>
                  : <b className="text-[#9a6418]">Nunca se contó.</b>}
                {l.intervalos.length > 0 && <> · En el período se usaron <b>{lt(tot.usada)}</b> y las ventas piden <b>{lt(tot.piden)}</b> (<b className={cn(Math.abs(dif) > Math.max(1, tot.piden * 0.15) && (dif > 0 ? 'text-[#c8312c]' : 'text-[#9a6418]'))}>{dif > 0 ? '+' : ''}{lt(dif)}</b>).</>}
                {sinContar > 0 && <> · <b className="text-[#9a6418]">{sinContar} día{sinContar === 1 ? '' : 's'} sin contar</b></>}
              </p>
            </div>
            {l.intervalos.length === 0 ? (
              <Vacio>Todavía no hay dos conteos seguidos para comparar.</Vacio>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[23rem] text-[11.5px]">
                  <thead>
                    <tr className="text-[9.5px] font-semibold uppercase tracking-wide text-[#a39e97]">
                      <th className="px-1 pb-1 text-left">Hasta</th>
                      <th className="px-1 pb-1 text-right">Había</th>
                      <th className="px-1 pb-1 text-right">Entró</th>
                      <th className="px-1 pb-1 text-right">Quedó</th>
                      <th className="px-1 pb-1 text-right">Usada</th>
                      <th className="px-1 pb-1 text-right">Piden</th>
                      <th className="px-1 pb-1 text-right">Dif.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...l.intervalos].reverse().map((i) => (
                      <tr key={i.hasta} className={cn('border-t border-[#f3efe9]', lecheFuera(i) && i.diferencia > 0 && 'bg-[#fff7f6]')}>
                        <td className="px-1 py-1.5 text-[#3d2c24]" title={`Desde ${dia(i.desde)} ${horaAR(i.desde)}`}>{dia(i.hasta)}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums">{lt(i.inicial)}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums">{i.ingresos ? lt(i.ingresos) : ''}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums">{lt(i.final)}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums">{lt(i.usada)}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums" title={`${i.vendidos} platos vendidos`}>{lt(i.piden)}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums"><Diferencia i={i} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}

      <p className="text-[10.5px] leading-snug text-[#a39e97]">
        En rojo: se usó más de 15 % (y más de 1 litro) de lo que piden las ventas: espuma tirada, invitaciones, consumo del personal o leche sin explicar. En ámbar, al revés: la receta pide de más o entró leche que no se cargó como compra. Si el cliente cambia la leche (por ejemplo, de almendras), Fudo puede seguir descontando la entera.
      </p>
    </div>
  )
}
