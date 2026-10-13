import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'
import { ETIQUETA_AUSENCIA, type MotivoAusencia } from '@/lib/attendance/ausencias'
import { computeConsumption } from '@/lib/compras/sugerencias'
import { ATRASO_MIN } from '@/lib/protocolos/protocolos'

// ---------------------------------------------------------------------------
// Resumen de cada turno (para Telegram)
// ---------------------------------------------------------------------------
// Al cierre del turno: quién trabajó (y quién no fichó o llegó tarde), qué
// hizo cada uno en la app, las tareas con horario y "Para revisar": conteos
// que no cierran (ej. 400 kg de granola), elaborados en negativo, tareas sin
// hacer. Turno mañana = 06 a 16 h; tarde/noche = 16 a 06 h del día operativo.
// Texto en HTML de Telegram (b, i).
// ---------------------------------------------------------------------------

export type Turno = 'TM' | 'TT'
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`

export function ventanaDeTurno(fecha: string, turno: Turno): { desde: Date; hasta: Date } {
  return turno === 'TM'
    ? { desde: instanteDe(fecha, '06:00'), hasta: instanteDe(fecha, '16:00') }
    : { desde: instanteDe(fecha, '16:00'), hasta: new Date(instanteDe(fecha, '06:00').getTime() + 86_400_000) }
}

/** Qué turno acaba de terminar (el cron de las 16:30 → mañana; el de la madrugada → tarde). */
export function turnoQueTermino(ahora = new Date()): { fecha: string; turno: Turno } {
  const fecha = fechaOperativa(ahora)
  return ahora.getTime() >= instanteDe(fecha, '16:00').getTime() && ahora.getTime() < instanteDe(fecha, '23:59').getTime()
    ? { fecha, turno: 'TM' }
    : { fecha, turno: 'TT' }
}

type Persona = { nombre: string; role: string }

/** "tareas asignadas" → "tarea asignada", "platos servidos (Salón)" → "plato servido (Salón)" */
function singular(q: string): string {
  const [base, resto] = q.split(/ (?=\()/)
  const s = base.split(' ').map((w, i) => (i === 0 || /^(asignadas|servidos|contados|recibidas|pedidos|extendidos)$/.test(w))
    ? w.replace(/iones$/, 'ión').replace(/es$/, (m) => (/(ción|ión)es$/.test(w) ? '' : m)).replace(/s$/, '') : w).join(' ')
  return resto ? `${s} ${resto}` : s
}
type Hizo = Map<string, number> // qué → cuántas

export async function armarResumenTurno(admin: SupabaseClient, fecha: string, turno: Turno, ahora = new Date()): Promise<string> {
  const { desde, hasta: finTurno } = ventanaDeTurno(fecha, turno)
  const hasta = new Date(Math.min(finTurno.getTime(), ahora.getTime()))
  const d = desde.toISOString(), h = hasta.toISOString()
  const enTurno = (hora: string) => (turno === 'TM' ? hora >= '06:00' && hora < '16:00' : hora >= '16:00' || hora < '06:00')

  const [
    { data: perfiles }, { data: turnos }, { data: logs }, { data: ausencias },
    { data: tareas }, { data: protos }, { data: salon }, { data: movs }, { data: pedidos },
    { data: recibos }, { data: tolva }, { data: prods }, { data: audit },
  ] = await Promise.all([
    admin.from('profiles').select('id, first_name, last_name, role'),
    admin.from('shifts').select('user_id, start_time, end_time, shift_role').eq('shift_date', fecha),
    admin.from('attendance_logs').select('user_id, clock_in_at, clock_out_at').eq('operative_date', fecha),
    admin.from('ausencias').select('user_id, motivo').eq('fecha', fecha),
    admin.from('protocolo_tareas').select('protocolo_id, hora, estado, hecho_por, hecho_at, fecha').eq('fecha', fecha),
    admin.from('protocolos').select('id, nombre'),
    admin.from('salon_item_status').select('served_by').gte('served_at', d).lt('served_at', h),
    admin.from('stock_movements').select('stock_item_id, created_by, reason, previous_qty, new_qty, qty, production_order_id').gte('created_at', d).lt('created_at', h),
    admin.from('kitchen_orders').select('created_by, status').gte('created_at', d).lt('created_at', h),
    admin.from('stock_receipts').select('received_by').gte('received_at', d).lt('received_at', h),
    admin.from('tolva_logs').select('created_by').gte('updated_at', d).lt('updated_at', h),
    admin.from('production_orders').select('chef_id, name').gte('created_at', d).lt('created_at', h),
    admin.from('audit_trail').select('user_id, action').gte('created_at', d).lt('created_at', h),
  ])

  const gente = new Map<string, Persona>(((perfiles ?? []) as { id: string; first_name: string | null; last_name: string | null; role: string }[])
    .map((p) => [p.id, { nombre: [p.first_name, p.last_name?.[0] ? `${p.last_name[0]}.` : ''].filter(Boolean).join(' ') || 'Alguien', role: p.role }]))
  const nombre = (id: string | null | undefined) => (id ? gente.get(id)?.nombre ?? 'Alguien' : 'Alguien')
  const nombreProto = new Map(((protos ?? []) as { id: string; nombre: string }[]).map((p) => [p.id, p.nombre]))

  // ---- Qué hizo cada uno en la app ----
  const hizo = new Map<string, Hizo>()
  const sumar = (uid: string | null | undefined, que: string, n = 1) => {
    if (!uid) return
    const m = hizo.get(uid) ?? new Map()
    m.set(que, (m.get(que) ?? 0) + n)
    hizo.set(uid, m)
  }
  type TareaRow = { protocolo_id: string; hora: string; estado: string; hecho_por: string | null; hecho_at: string | null; fecha: string }
  const tareasTurno = ((tareas ?? []) as TareaRow[]).filter((t) => enTurno(t.hora.slice(0, 5)))
  for (const t of (tareas ?? []) as TareaRow[]) {
    if (t.hecho_at && t.hecho_at >= d && t.hecho_at < h) sumar(t.hecho_por, `tarea|${(nombreProto.get(t.protocolo_id) ?? 'tarea').replace(/ \(.*\)$/, '').toLowerCase()}`)
  }
  for (const s of (salon ?? []) as { served_by: string | null }[]) sumar(s.served_by, 'platos servidos (Salón)')
  type Mov = { stock_item_id: string; created_by: string | null; reason: string | null; previous_qty: number | null; new_qty: number | null; qty: number | null; production_order_id: number | null }
  const conteos: Mov[] = []
  for (const m of (movs ?? []) as Mov[]) {
    if (m.reason === 'physical_count') { sumar(m.created_by, 'insumos contados'); conteos.push(m) }
    else if (m.reason === 'waste') sumar(m.created_by, 'mermas')
  }
  for (const p of (prods ?? []) as { chef_id: string | null }[]) sumar(p.chef_id, 'producciones ("Lo hice")')
  for (const o of (pedidos ?? []) as { created_by: string | null; status: string }[]) {
    const r = o.created_by ? gente.get(o.created_by)?.role : null
    sumar(o.created_by, r === 'encargado' || r === 'socio' ? 'productos pedidos' : 'sugerencias de compra')
  }
  for (const r of (recibos ?? []) as { received_by: string | null }[]) sumar(r.received_by, 'compras recibidas ("Llegó")')
  for (const t of (tolva ?? []) as { created_by: string | null }[]) sumar(t.created_by, 'registros de tolva')
  const ACCIONES: Record<string, string> = {
    conteo_diario: 'conteos de elaborados', ask_question: 'preguntas a La Vieja', protocolo_asignar: 'tareas asignadas',
    create_shift: 'cambios de horarios', update_shift: 'cambios de horarios', delete_shift: 'cambios de horarios',
    attendance_corrected: 'correcciones de asistencia', attendance_marked_by_manager: 'correcciones de asistencia', shift_extended: 'turnos extendidos',
    ausencia_motivo: 'motivos de ausencia', fudo_import_recetas: 'importaciones de recetas', faltante_reportado: 'faltantes avisados',
  }
  for (const a of (audit ?? []) as { user_id: string | null; action: string }[]) if (ACCIONES[a.action]) sumar(a.user_id, ACCIONES[a.action])

  // ---- Quién trabajó ----
  type Shift = { user_id: string; start_time: string; end_time: string | null; shift_role: string | null }
  const turnosDelTurno = ((turnos ?? []) as Shift[]).filter((s) => (turno === 'TM' ? s.start_time.slice(0, 5) < '14:00' : s.start_time.slice(0, 5) >= '14:00'))
  type Log = { user_id: string; clock_in_at: string | null; clock_out_at: string | null }
  const logPor = new Map<string, Log>()
  for (const l of (logs ?? []) as Log[]) if (l.clock_in_at) logPor.set(l.user_id, l)
  const ausente = new Map(((ausencias ?? []) as { user_id: string; motivo: MotivoAusencia }[]).map((a) => [a.user_id, a.motivo]))
  const trabajaron = new Set<string>()
  const noFicho: string[] = [], tarde: string[] = [], conMotivo: string[] = [], sinSalida: string[] = []
  for (const s of turnosDelTurno) {
    const l = logPor.get(s.user_id)
    if (!l?.clock_in_at) {
      const mot = ausente.get(s.user_id)
      if (mot) conMotivo.push(`${nombre(s.user_id)} (${ETIQUETA_AUSENCIA[mot]?.toLowerCase() ?? mot})`)
      else if (instanteDe(fecha, s.start_time.slice(0, 5)).getTime() < hasta.getTime()) noFicho.push(`${nombre(s.user_id)} (${s.start_time.slice(0, 5)})`)
      continue
    }
    trabajaron.add(s.user_id)
    const min = Math.round((Date.parse(l.clock_in_at) - instanteDe(fecha, s.start_time.slice(0, 5)).getTime()) / 60000)
    if (min > 10) tarde.push(`${nombre(s.user_id)} (${min} min)`)
    if (!l.clock_out_at && s.end_time && hasta.getTime() - instanteDe(fecha, s.end_time.slice(0, 5)).getTime() > 3_600_000) sinSalida.push(nombre(s.user_id))
  }
  // Fichó en este turno sin turno cargado
  for (const l of logPor.values()) if (l.clock_in_at && l.clock_in_at >= d && l.clock_in_at < h) trabajaron.add(l.user_id)
  for (const uid of hizo.keys()) trabajaron.add(uid)

  // ---- Para revisar ----
  const revisar: string[] = []
  // Conteos que no cierran: alcanzan para más de 4 meses, o 10 veces lo que había
  if (conteos.length) {
    const ids = [...new Set(conteos.map((c) => c.stock_item_id))]
    const [{ data: items }, consumo] = await Promise.all([
      admin.from('stock_items').select('id, name, unit').in('id', ids),
      computeConsumption(admin, 14).catch(() => ({ byItem: new Map<string, number>(), activeDays: 14 })),
    ])
    const item = new Map(((items ?? []) as { id: string; name: string; unit: string }[]).map((i) => [i.id, i]))
    for (const c of conteos) {
      const it = item.get(c.stock_item_id)
      const nuevo = Number(c.new_qty ?? 0), antes = Number(c.previous_qty ?? 0)
      if (!it || nuevo <= 0) continue
      const uso = (consumo.byItem.get(it.id) ?? 0) / Math.max(1, consumo.activeDays)
      const dias = uso > 0 ? nuevo / uso : null
      const grande = (it.unit === 'kg' || it.unit === 'l') && nuevo >= 100
      if ((dias != null && dias > 120) || (dias == null && grande) || (antes > 0 && nuevo >= antes * 10)) {
        const por = dias != null ? `alcanza para ${dias > 730 ? `${Math.round(dias / 365)} años` : `${Math.round(dias)} días`}` : antes > 0 && nuevo >= antes * 10 ? `antes había ${num(antes)}` : 'es mucho'
        const pregunta = it.unit === 'kg' ? '¿Son kg o eran gramos?' : it.unit === 'l' ? '¿Son litros o eran ml?' : '¿Está bien la cantidad?'
        revisar.push(`Conteo de <b>${esc(it.name)}</b>: ${num(nuevo)} ${it.unit} (${por}). ${pregunta} — ${esc(nombre(c.created_by))}`)
      }
    }
  }
  // Tareas con horario
  const ahoraMs = ahora.getTime()
  const sinHacer = tareasTurno.filter((t) => t.estado !== 'hecha' && instanteDe(fecha, t.hora.slice(0, 5)).getTime() + ATRASO_MIN * 60_000 < ahoraMs)
  for (const t of sinHacer) revisar.push(`Tarea sin hacer: <b>${esc(nombreProto.get(t.protocolo_id) ?? 'tarea')}</b> (${t.hora.slice(0, 5)})`)
  const tardeTareas = tareasTurno.filter((t) => t.estado === 'hecha' && t.hecho_at && Date.parse(t.hecho_at) > instanteDe(fecha, t.hora.slice(0, 5)).getTime() + ATRASO_MIN * 60_000)
  for (const t of tardeTareas) revisar.push(`Tarea hecha tarde: ${esc(nombreProto.get(t.protocolo_id) ?? 'tarea')} (${t.hora.slice(0, 5)}, la hizo ${esc(nombre(t.hecho_por))} a las ${hhmm(t.hecho_at!)})`)
  if (sinSalida.length) revisar.push(`Sin fichar la salida: ${sinSalida.map(esc).join(', ')}`)
  // Una vez por día (en el resumen de la noche): elaborados vendidos sin producción registrada
  if (turno === 'TT') {
    const { data: neg } = await admin.from('stock_items').select('name, current_qty').eq('is_active', true).eq('is_produced', true).lt('current_qty', 0).order('current_qty').limit(6)
    const n = (neg ?? []) as { name: string; current_qty: number }[]
    if (n.length) revisar.push(`Elaborados en negativo (se venden pero no se registra "Lo hice"): ${n.map((x) => `${esc(x.name)} ${num(Number(x.current_qty))}`).join(', ')}`)
  }

  // ---- Armar el texto ----
  const titulo = turno === 'TM' ? 'Turno mañana' : 'Turno tarde/noche'
  const dia = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'UTC' })
  const L: string[] = [`📋 <b>${titulo}</b> · ${dia} (${turno === 'TM' ? '06 a 16 h' : '16 a 06 h'})`]

  const tHechas = tareasTurno.filter((t) => t.estado === 'hecha').length
  L.push(`👥 Trabajaron ${trabajaron.size} · tareas ${tHechas}/${tareasTurno.length}${tardeTareas.length ? ` (${tardeTareas.length} tarde)` : ''}`)
  if (noFicho.length) L.push(`🚫 No ficharon: ${noFicho.map(esc).join(', ')}`)
  if (tarde.length) L.push(`⏰ Llegaron tarde: ${tarde.map(esc).join(', ')}`)
  if (conMotivo.length) L.push(`📝 Con motivo: ${conMotivo.map(esc).join(', ')}`)

  const porRol = (r: string) => (r === 'encargado' || r === 'socio' ? 0 : r === 'runner' ? 1 : r === 'barista' ? 2 : r === 'chef' || r === 'cocina' ? 3 : 4)
  const personas = [...trabajaron].map((id) => ({ id, ...(gente.get(id) ?? { nombre: 'Alguien', role: '' }) })).sort((a, b) => porRol(a.role) - porRol(b.role) || a.nombre.localeCompare(b.nombre, 'es'))
  const conActividad = personas.filter((p) => hizo.has(p.id))
  const soloFicharon = personas.filter((p) => !hizo.has(p.id) && p.role !== 'socio')
  if (conActividad.length) {
    L.push('', '<b>Qué hizo cada uno</b>')
    for (const p of conActividad) {
      const todo = [...hizo.get(p.id)!.entries()]
      const tareasHechas = todo.filter(([q]) => q.startsWith('tarea|')).map(([q, n]) => `${q.slice(6)}${n > 1 ? ` (${n})` : ''}`)
      const cosas = todo.filter(([q]) => !q.startsWith('tarea|')).sort((a, b) => b[1] - a[1]).map(([q, n]) => `${n} ${n === 1 ? singular(q) : q}`)
      if (tareasHechas.length) cosas.unshift(`${tareasHechas.length === 1 && !/\(\d+\)$/.test(tareasHechas[0]) ? 'tarea' : 'tareas'}: ${tareasHechas.join(', ')}`)
      L.push(`• <b>${esc(p.nombre)}</b>: ${esc(cosas.join(' · '))}`)
    }
  }
  if (soloFicharon.length) L.push('', `🕐 <b>Solo ficharon:</b> ${soloFicharon.map((p) => esc(p.nombre)).join(', ')}`)

  if (revisar.length) {
    L.push('', '⚠️ <b>Para revisar</b>')
    for (const r of revisar.slice(0, 12)) L.push(`• ${r}`)
    if (revisar.length > 12) L.push(`• y ${plural(revisar.length - 12, 'cosa')} más`)
  } else {
    L.push('', '✅ Nada para revisar.')
  }

  let texto = L.join('\n')
  if (texto.length > 3900) texto = `${texto.slice(0, 3880)}…`
  return texto
}
