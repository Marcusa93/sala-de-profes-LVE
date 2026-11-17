import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'
import { normalizeToStockUnit } from '@/lib/produccion/units'
import { notifyEvent } from '@/lib/push/notify-event'
import { logAudit } from '@/lib/audit'
import { crearTareaAlTerminarProduccion } from '@/lib/protocolos/protocolos'
import { CONTROLES, calcularTarea, salidaDespuesDe, type ControlId, type SalidaParte, type TareaParte } from '@/lib/produccion/parte-calculo'

// ---------------------------------------------------------------------------
// Parte de cierre del encargado de producción (sistema de producción, etapa 2)
// ---------------------------------------------------------------------------
// Lo que Gastón manda por WhatsApp, en la app. Se va guardando como borrador
// durante la noche y al final se cierra:
//   · hora de entrada (sale del fichaje) y de salida: obligatorias
//   · cada tarea con su rendimiento (ver parte-calculo); si da bajo, motivo
//   · cada tarea con productos se convierte en una producción a confirmar
//     (pending_review): descuenta el crudo REAL usado (entró − volvió − lo que
//     sigue en proceso), suma cada producto y registra el desperdicio. La
//     confirma la jefa de cocina en «Lo de hoy · Cocina», como «Lo hice».
//   · si un rendimiento quedó bajo, avisa (evento produccion_rendimiento_bajo)
// ---------------------------------------------------------------------------

export const ROLES_PARTE = ['socio', 'encargado', 'chef', 'cocina'] as const

const MAX_TAREAS = 30
const MAX_SALIDAS = 20

export type Parte = {
  id: string | null
  user_id: string
  fecha: string
  estado: 'borrador' | 'cerrado'
  entrada_at: string | null
  salida_at: string | null
  nota: string | null
  tareas: TareaParte[]
  resultado: ResultadoParte | null
  cerrando_at: string | null
  cerrado_at: string | null
  /** entrada según el fichaje, para proponerla */
  entrada_fichaje: string | null
}

export type ResultadoParte = {
  horas: number
  tareas: { id: string; crudo: string; controles: { nombre: string; estado: string; detalle: string }[]; motivo: string | null; desperdicio_kg: number | null; production_order_id: number | null }[]
  producciones: number[]
  errores: string[]
}

type FilaParte = Omit<Parte, 'entrada_fichaje'>

const r3 = (n: number) => Math.round(n * 1000) / 1000
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? r3(n) : null
}
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

// ---- Leer ------------------------------------------------------------------

async function entradaDelFichaje(admin: SupabaseClient, userId: string, fecha: string): Promise<string | null> {
  const { data } = await admin.from('attendance_logs')
    .select('clock_in_at, effective_clock_in_at')
    .eq('user_id', userId).eq('operative_date', fecha)
    .order('clock_in_at', { ascending: false }).limit(1).maybeSingle()
  const f = data as { clock_in_at: string | null; effective_clock_in_at: string | null } | null
  return f?.effective_clock_in_at ?? f?.clock_in_at ?? null
}

/** El parte de una persona para una noche (si no existe, uno vacío sin guardar) */
export async function leerParte(admin: SupabaseClient, userId: string, fecha = fechaOperativa()): Promise<{ parte: Parte; falta_migracion: boolean }> {
  const [{ data, error }, fichaje] = await Promise.all([
    admin.from('partes_produccion').select('*').eq('user_id', userId).eq('fecha', fecha).maybeSingle(),
    entradaDelFichaje(admin, userId, fecha),
  ])
  if (error && /partes_produccion/.test(error.message)) {
    return { parte: vacio(userId, fecha, fichaje), falta_migracion: true }
  }
  if (error) throw new Error(error.message)
  const fila = data as FilaParte | null
  return { parte: fila ? { ...fila, tareas: Array.isArray(fila.tareas) ? fila.tareas : [], entrada_fichaje: fichaje } : vacio(userId, fecha, fichaje), falta_migracion: false }
}

function vacio(userId: string, fecha: string, fichaje: string | null): Parte {
  return { id: null, user_id: userId, fecha, estado: 'borrador', entrada_at: null, salida_at: null, nota: null, tareas: [], resultado: null, cerrando_at: null, cerrado_at: null, entrada_fichaje: fichaje }
}

