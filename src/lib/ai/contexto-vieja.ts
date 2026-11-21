import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'

// ---------------------------------------------------------------------------
// Datos en vivo para La Vieja de Historia (el asistente)
// ---------------------------------------------------------------------------
// Equipo, producción, protocolos y envíos a la 24, leídos con el cliente admin
// (los permisos por rol los decide la ruta del chat antes de llamar). Todo en
// hora argentina y con el día operativo (corte 06:00), igual que el resto.
// ---------------------------------------------------------------------------

const TZ = 'America/Argentina/Buenos_Aires'

/** "14:05" en hora argentina */
export function horaAR(iso: string | null | undefined): string {
  if (!iso) return '?'
  return new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "sábado 21 de noviembre de 2026, 14:05" */
export function ahoraTextoAR(d = new Date()): string {
  return d.toLocaleString('es-AR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "20/11" en hora argentina */
function diaAR(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit' })
}

export function diaOperativoAnterior(fecha: string): string {
  return new Date(Date.parse(`${fecha}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

const num = (n: number) => Number(Number(n).toFixed(3)).toLocaleString('es-AR')

type Perfil = { id: string; first_name: string | null; last_name: string | null; role: string; is_active: boolean }

export async function cargarPerfiles(admin: SupabaseClient): Promise<Map<string, Perfil>> {
  const { data } = await admin.from('profiles').select('id, first_name, last_name, role, is_active')
  return new Map(((data ?? []) as Perfil[]).map((p) => [p.id, p]))
}

const nombreDe = (perfiles: Map<string, Perfil>, id: string | null | undefined) => {
  const p = id ? perfiles.get(id) : null
  return p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || '?' : '?'
}

const ROL_TXT: Record<string, string> = {
  socio: 'Socios', encargado: 'Encargados', chef: 'Jefe/a de cocina (chef)', cocina: 'Cocina',
  barista: 'Barra (baristas)', runner: 'Salón (runners)', bacha: 'Bacha', cajero: 'Caja',
}

/** Equipo activo agrupado por rol (sale de la base: siempre al día). */
export function contextoEquipo(perfiles: Map<string, Perfil>): string {
  const activos = [...perfiles.values()].filter((p) => p.is_active)
  const porRol = new Map<string, string[]>()
  for (const p of activos) {
    const n = [p.first_name, p.last_name].filter(Boolean).join(' ')
    if (!n) continue
    porRol.set(p.role, [...(porRol.get(p.role) ?? []), n])
  }
  const orden = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha', 'cajero']
  const lineas = [...porRol.entries()]
    .sort(([a], [b]) => (orden.indexOf(a) + 99) % 99 - (orden.indexOf(b) + 99) % 99)
    .map(([rol, ns]) => `- ${ROL_TXT[rol] ?? rol}: ${ns.sort().join(', ')}`)
  return `EQUIPO ACTIVO HOY EN LA APP (${activos.length} personas; quien no está acá fue dado de baja o no tiene usuario):\n${lineas.join('\n')}`
}

type Insumo = { qty_used: number; unit: string | null; stock_item_id: string; stock_items: { name: string; unit: string; current_qty: number } | null }
type Salida = { qty_produced: number; unit: string | null; is_waste: boolean; output_name: string | null; stock_items: { name: string } | null }
type Orden = {
  id: number; name: string; status: string; created_at: string; completed_at: string | null; reviewed_at: string | null
  chef_id: string | null; reviewed_by: string | null; notes: string | null; review_notes: string | null
  production_inputs: Insumo[]; production_outputs: Salida[]
}

function salidasTxt(o: Orden): string {
  const s = o.production_outputs.filter((x) => !x.is_waste)
  return s.map((x) => `${num(x.qty_produced)} ${x.unit ?? ''} ${x.stock_items?.name ?? x.output_name ?? '?'}`.replace(/\s+/g, ' ')).join(', ') || 'sin salidas'
}

/** Insumos con menos stock en la app que lo usado (lo que hoy frena el «Confirmar»). */
function faltantesTxt(o: Orden): string[] {
  const porItem = new Map<string, { nombre: string; unidad: string; hay: number; usado: number }>()
  for (const i of o.production_inputs) {
    if (!i.stock_items) continue
    const x = porItem.get(i.stock_item_id) ?? { nombre: i.stock_items.name, unidad: i.stock_items.unit, hay: Number(i.stock_items.current_qty ?? 0), usado: 0 }
    x.usado += Number(i.qty_used ?? 0)
    porItem.set(i.stock_item_id, x)
  }
  return [...porItem.values()].filter((x) => x.hay < x.usado).map((x) => `${x.nombre}: en la app hay ${num(x.hay)} ${x.unidad} y se usaron ${num(x.usado)}`)
}

const SELECT_ORDEN = 'id, name, status, created_at, completed_at, reviewed_at, chef_id, reviewed_by, notes, review_notes, production_inputs(qty_used, unit, stock_item_id, stock_items(name, unit, current_qty)), production_outputs(qty_produced, unit, is_waste, output_name, stock_items(name))'

/** Producción: para confirmar (con faltantes), confirmadas, rechazadas, partes, mínimos y envíos. */
export async function contextoProduccion(admin: SupabaseClient, perfiles: Map<string, Perfil>, ahora = new Date()): Promise<string> {
  const hoy = fechaOperativa(ahora)
  const ayer = diaOperativoAnterior(hoy)
  const desdeAyer = instanteDe(ayer, '06:00').toISOString()
  const hace3 = new Date(ahora.getTime() - 3 * 86_400_000).toISOString()

  const [pend, hechas, rech, borr, partes, bajoMin, lista, envios] = await Promise.all([
    admin.from('production_orders').select(SELECT_ORDEN).eq('status', 'pending_review').order('created_at', { ascending: false }).limit(20),
    admin.from('production_orders').select(SELECT_ORDEN).eq('status', 'completed').gte('completed_at', desdeAyer).order('completed_at', { ascending: false }).limit(25),
    admin.from('production_orders').select('id, name, status, chef_id, reviewed_by, review_notes, updated_at').in('status', ['rejected', 'cancelled']).gte('updated_at', hace3).order('updated_at', { ascending: false }).limit(10),
    admin.from('production_orders').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    admin.from('partes_produccion').select('user_id, fecha, estado, entrada_at, salida_at, resultado').in('fecha', [ayer, hoy]).order('fecha', { ascending: false }),
    admin.from('stock_items').select('name, unit, current_qty, min_qty').eq('is_active', true).eq('is_produced', true).gt('min_qty', 0).order('name'),
    admin.from('produccion_lista').select('stock_item_id', { count: 'exact', head: true }),
    admin.from('envios_salientes').select('id, estado, created_at, recibido_at, nota, creado_por, envios_salientes_items(nombre, cantidad, unidad)').order('created_at', { ascending: false }).limit(5),
  ])

  const out: string[] = [`DÍA OPERATIVO DE HOY: ${hoy} (el día de trabajo corta a las 06:00; lo de anoche antes de las 06 cuenta para el día anterior)`]

  const pendientes = (pend.data ?? []) as unknown as Orden[]
  if (pendientes.length) {
    out.push(`PRODUCCIONES PARA CONFIRMAR (${pendientes.length}) — el stock no cambia hasta confirmarlas; las confirma otra persona (chef, encargado o socio):\n${pendientes.map((o) => {
      const f = faltantesTxt(o)
      return `- #${o.id} ${o.name} — cargó ${nombreDe(perfiles, o.chef_id)} el ${diaAR(o.created_at)} ${horaAR(o.created_at)} — salió: ${salidasTxt(o)}${o.notes ? ` — nota: «${o.notes.slice(0, 160)}»` : ''}${f.length ? `\n  ⚠️ Falta stock en la app (al confirmar aparece «Confirmar igual»): ${f.join('; ')}` : ''}`
    }).join('\n')}`)
  } else {
    out.push('PRODUCCIONES PARA CONFIRMAR: ninguna.')
  }

  const confirmadas = (hechas.data ?? []) as unknown as Orden[]
  if (confirmadas.length) {
    out.push(`PRODUCCIONES CONFIRMADAS AYER Y HOY (${confirmadas.length}):\n${confirmadas.map((o) =>
      `- #${o.id} ${o.name} — ${salidasTxt(o)} — cargó ${nombreDe(perfiles, o.chef_id)}, confirmó ${nombreDe(perfiles, o.reviewed_by)} (${o.completed_at ? `${diaAR(o.completed_at)} ${horaAR(o.completed_at)}` : '?'})${o.review_notes?.startsWith('Aprobada con faltante') ? ' — confirmada con faltante de stock' : ''}`,
    ).join('\n')}`)
  }

  const rechazadas = (rech.data ?? []) as { id: number; name: string; status: string; chef_id: string | null; reviewed_by: string | null; review_notes: string | null }[]
  if (rechazadas.length) {
    out.push(`RECHAZADAS O ANULADAS (últimos 3 días):\n${rechazadas.map((o) =>
      `- #${o.id} ${o.name} — ${o.status === 'rejected' ? `rechazada por ${nombreDe(perfiles, o.reviewed_by)}` : 'anulada'}${o.review_notes ? `: «${o.review_notes.slice(0, 160)}»` : ''}`,
    ).join('\n')}`)
  }
  if ((borr.count ?? 0) > 0) out.push(`BORRADORES DE PRODUCCIÓN VIEJOS SIN TERMINAR: ${borr.count} (se ven en Producción).`)

  type Parte = { user_id: string; fecha: string; estado: string; entrada_at: string | null; salida_at: string | null; resultado: { errores?: string[]; tareas?: { crudo?: string; controles?: { estado: string; nombre: string; detalle: string }[] }[] } | null }
  const ps = (partes.data ?? []) as Parte[]
  if (ps.length) {
    out.push(`PARTES DE CIERRE (ayer y hoy):\n${ps.map((p) => {
      const bajos = (p.resultado?.tareas ?? []).flatMap((t) => (t.controles ?? []).filter((c) => c.estado === 'bajo').map((c) => `${c.nombre}: ${c.detalle}`))
      const errores = p.resultado?.errores ?? []
      return `- ${nombreDe(perfiles, p.user_id)} · día ${p.fecha} · ${p.estado === 'cerrado' ? 'cerrado' : 'sin cerrar (borrador)'}${p.entrada_at ? ` · entró ${horaAR(p.entrada_at)}` : ''}${p.salida_at ? `, salió ${horaAR(p.salida_at)}` : ''}${bajos.length ? `\n  Rendimiento bajo: ${bajos.join('; ')}` : ''}${errores.length ? `\n  No se sumó al stock: ${errores.join('; ').slice(0, 400)}` : ''}`
    }).join('\n')}`)
  } else {
    out.push('PARTES DE CIERRE: no hay de ayer ni de hoy.')
  }

  const mins = (bajoMin.data ?? []) as { name: string; unit: string; current_qty: number; min_qty: number }[]
  const debajo = mins.filter((m) => Number(m.current_qty) < Number(m.min_qty))
  out.push(debajo.length
    ? `ELABORADOS POR DEBAJO DEL MÍNIMO EN SANTA FE:\n${debajo.map((m) => `- ${m.name}: hay ${num(m.current_qty)} ${m.unit}, mínimo ${num(m.min_qty)}`).join('\n')}`
    : `ELABORADOS POR DEBAJO DEL MÍNIMO EN SANTA FE: ninguno (${mins.length} elaborados tienen mínimo cargado).`)
  if ((lista.count ?? 0) === 0) {
    out.push('LISTA Y MÍNIMOS (/cocina/lista): todavía está VACÍA. Hasta que Marco o Joaquín la carguen, «Qué producir» y el conteo de cierre de Lo de hoy no muestran productos.')
  }

  type Envio = { id: string; estado: string; created_at: string; recibido_at: string | null; nota: string | null; creado_por: string | null; envios_salientes_items: { nombre: string; cantidad: number; unidad: string }[] }
  const es = (envios.data ?? []) as Envio[]
  if (es.length) {
    const ESTADO: Record<string, string> = { pendiente_envio: 'sin mandar todavía', en_camino: 'en camino (la 24 todavía no lo recibió)', recibido: 'llegó', anulado: 'anulado' }
    out.push(`ÚLTIMOS ENVÍOS A LA 24 (el detalle de lo recibido está en Enviar a la 24):\n${es.map((e) =>
      `- ${diaAR(e.created_at)} ${horaAR(e.created_at)} · ${ESTADO[e.estado] ?? e.estado} · armó ${nombreDe(perfiles, e.creado_por)} · ${e.envios_salientes_items.map((i) => `${num(i.cantidad)} ${i.unidad} ${i.nombre}`).join(', ').slice(0, 300)}`,
    ).join('\n')}`)
  }

  return out.join('\n\n')
}

/** Protocolos del día: los encargados ven todos; el resto, los suyos. */
export async function contextoProtocolos(admin: SupabaseClient, perfiles: Map<string, Perfil>, opts: { verTodos: boolean; userId: string }, ahora = new Date()): Promise<string> {
  const hoy = fechaOperativa(ahora)
  let q = admin.from('protocolo_tareas').select('hora, estado, asignado_a, hecho_por, hecho_at, protocolos(nombre)').eq('fecha', hoy).order('hora')
  if (!opts.verTodos) q = q.eq('asignado_a', opts.userId)
  const { data } = await q
  type Tarea = { hora: string | null; estado: string; asignado_a: string | null; hecho_por: string | null; hecho_at: string | null; protocolos: { nombre: string } | null }
  const tareas = (data ?? []) as unknown as Tarea[]
  if (!tareas.length) return opts.verTodos ? 'PROTOCOLOS DE HOY: no hay tareas generadas.' : 'TUS PROTOCOLOS DE HOY: no tenés tareas asignadas.'
  const ya = ahora.getTime()
  const lineas = tareas.map((t) => {
    const atrasada = t.estado !== 'hecha' && t.hora && instanteDe(hoy, t.hora).getTime() < ya
    const estado = t.estado === 'hecha'
      ? `✅ hecha por ${nombreDe(perfiles, t.hecho_por)} a las ${horaAR(t.hecho_at)}`
      : `${atrasada ? '🔴 atrasada' : '⏳ pendiente'}${t.asignado_a ? `, asignada a ${nombreDe(perfiles, t.asignado_a)}` : ', sin asignar'}`
    return `- ${t.hora?.slice(0, 5) ?? 'sin hora'} ${t.protocolos?.nombre ?? 'Protocolo'}: ${estado}`
  })
  return `${opts.verTodos ? 'PROTOCOLOS DE HOY' : 'TUS PROTOCOLOS DE HOY'}:\n${lineas.join('\n')}`
}
