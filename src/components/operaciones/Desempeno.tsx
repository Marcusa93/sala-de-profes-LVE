'use client'

import { cn } from '@/lib/utils'
import { claveD, claveS, corta, DIAS, dow, idxSemana, lunes, pct, sumar, type Ahora } from '@/lib/operaciones/fechas'
import { DIARIAS, SEMANALES } from '@/lib/operaciones/tareas'
import { statsPedidos } from '@/lib/operaciones/pedidos'
import { ENCARGADOS, type DatosOperaciones } from '@/lib/operaciones/tipos'
import type { Hecho } from '@/lib/operaciones/alertas'
import { Kpi, Vacio } from './ui'

// ---------------------------------------------------------------------------
// Desempeño: se arma solo con lo que se tilda y se verifica
// ---------------------------------------------------------------------------

type Barra = { v: number; etiqueta: string; titulo: string; parcial: boolean }

function Barras({ datos, vacio, valores }: { datos: Barra[]; vacio: string; valores?: boolean }) {
  if (!datos.length) return <Vacio>{vacio}</Vacio>
  return (
    <div className="flex h-36 items-end gap-[3px] border-b border-[#d9d2c8] pt-4">
      {datos.map((d, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={d.titulo}>
          {valores && <span className="mb-0.5 text-[9.5px] font-bold tabular-nums text-[#7d6c64]">{Math.round(d.v)}%</span>}
          <div
            className={cn('w-full rounded-t-[4px]', d.v >= 80 ? 'bg-[#006d5a]' : d.v >= 50 ? 'bg-[#d4943a]' : 'bg-[#ea504c]', d.parcial && 'opacity-45')}
            style={{ height: `${Math.max(d.v, 2)}%` }}
          />
        </div>
      ))}
    </div>
  )
}

function Ejes({ datos }: { datos: Barra[] }) {
  return (
    <div className="mt-1 flex gap-[3px]">
      {datos.map((d, i) => <span key={i} className="min-w-0 flex-1 truncate text-center text-[9px] tabular-nums text-[#a39e97]">{d.etiqueta}</span>)}
    </div>
  )
}