export type ParteResumen = { id: string; quien: string | null; fecha: string; estado: string; entrada_at: string | null; salida_at: string | null; tareas: number; bajos: string[]; producciones: number }

/** Los últimos partes (de todos), para socios y encargados */
export async function ultimosPartes(admin: SupabaseClient, dias = 14): Promise<ParteResumen[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10)
  const { data } = await admin.from('partes_produccion')
    .select('id, fecha, estado, entrada_at, salida_at, tareas, resultado, profiles!partes_produccion_user_id_fkey(first_name, last_name)')
    .gte('fecha', desde).order('fecha', { ascending: false }).limit(40)
  type Fila = { id: string; fecha: string; estado: string; entrada_at: string | null; salida_at: string | null; tareas: TareaParte[] | null; resultado: ResultadoParte | null; profiles: { first_name: string | null; last_name: string | null } | null }
  return ((data ?? []) as unknown as Fila[]).map((p) => ({
    id: p.id,
    quien: p.profiles ? [p.profiles.first_name, p.profiles.last_name].filter(Boolean).join(' ') || null : null,
    fecha: p.fecha,
    estado: p.estado,
    entrada_at: p.entrada_at,
    salida_at: p.salida_at,
    tareas: (p.tareas ?? []).length,
    bajos: (p.resultado?.tareas ?? []).flatMap((t) => t.controles.filter((c) => c.estado === 'bajo').map((c) => `${t.crudo}: ${c.nombre}`)),
    producciones: (p.resultado?.producciones ?? []).length,
  }))
}

// ---- Guardar borrador ----------------------------------------------------------

