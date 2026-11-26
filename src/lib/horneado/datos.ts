import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { dow, sumar } from '@/lib/operaciones/fechas'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { BUDIN_DE_PAN, ETIQUETA_TIPO, INICIO_HORNEADO, MERMA_EN_FUDO, PARTE_MANANA, PIEZAS, type BalanceDia, type ControlHorneado, type Pieza, type Recomendado, type Registro, type TipoRegistro } from './config'

// ---------------------------------------------------------------------------
// Control de horneado (solo servidor): registros, ventas de Fudo y balance
// ---------------------------------------------------------------------------
// Ventas: la copia de Fudo de la app (fudo_sales = ítems, fudo_sale_subitems =
// opciones como las 2 del Clásico), por día operativo (de 06:00 a 06:00). Se
// sincroniza de noche: lo de ayer está completo desde temprano; lo de hoy no.
// ---------------------------------------------------------------------------

export const MIGRACION_HORNEADO = '20261123d_horneado.sql'
export const faltaTablaHorneado = (m: string | undefined) => !!m && /horneado_registros/.test(m) && /(does not exist|schema cache|not find)/i.test(m)

/** Comienzo de un día operativo: 06:00 de Argentina */
const inicioDia = (f: string) => `${f}T06:00:00-03:00`

type Respuesta<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** Trae todas las filas, de a 1000 (el máximo que devuelve Supabase por vez) */
async function todas<T>(q: (desde: number, hasta: number) => Respuesta<T>): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += 1000) {
    const { data, error } = await q(a, a + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

type PorDia = Map<string, Map<string, number>>

const sumarEn = (m: PorDia, fecha: string, id: string, q: number) => {
  const d = m.get(fecha) ?? new Map<string, number>()
  d.set(id, (d.get(id) ?? 0) + q)
  m.set(fecha, d)
}

/** Unidades vendidas por día operativo y producto de Fudo: ítems y opciones por separado */
async function ventasPorDia(admin: SupabaseClient, desde: string, hasta: string): Promise<{ items: PorDia; opciones: PorDia }> {
  const ids = [...new Set([...PIEZAS.flatMap((p) => [...p.venta, ...p.opcion, ...p.personal]), BUDIN_DE_PAN])]
  type Fila = { fudo_product_id: string; quantity: number; sold_at: string }
  const consulta = (tabla: 'fudo_sales' | 'fudo_sale_subitems') => todas<Fila>((a, b) =>
    admin.from(tabla).select('fudo_product_id, quantity, sold_at')
      .in('fudo_product_id', ids)
      .gte('sold_at', inicioDia(desde))
      .lt('sold_at', inicioDia(sumar(hasta, 1)))
      .order('sold_at')
      .range(a, b))
  const [filasItems, filasOpciones] = await Promise.all([consulta('fudo_sales'), consulta('fudo_sale_subitems')])
  const items: PorDia = new Map(), opciones: PorDia = new Map()
  for (const f of filasItems) sumarEn(items, fechaOperativa(new Date(f.sold_at)), String(f.fudo_product_id), Number(f.quantity) || 0)
  for (const f of filasOpciones) sumarEn(opciones, fechaOperativa(new Date(f.sold_at)), String(f.fudo_product_id), Number(f.quantity) || 0)
  return { items, opciones }
}

const suma = (m: Map<string, number> | undefined, ids: string[]) => ids.reduce((a, id) => a + (m?.get(id) ?? 0), 0)

/** Vendidas (sueltas + en combos) y consumo del personal de una pieza en un día */
function salidas(v: { items: PorDia; opciones: PorDia }, pieza: Pieza, fecha: string) {
  const p = PIEZAS.find((x) => x.pieza === pieza)!
  return {
    vendidas: suma(v.items.get(fecha), p.venta) + suma(v.opciones.get(fecha), p.opcion),
    personal: suma(v.items.get(fecha), p.personal),
  }
}

/** Cuántas hornear cada día de la semana (0 = domingo): promedio de las últimas 4 semanas */
function recomendadoPorDia(v: { items: PorDia; opciones: PorDia }, pieza: Pieza, hasta: string): Record<number, Recomendado> {
  const porDow = new Map<number, number[]>()
  for (let i = 0; i < 28; i++) {
    const f = sumar(hasta, -i)
    const s = salidas(v, pieza, f)
    porDow.set(dow(f), [...(porDow.get(dow(f)) ?? []), s.vendidas + s.personal])
  }
  const out: Record<number, Recomendado> = {}
  for (const [d, lista] of porDow) {
    const total = Math.ceil(lista.reduce((a, b) => a + b, 0) / lista.length)
    const manana = Math.ceil(total * PARTE_MANANA)
    out[d] = { total, manana, tarde: total - manana, semanas: lista.length }
  }
  return out
}

export async function registrosEntre(admin: SupabaseClient, desde: string, hasta: string): Promise<{ registros: Registro[]; falta_migracion: boolean }> {
  const { data, error } = await admin.from('horneado_registros').select('*').gte('fecha', desde).lte('fecha', hasta).order('created_at')
  if (error) {
    if (faltaTablaHorneado(error.message)) return { registros: [], falta_migracion: true }
    throw new Error(error.message)
  }
  return { registros: (data ?? []) as Registro[], falta_migracion: false }
}

/** Lo registrado de una pieza en un día, por tipo */
function delDia(registros: Registro[], pieza: Pieza, fecha: string) {
  const r = registros.filter((x) => x.pieza === pieza && x.fecha === fecha)
  const total = (t: TipoRegistro) => r.filter((x) => x.tipo === t).reduce((a, x) => a + x.cantidad, 0)
  const sob = r.find((x) => x.tipo === 'sobrante')
  return { horneadas: total('tanda'), budin: total('budin'), tirado: total('tirado'), sobrante: sob ? sob.cantidad : null }
}

// ---------------------------------------------------------------------------

/** Para la pantalla de cocina: lo de hoy y cuántas conviene hornear hoy */
export async function horneadoDeHoy(admin: SupabaseClient) {
  const hoy = fechaOperativa()
  const ayer = sumar(hoy, -1)
  const [{ registros, falta_migracion }, ventas] = await Promise.all([
    registrosEntre(admin, ayer, hoy),
    ventasPorDia(admin, sumar(ayer, -27), ayer),
  ])
  return {
    hoy,
    falta_migracion,
    registros: registros.filter((r) => r.fecha === hoy),
    piezas: PIEZAS.map((p) => ({
      pieza: p.pieza,
      nombre: p.nombre,
      singular: p.singular,
      recomendado: recomendadoPorDia(ventas, p.pieza, ayer)[dow(hoy)] ?? null,
      sobroAyer: delDia(registros, p.pieza, ayer).sobrante,
    })),
  }
}

/** Para el control interno: balance de los últimos días (hasta ayer, que ya está completo en Fudo) */
export async function controlHorneado(admin: SupabaseClient, dias = 14): Promise<ControlHorneado> {
  const ayer = fechaOperativa(new Date(Date.now() - 86_400_000))
  const desde = sumar(ayer, -(dias - 1))
  const desdeVentas = sumar(ayer, -27) < desde ? sumar(ayer, -27) : desde
  const [{ registros, falta_migracion }, ventas] = await Promise.all([
    registrosEntre(admin, sumar(desde, -1), ayer),
    ventasPorDia(admin, desdeVentas, ayer),
  ])

  const fechas: string[] = []
  for (let f = desde; f <= ayer; f = sumar(f, 1)) fechas.push(f)

  const budinVendido: Record<string, number> = {}
  for (const f of fechas) budinVendido[f] = suma(ventas.items.get(f), [BUDIN_DE_PAN]) + suma(ventas.opciones.get(f), [BUDIN_DE_PAN])

  return {
    desde,
    hasta: ayer,
    falta_migracion,
    budinVendido,
    piezas: PIEZAS.map((p) => ({
      pieza: p.pieza,
      nombre: p.nombre,
      singular: p.singular,
      umbral: p.umbral,
      recomendadoSemana: recomendadoPorDia(ventas, p.pieza, ayer),
      dias: fechas.map((f): BalanceDia => {
        const r = delDia(registros, p.pieza, f)
        const antes = delDia(registros, p.pieza, sumar(f, -1))
        const s = salidas(ventas, p.pieza, f)
        const antesDelControl = f < INICIO_HORNEADO
        const entra = r.horneadas + (antes.sobrante ?? 0)
        const sale = s.vendidas + s.personal + r.budin + r.tirado + (r.sobrante ?? 0)
        return {
          fecha: f,
          horneadas: r.horneadas,
          sobranteAyer: antes.sobrante,
          vendidas: s.vendidas,
          personal: s.personal,
          budin: r.budin,
          tirado: r.tirado,
          sobrante: r.sobrante,
          diferencia: entra - sale,
          sinTandas: !antesDelControl && r.horneadas === 0 && s.vendidas + s.personal > 0,
          sinConteo: !antesDelControl && r.sobrante == null,
          antesDelControl,
        }
      }),
    })),
  }
}

// ---------------------------------------------------------------------------
// Cargar y borrar
// ---------------------------------------------------------------------------

export type ResultadoHorneado = { ok: true; aviso?: string } | { ok: false; status: number; error: string }

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** El insumo de la pieza en Fudo (las cajas congeladas), como item de stock de la app */
async function insumoDe(admin: SupabaseClient, pieza: Pieza): Promise<{ id: string; current_qty: number } | null> {
  const p = PIEZAS.find((x) => x.pieza === pieza)!
  const { data } = await admin.from('stock_items').select('id, current_qty').eq('fudo_ingredient_id', p.insumo).eq('is_active', true).limit(1).maybeSingle()
  const it = data as { id: string; current_qty: number | null } | null
  return it ? { id: it.id, current_qty: Number(it.current_qty ?? 0) } : null
}

const descripcion = (pieza: Pieza, tipo: TipoRegistro, cantidad: number) => {
  const p = PIEZAS.find((x) => x.pieza === pieza)!
  return `${cantidad} ${cantidad === 1 ? p.singular : p.nombre.toLowerCase()} ${tipo === 'budin' ? 'al budín de pan' : 'se tiraron'}`
}

/**
 * «Se tiraron» y «Al budín de pan» salen del stock sin venderse: se descuentan
 * del insumo en Fudo como merma. Si Fudo no responde, queda en la cola de
 * reintentos (lo maneja syncToFudo). Devuelve un aviso si no se pudo.
 * Sin la columna descontado_en_fudo (migración 20261126) no se toca Fudo: no
 * habría cómo devolverlo al borrar la carga.
 */
async function descontarEnFudo(admin: SupabaseClient, userId: string, registroId: string, r: { pieza: Pieza; tipo: TipoRegistro; cantidad: number; nota: string | null }): Promise<string | undefined> {
  const { error: sinColumna } = await admin.from('horneado_registros').select('descontado_en_fudo').limit(1)
  if (sinColumna) return undefined
  const item = await insumoDe(admin, r.pieza)
  if (!item) return 'Quedó cargado, pero no se descontó en Fudo: falta vincular el insumo'
  const nota = `Horneado: ${descripcion(r.pieza, r.tipo, r.cantidad)}${r.nota ? ` (${r.nota})` : ''}`
  const res = await syncToFudo(admin, item.id, r3(item.current_qty - r.cantidad), userId, { reason: 'waste', note: nota, deltaOverride: -r.cantidad })
  if (!res.success) {
    console.error('[horneado] merma en Fudo', res.error)
    return `Quedó cargado, pero no se descontó en Fudo (${res.error ?? 'error'})`
  }
  await admin.from('horneado_registros').update({ descontado_en_fudo: true }).eq('id', registroId)
  return undefined
}

export async function agregarRegistro(admin: SupabaseClient, userId: string, r: { pieza: Pieza; tipo: TipoRegistro; cantidad: number; nota: string | null; deAyer?: boolean }): Promise<ResultadoHorneado> {
  // «Quedaron de ayer»: el conteo del cierre de ayer, si nadie lo cargó a la noche
  const deAyer = r.tipo === 'sobrante' && !!r.deAyer
  const fecha = deAyer ? sumar(fechaOperativa(), -1) : fechaOperativa()
  const nota = deAyer ? 'Contado al otro día' : r.nota?.trim().slice(0, 200) || null
  const fila = { fecha, pieza: r.pieza, tipo: r.tipo, cantidad: r.cantidad, nota, created_by: userId }
  if (deAyer) {
    // No pisa el conteo que se hizo al cierre
    const { data, error: e0 } = await admin.from('horneado_registros').select('cantidad').eq('fecha', fecha).eq('pieza', r.pieza).eq('tipo', 'sobrante').maybeSingle()
    if (e0) return { ok: false, status: faltaTablaHorneado(e0.message) ? 503 : 500, error: faltaTablaHorneado(e0.message) ? `Falta correr la migración ${MIGRACION_HORNEADO}` : e0.message }
    if (data) return { ok: false, status: 409, error: `Ya se contaron al cierre de ayer: ${(data as { cantidad: number }).cantidad}` }
  } else if (r.tipo === 'sobrante') {
    // Lo que sobró se cuenta una vez por día: si ya estaba, se reemplaza
    const { error: e1 } = await admin.from('horneado_registros').delete().eq('fecha', fecha).eq('pieza', r.pieza).eq('tipo', 'sobrante')
    if (e1) return { ok: false, status: faltaTablaHorneado(e1.message) ? 503 : 500, error: faltaTablaHorneado(e1.message) ? `Falta correr la migración ${MIGRACION_HORNEADO}` : e1.message }
  }
  const { data: creado, error } = await admin.from('horneado_registros').insert(fila).select('id').single()
  if (error || !creado) {
    const m = error?.message ?? 'No se guardó'
    return { ok: false, status: faltaTablaHorneado(m) ? 503 : 500, error: faltaTablaHorneado(m) ? `Falta correr la migración ${MIGRACION_HORNEADO}` : m }
  }
  if (MERMA_EN_FUDO.has(r.tipo) && r.cantidad > 0) {
    const aviso = await descontarEnFudo(admin, userId, (creado as { id: string }).id, { ...r, nota })
    if (aviso) return { ok: true, aviso }
  }
  return { ok: true }
}

/** Borra un registro: quien lo cargó (el mismo día) o un encargado/socio. Si se había descontado en Fudo, lo devuelve. */
export async function borrarRegistro(admin: SupabaseClient, user: { id: string; role: string }, id: string): Promise<ResultadoHorneado> {
  const { data } = await admin.from('horneado_registros').select('*').eq('id', id).maybeSingle()
  const r = data as Registro | null
  if (!r) return { ok: false, status: 404, error: 'Ya no existe' }
  const gestion = user.role === 'socio' || user.role === 'encargado'
  if (!gestion && (r.created_by !== user.id || r.fecha !== fechaOperativa())) {
    return { ok: false, status: 403, error: 'Solo lo borra quien lo cargó (el mismo día) o un encargado' }
  }
  if (r.descontado_en_fudo) {
    // Se marca antes de devolver: si se toca dos veces «borrar», devuelve una sola
    const { data: tomado } = await admin.from('horneado_registros').update({ descontado_en_fudo: false }).eq('id', id).eq('descontado_en_fudo', true).select('id')
    if (tomado?.length) {
      const item = await insumoDe(admin, r.pieza)
      const res = item
        ? await syncToFudo(admin, item.id, r3(item.current_qty + r.cantidad), user.id, {
          reason: 'waste_return',
          note: `Horneado: se borró «${ETIQUETA_TIPO[r.tipo]}: ${r.cantidad}» del ${r.fecha}`,
          deltaOverride: r.cantidad,
        })
        : { success: false, error: 'falta vincular el insumo' }
      if (!res.success) {
        await admin.from('horneado_registros').update({ descontado_en_fudo: true }).eq('id', id)
        return { ok: false, status: 502, error: `No se borró: no se pudieron devolver en Fudo (${res.error ?? 'error'})` }
      }
    }
  }
  const { error } = await admin.from('horneado_registros').delete().eq('id', id)
  return error ? { ok: false, status: 500, error: error.message } : { ok: true }
}