export function TabDesempeno({ n, datos, hecho }: { n: Ahora; datos: DatosOperaciones; hecho: Hecho }) {
  const ini = datos.inicio

  // Por día hábil, últimas 6 semanas
  const dias: Barra[] = []
  for (let k = 41; k >= 0; k--) {
    const d = sumar(n.hoy, -k)
    if (dow(d) === 0 || (ini && d < ini)) continue
    const h = DIARIAS.filter((t) => hecho(claveD(d), t.id)).length
    dias.push({ v: (h / DIARIAS.length) * 100, etiqueta: '', parcial: d === n.hoy, titulo: `${DIAS[dow(d)]} ${corta(d)}${d === n.hoy ? ' (en curso)' : ''} · ${h} de ${DIARIAS.length}` })
  }
  const paso = Math.ceil(dias.length / 7) || 1
  dias.forEach((x, i) => { if ((dias.length - 1 - i) % paso === 0) x.etiqueta = x.titulo.split(' ')[1] })

  // Por semana, últimas 8: diarias de lunes a sábado + semanales ya vencidas
  const semanas: Barra[] = []
  for (let w = 7; w >= 0; w--) {
    const L = sumar(lunes(n.hoy), -7 * w)
    if (ini && sumar(L, 5) < ini) continue
    let tot = 0, hec = 0
    for (let i = 0; i < 6; i++) {
      const d = sumar(L, i)
      if (d > n.hoy || (ini && d < ini)) continue
      tot += DIARIAS.length
      hec += DIARIAS.filter((t) => hecho(claveD(d), t.id)).length
    }
    const ks = claveS(L)
    for (const t of SEMANALES) {
      const vence = sumar(L, idxSemana(t.dow) - 1)
      const h = hecho(ks, t.id)
      if ((ini && vence < ini) || (vence > n.hoy && !h)) continue
      tot++
      if (h) hec++
    }
    if (!tot) continue
    semanas.push({ v: (hec / tot) * 100, etiqueta: corta(L), parcial: w === 0, titulo: `Semana del ${corta(L)}${w === 0 ? ' (en curso)' : ''} · ${hec} de ${tot} tareas` })
  }

  const diasCerrados = dias.filter((x) => !x.parcial).slice(-20)
  const pd = diasCerrados.length ? Math.round(diasCerrados.reduce((a, x) => a + x.v, 0) / diasCerrados.length) : null
  const semCerradas = semanas.filter((x) => !x.parcial).slice(-4)
  const ps = semCerradas.length ? Math.round(semCerradas.reduce((a, x) => a + x.v, 0) / semCerradas.length) : null
  const st = statsPedidos(datos.pedidos)

  const responsables = [{ nom: 'Joaquín', d: null as string | null }, ...ENCARGADOS.map((e) => ({ nom: e.split(' ')[0], d: e as string }))].map((r) => {
    const l = datos.pedidos.filter((p) => (p.delegado_a ?? null) === r.d)
    return { nom: r.nom, st: statsPedidos(l), tot: l.length }
  })
  const max = Math.max(1, ...responsables.map((r) => r.tot))
  const CATS = [
    { k: 'aTiempo', label: 'Cumplido a tiempo', color: 'bg-[#006d5a]' },
    { k: 'tarde', label: 'Cumplido tarde', color: 'bg-[#d4943a]' },
    { k: 'incumplidos', label: 'No cumplido', color: 'bg-[#ea504c]' },
    { k: 'abiertos', label: 'En curso', color: 'bg-[#5b86c4]' },
  ] as const

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[#7d6c64]">Se arma solo con lo que se tilda y se verifica. Las primeras semanas va a tener pocos datos.</p>
      <div className="grid grid-cols-2 gap-2">
        <Kpi k="Diarias" v={pd == null ? '—' : `${pd} %`} sub={diasCerrados.length ? `promedio de ${diasCerrados.length} días` : 'sin días cerrados'} frac={pd} />
        <Kpi k="Semanas" v={ps == null ? '—' : `${ps} %`} sub={semCerradas.length ? `promedio de ${semCerradas.length} semanas` : 'sin semanas cerradas'} frac={ps} />
        <Kpi k="Pedidos cumplidos" v={st.verificados ? `${pct(st.cumplidos, st.verificados)} %` : '—'} sub={`${st.cumplidos} de ${st.verificados} verificados`} frac={pct(st.cumplidos, st.verificados)} />
        <Kpi k="A tiempo" v={st.cumplidos ? `${pct(st.aTiempo, st.cumplidos)} %` : '—'} sub={`${st.aTiempo} de ${st.cumplidos} cumplidos`} frac={pct(st.aTiempo, st.cumplidos)} />
      </div>

      <section className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
        <p className="text-[13px] font-bold text-[#3d2c24]">Tareas diarias</p>
        <p className="text-[11px] text-[#7d6c64]">% de las {DIARIAS.length} tareas hechas cada día hábil, últimas 6 semanas</p>
        <Barras datos={dias} vacio="Todavía no hay días registrados." />
        <Ejes datos={dias} />
      </section>

      <section className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
        <p className="text-[13px] font-bold text-[#3d2c24]">Por semana</p>
        <p className="text-[11px] text-[#7d6c64]">% de tareas diarias y semanales hechas, últimas 8 semanas</p>
        <Barras datos={semanas} vacio="Todavía no hay semanas registradas." valores />
        <Ejes datos={semanas} />
      </section>

      <section className="space-y-2.5 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
        <div>
          <p className="text-[13px] font-bold text-[#3d2c24]">Pedidos de socios por responsable</p>
          <p className="text-[11px] text-[#7d6c64]">Todos los pedidos anotados, según cómo terminaron</p>
        </div>
        {responsables.every((r) => !r.tot) ? <Vacio>Todavía no hay pedidos anotados.</Vacio> : (
          <>
            {responsables.map((r) => (
              <div key={r.nom} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-right text-[11.5px] font-semibold text-[#3d2c24]">{r.nom}</span>
                <div className="flex h-6 flex-1 overflow-hidden rounded-md bg-[#f3efe9]">
                  {CATS.map((c) => {
                    const v = r.st[c.k]
                    return v > 0 ? (
                      <div key={c.k} className={cn('flex items-center justify-center text-[10.5px] font-bold text-white', c.color)} style={{ width: `${(v / max) * 100}%` }} title={`${r.nom} · ${c.label}: ${v}`}>
                        {v}
                      </div>
                    ) : null
                  })}
                </div>
                <span className="w-6 shrink-0 text-[11px] tabular-nums text-[#7d6c64]">{r.tot}</span>
              </div>
            ))}
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
              {CATS.map((c) => (
                <span key={c.k} className="flex items-center gap-1 text-[10.5px] text-[#7d6c64]">
                  <i className={cn('inline-block size-2.5 rounded-sm', c.color)} /> {c.label}
                </span>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