export type EntradaParte = {
  fecha?: string
  entrada?: string | null  // "HH:MM"
  salida?: string | null   // "HH:MM"
  nota?: string | null
  tareas?: unknown[]
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function limpiarSalida(raw: Record<string, unknown>, i: number): SalidaParte {
  return {
    id: texto(raw.id, 60) ?? `s${i}`,
    stock_item_id: texto(raw.stock_item_id, 60),
    nombre: texto(raw.nombre, 120) ?? '',
    unidad: texto(raw.unidad, 20),
    porciones: num(raw.porciones),
    kg: num(raw.kg),
    kg_cocido: num(raw.kg_cocido),
    en_proceso: raw.en_proceso === true,
  }
}

function limpiarTarea(raw: Record<string, unknown>, i: number, previa?: TareaParte): TareaParte {
  const controles = (Array.isArray(raw.controles) ? raw.controles : []).filter((c): c is ControlId => typeof c === 'string' && c in CONTROLES)
  return {
    id: texto(raw.id, 60) ?? `t${i}`,
    crudo_stock_item_id: texto(raw.crudo_stock_item_id, 60),
    crudo_nombre: texto(raw.crudo_nombre, 120) ?? '',
    crudo_unidad: texto(raw.crudo_unidad, 20),
    entrada_kg: num(raw.entrada_kg),
    vuelve_kg: num(raw.vuelve_kg),
    desperdicio_kg: num(raw.desperdicio_kg),
    controles: [...new Set(controles)],
    salidas: (Array.isArray(raw.salidas) ? raw.salidas : []).slice(0, MAX_SALIDAS).map((s, j) => limpiarSalida((s ?? {}) as Record<string, unknown>, j)),
    nota: texto(raw.nota, 500),
    motivo: texto(raw.motivo, 500),
    // La producción ya creada no la puede pisar el cliente
    production_order_id: previa?.production_order_id ?? null,
  }
}

export async function guardarParte(admin: SupabaseClient, userId: string, e: EntradaParte): Promise<{ ok: true; parte: Parte } | { ok: false; status: number; error: string }> {
  const fecha = typeof e.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.fecha) ? e.fecha : fechaOperativa()
  if (e.entrada && !HHMM.test(e.entrada)) return { ok: false, status: 400, error: 'La hora de entrada no es válida' }
  if (e.salida && !HHMM.test(e.salida)) return { ok: false, status: 400, error: 'La hora de salida no es válida' }
  const tareasRaw = Array.isArray(e.tareas) ? e.tareas.slice(0, MAX_TAREAS) : []

  const { parte: actual, falta_migracion } = await leerParte(admin, userId, fecha)
  if (falta_migracion) return { ok: false, status: 503, error: 'Falta correr la migración del parte (20261117_partes_produccion.sql)' }
  if (actual.estado === 'cerrado') return { ok: false, status: 409, error: 'Este parte ya está cerrado' }
  if (actual.cerrando_at) return { ok: false, status: 409, error: 'Este parte se está cerrando: recargá la pantalla' }

  const previas = new Map(actual.tareas.map((t) => [t.id, t]))
  const tareas = tareasRaw.map((t, i) => {
    const raw = (t ?? {}) as Record<string, unknown>
    return limpiarTarea(raw, i, previas.get(String(raw.id ?? '')))
  })
  const entrada = e.entrada ? instanteDe(fecha, e.entrada) : null
  const salida = e.salida && entrada ? salidaDespuesDe(entrada, e.salida) : null

  const fila = {
    user_id: userId,
    fecha,
    estado: 'borrador',
    entrada_at: entrada?.toISOString() ?? null,
    salida_at: salida?.toISOString() ?? null,
    nota: texto(e.nota, 1000),
    tareas,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await admin.from('partes_produccion').upsert(fila, { onConflict: 'user_id,fecha' }).select('*').single()
  if (error) return { ok: false, status: 500, error: error.message }
  return { ok: true, parte: { ...(data as FilaParte), entrada_fichaje: actual.entrada_fichaje } }
}

// ---- Cerrar ---------------------------------------------------------------------

type InsumoMin = { id: string; name: string; unit: string; fudo_ingredient_id: string | null; fudo_product_id: string | null; fudo_skip: boolean | null }

/** Lo que falta para poder cerrar (vacío = se puede) */
export function erroresParaCerrar(p: Pick<Parte, 'entrada_at' | 'salida_at' | 'tareas'>): string[] {
  const errores: string[] = []
  if (!p.entrada_at) errores.push('Falta la hora de entrada')
  if (!p.salida_at) errores.push('Falta la hora de salida')
  if (p.entrada_at && p.salida_at && Date.parse(p.salida_at) - Date.parse(p.entrada_at) > 16 * 3_600_000) errores.push('Entre la entrada y la salida hay más de 16 horas: revisá las horas')
  if (p.tareas.length === 0) errores.push('Cargá al menos una tarea')
  for (const t of p.tareas) errores.push(...calcularTarea(t).errores)
  return errores
}

export async function cerrarParte(admin: SupabaseClient, user: { id: string; nombre: string | null }, parteId: string): Promise<{ ok: true; parte: Parte; avisos: string[] } | { ok: false; status: number; error: string; errores?: string[] }> {
  const { data } = await admin.from('partes_produccion').select('*').eq('id', parteId).maybeSingle()
  const fila = data as FilaParte | null
  if (!fila) return { ok: false, status: 404, error: 'Parte no encontrado' }
  if (fila.user_id !== user.id) return { ok: false, status: 403, error: 'El parte lo cierra quien lo cargó' }
  const tareas = Array.isArray(fila.tareas) ? fila.tareas : []
  if (fila.estado === 'cerrado') return { ok: true, parte: { ...fila, tareas, entrada_fichaje: null }, avisos: [] }

  const errores = erroresParaCerrar({ ...fila, tareas })
  if (errores.length) return { ok: false, status: 400, error: 'Falta completar el parte', errores }

  // Lo toma uno solo (si el cierre se cortó, se puede retomar a los 2 minutos)
  const ahora = new Date().toISOString()
  const hace2 = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data: tomado } = await admin.from('partes_produccion')
    .update({ cerrando_at: ahora })
    .eq('id', parteId).eq('estado', 'borrador')
    .or(`cerrando_at.is.null,cerrando_at.lt."${hace2}"`)
    .select('id')
  if (!tomado?.length) return { ok: false, status: 409, error: 'El parte ya se está cerrando: esperá un momento y recargá' }

  // Insumos de todas las tareas
  const ids = [...new Set(tareas.flatMap((t) => [t.crudo_stock_item_id, ...t.salidas.map((s) => s.stock_item_id)]).filter((x): x is string => Boolean(x)))]
  const { data: items } = await admin.from('stock_items').select('id, name, unit, fudo_ingredient_id, fudo_product_id, fudo_skip').in('id', ids)
  const insumo = new Map(((items ?? []) as InsumoMin[]).map((s) => [s.id, s]))

  const avisos: string[] = []
  const erroresCierre: string[] = []
  for (const t of tareas) {
    if (t.production_order_id) continue
    const productos = t.salidas.filter((s) => !s.en_proceso && s.stock_item_id)
    if (productos.length === 0) continue // separar, en proceso: no mueve stock todavía
    const r = await crearProduccionDeTarea(admin, user, fila.fecha, t, insumo)
    if (!r.ok) { erroresCierre.push(`${t.crudo_nombre}: ${r.error}`); continue }
    t.production_order_id = r.orderId
    // Se guarda en el momento: si el cierre se corta, no se vuelve a crear
    await admin.from('partes_produccion').update({ tareas, updated_at: new Date().toISOString() }).eq('id', parteId)
  }

  if (erroresCierre.length) {
    await admin.from('partes_produccion').update({ cerrando_at: null, tareas, updated_at: new Date().toISOString() }).eq('id', parteId)
    return { ok: false, status: 500, error: 'No se pudo cerrar todo el parte', errores: erroresCierre }
  }

  const calculos = tareas.map((t) => ({ t, c: calcularTarea(t) }))
  const resultado: ResultadoParte = {
    horas: Math.round(((Date.parse(fila.salida_at!) - Date.parse(fila.entrada_at!)) / 3_600_000) * 100) / 100,
    tareas: calculos.map(({ t, c }) => ({
      id: t.id,
      crudo: t.crudo_nombre,
      controles: c.controles.map((x) => ({ nombre: x.nombre, estado: x.estado, detalle: x.detalle })),
      motivo: t.motivo,
      desperdicio_kg: t.desperdicio_kg ?? c.desperdicio_calculado,
      production_order_id: t.production_order_id ?? null,
    })),
    producciones: tareas.map((t) => t.production_order_id).filter((x): x is number => typeof x === 'number'),
    errores: [],
  }
  const { data: cerrado } = await admin.from('partes_produccion')
    .update({ estado: 'cerrado', cerrado_at: new Date().toISOString(), tareas, resultado, updated_at: new Date().toISOString() })
    .eq('id', parteId).select('*').single()

  const bajos = calculos.flatMap(({ t, c }) => c.controles.filter((x) => x.estado === 'bajo').map((x) => ({ t, x })))
  if (bajos.length) {
    await notifyEvent(admin, 'produccion_rendimiento_bajo', {
      title: `📉 Rendimiento bajo${user.nombre ? ` — ${user.nombre.split(' ')[0]}` : ''}`,
      body: bajos.map(({ t, x }) => `${x.nombre}: ${x.detalle}${t.motivo ? ` — «${t.motivo}»` : ''}`).join('\n').slice(0, 600),
      url: '/cocina/parte',
    }).catch(() => {})
  }
  if (resultado.producciones.length) await crearTareaAlTerminarProduccion(admin).catch(() => {})
  void logAudit(admin, {
    userId: user.id,
    userName: user.nombre,
    action: 'parte_produccion_cerrado',
    module: 'produccion',
    entityType: 'parte_produccion',
    entityId: parteId,
    description: `${user.nombre ?? 'Alguien'} cerró el parte del ${fila.fecha}: ${tareas.length} tarea${tareas.length === 1 ? '' : 's'}, ${resultado.horas} h${bajos.length ? ` · rendimiento bajo: ${bajos.map(({ x }) => x.nombre).join(', ')}` : ''}`,
    metadata: { resultado },
  })
  if (bajos.length) avisos.push('Se avisó a los socios del rendimiento bajo')
  return { ok: true, parte: { ...(cerrado as FilaParte), entrada_fichaje: null }, avisos }
}

/**
 * Una tarea con productos → una producción a confirmar: el crudo real usado
 * (entró − volvió − lo que sigue en proceso), cada producto y el desperdicio.
 */
async function crearProduccionDeTarea(
  admin: SupabaseClient,
  user: { id: string; nombre: string | null },
  fecha: string,
  t: TareaParte,
  insumo: Map<string, InsumoMin>,
): Promise<{ ok: true; orderId: number } | { ok: false; error: string }> {
  const c = calcularTarea(t)
  const crudo = t.crudo_stock_item_id ? insumo.get(t.crudo_stock_item_id) : undefined
  if (!crudo) return { ok: false, error: 'la materia prima ya no existe' }
  const usadoKg = r3((c.usado_kg ?? 0) - c.en_proceso_kg)
  if (!(usadoKg > 0)) return { ok: false, error: 'no quedan kilos usados para descontar' }
  const entradaUnidad = normalizeToStockUnit(usadoKg, 'kg', crudo)
  if (!entradaUnidad.ok) return { ok: false, error: `${crudo.name} se lleva en ${crudo.unit}: no se pueden descontar kilos` }

  const salidas: { stock_item_id: string; output_name: string; qty_produced: number; unit: string; notes: string }[] = []
  for (const s of t.salidas.filter((x) => !x.en_proceso && x.stock_item_id)) {
    const item = insumo.get(s.stock_item_id!)
    if (!item) return { ok: false, error: `${s.nombre}: el producto ya no existe` }
    const enMasa = /^(kg|g)$/i.test(item.unit)
    const cant = enMasa ? normalizeToStockUnit(s.kg ?? 0, 'kg', item) : { ok: true as const, qty: s.porciones ?? 0, unit: item.unit }
    if (!cant.ok) return { ok: false, error: cant.error }
    salidas.push({
      stock_item_id: item.id,
      output_name: item.name,
      qty_produced: cant.qty,
      unit: cant.unit,
      notes: [s.porciones ? `${s.porciones} porciones` : null, s.kg ? `${s.kg} kg` : null, s.kg_cocido ? `cocido ${s.kg_cocido} kg` : null].filter(Boolean).join(' · ') || '',
    })
  }
  const desperdicio = t.desperdicio_kg ?? c.desperdicio_calculado ?? 0

  const notas = [
    `Parte de cierre del ${fecha}`,
    `entró ${t.entrada_kg} kg de ${crudo.name}${t.vuelve_kg ? ` (volvieron ${t.vuelve_kg} kg)` : ''}${c.en_proceso_kg ? ` (siguen en proceso ${c.en_proceso_kg} kg)` : ''}`,
    ...c.controles.filter((x) => x.estado === 'ok' || x.estado === 'bajo').map((x) => `${x.nombre}: ${x.detalle}`),
    t.motivo ? `Motivo: ${t.motivo}` : null,
    t.nota,
  ].filter(Boolean).join(' · ').slice(0, 1000)

  const { data: orden, error: errOrden } = await admin.from('production_orders')
    .insert({ name: `${crudo.name} — parte ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`, status: 'pending_review', chef_id: user.id, notes: notas, submitted_at: new Date().toISOString() })
    .select('id').single()
  if (errOrden || !orden) return { ok: false, error: errOrden?.message ?? 'no se pudo crear la producción' }
  const orderId = (orden as { id: number }).id

  const deshacer = async (msg: string) => {
    await admin.from('production_outputs').delete().eq('production_order_id', orderId)
    await admin.from('production_inputs').delete().eq('production_order_id', orderId)
    await admin.from('production_orders').delete().eq('id', orderId)
    return { ok: false as const, error: msg }
  }
  const { error: errIn } = await admin.from('production_inputs').insert({ production_order_id: orderId, stock_item_id: crudo.id, qty_used: entradaUnidad.qty, unit: entradaUnidad.unit })
  if (errIn) return deshacer(errIn.message)
  const filas = [
    ...salidas.map((s) => ({ production_order_id: orderId, stock_item_id: s.stock_item_id, output_name: s.output_name, qty_produced: s.qty_produced, unit: s.unit, is_waste: false, notes: s.notes || null })),
    ...(desperdicio > 0 ? [{ production_order_id: orderId, stock_item_id: null, output_name: 'Desperdicio', qty_produced: r3(desperdicio), unit: 'kg', is_waste: true, notes: t.desperdicio_kg != null ? 'cargado en el parte' : 'calculado: entró − salió' }] : []),
  ]
  const { error: errOut } = await admin.from('production_outputs').insert(filas)
  if (errOut) return deshacer(errOut.message)

  void logAudit(admin, {
    userId: user.id,
    userName: user.nombre,
    action: 'create_production_order',
    module: 'produccion',
    entityType: 'production_order',
    entityId: String(orderId),
    description: `${user.nombre ?? 'Alguien'}: parte del ${fecha} — ${crudo.name} ${usadoKg} kg → ${salidas.map((s) => `${s.output_name} ${s.qty_produced} ${s.unit}`).join(', ')}${desperdicio > 0 ? ` · desperdicio ${r3(desperdicio)} kg` : ''}`,
    metadata: { parte: true, tarea: t.id },
  })
  return { ok: true, orderId }
}
