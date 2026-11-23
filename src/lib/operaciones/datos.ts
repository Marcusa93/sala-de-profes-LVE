import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { ahora, corta, sumar } from './fechas'
import { tareaValida } from './tareas'
import { ENCARGADOS, QUIENES, type CambioPedido, type CajaDia, type Check, type DatosOperaciones, type PedidoSocio, type Seguimiento } from './tipos'
import type { Sesion } from './acceso'

// ---------------------------------------------------------------------------
// Lectura y cambios del control interno de operaciones (solo servidor)
// ---------------------------------------------------------------------------

const DIAS_HISTORIAL = 75
const MAX_CERRADOS = 150
const MIGRACION = '20261123_control_operaciones.sql'

const faltaTabla = (msg: string | undefined) =>
  !!msg && /(operaciones_|pedidos_socios)/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg)

export type Resultado = { ok: true } | { ok: false; status: number; error: string }
const mal = (status: number, error: string): Resultado => ({ ok: false, status, error })
const OK: Resultado = { ok: true }

export async function leerDatos(s: Sesion): Promise<DatosOperaciones> {
  const { admin } = s
  const hoy = ahora().hoy
  const desde = sumar(hoy, -DIAS_HISTORIAL)

  const [checks, caja, abiertos, cerrados] = await Promise.all([
    admin.from('operaciones_checks').select('periodo, tarea, hecho_por, hecho_at').gte('hecho_at', `${desde}T00:00:00-03:00`),
    admin.from('operaciones_caja').select('fecha, diferencia, motivo, cargado_por, updated_at').gte('fecha', desde),
    admin.from('pedidos_socios').select('*').neq('estado', 'hecho').order('vence'),
    admin.from('pedidos_socios').select('*').eq('estado', 'hecho').order('cerrado', { ascending: false }).limit(MAX_CERRADOS),
  ])
  const vacio: DatosOperaciones = { puede_editar: s.puedeEditar, inicio: s.inicio, falta_migracion: false, checks: [], caja: [], pedidos: [], nombres: {}, yo: s.userId }
  const error = checks.error ?? caja.error ?? abiertos.error ?? cerrados.error
  if (error) {
    if (faltaTabla(error.message)) return { ...vacio, falta_migracion: true }
    throw new Error(error.message)
  }

  const pedidosBase = [...(abiertos.data ?? []), ...(cerrados.data ?? [])] as Omit<PedidoSocio, 'seguimiento'>[]
  const ids = pedidosBase.map((p) => p.id)
  const { data: segData, error: segError } = ids.length
    ? await admin.from('pedidos_socios_seguimiento').select('id, pedido_id, texto, created_by, created_at').in('pedido_id', ids).order('created_at')
    : { data: [], error: null }
  if (segError) throw new Error(segError.message)
  const porPedido = new Map<string, Seguimiento[]>()
  for (const x of (segData ?? []) as Seguimiento[]) porPedido.set(x.pedido_id, [...(porPedido.get(x.pedido_id) ?? []), x])
  const pedidos: PedidoSocio[] = pedidosBase.map((p) => ({ ...p, seguimiento: porPedido.get(p.id) ?? [] }))

  const listaChecks = (checks.data ?? []) as Check[]
  const listaCaja = ((caja.data ?? []) as CajaDia[]).map((c) => ({ ...c, diferencia: c.diferencia == null ? null : Number(c.diferencia) }))

  // Nombres de quienes tildaron, cargaron o anotaron
  const personas = new Set<string>()
  for (const c of listaChecks) if (c.hecho_por) personas.add(c.hecho_por)
  for (const c of listaCaja) if (c.cargado_por) personas.add(c.cargado_por)
  for (const p of pedidos) {
    if (p.created_by) personas.add(p.created_by)
    for (const x of p.seguimiento) if (x.created_by) personas.add(x.created_by)
  }
  const nombres: Record<string, string> = {}
  if (personas.size) {
    const { data } = await admin.from('profiles').select('id, first_name').in('id', [...personas])
    for (const p of (data ?? []) as { id: string; first_name: string | null }[]) nombres[p.id] = p.first_name ?? ''
  }

  return { ...vacio, checks: listaChecks, caja: listaCaja, pedidos, nombres }
}

// ---------------------------------------------------------------------------
// Cambios
// ---------------------------------------------------------------------------

export async function marcarTarea(s: Sesion, periodo: string, tarea: string, hecho: boolean): Promise<Resultado> {
  if (!s.puedeEditar) return mal(403, 'Las tareas las tilda el Jefe de Operaciones')
  if (!tareaValida(periodo, tarea)) return mal(400, 'Tarea desconocida')
  const q = hecho
    ? s.admin.from('operaciones_checks').upsert({ periodo, tarea, hecho_por: s.userId, hecho_at: new Date().toISOString() }, { onConflict: 'periodo,tarea' })
    : s.admin.from('operaciones_checks').delete().eq('periodo', periodo).eq('tarea', tarea)
  const { error } = await q
  return error ? mal(500, faltaTabla(error.message) ? `Falta correr la migración ${MIGRACION}` : error.message) : OK
}

export async function guardarCaja(s: Sesion, fecha: string, diferencia: number | null, motivo: string | null): Promise<Resultado> {
  if (!s.puedeEditar) return mal(403, 'La caja la carga el Jefe de Operaciones')
  const hoy = ahora().hoy
  if (fecha >= hoy || fecha < sumar(hoy, -10)) return mal(400, 'Solo se carga la caja de los últimos días')
  const m = (motivo ?? '').trim()
  const { error } = await s.admin.from('operaciones_caja').upsert({
    fecha,
    diferencia,
    motivo: m ? m.slice(0, 300) : null,
    cargado_por: s.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'fecha' })
  return error ? mal(500, faltaTabla(error.message) ? `Falta correr la migración ${MIGRACION}` : error.message) : OK
}

export type PedidoNuevo = { que: string; pedido_por: string; delegado_a: string | null; vence: string; compromiso: string | null }

const esEncargado = (d: string | null): d is string => !!d && (ENCARGADOS as readonly string[]).includes(d)

async function anotar(s: Sesion, pedidoId: string, texto: string) {
  await s.admin.from('pedidos_socios_seguimiento').insert({ pedido_id: pedidoId, texto: texto.slice(0, 200), created_by: s.userId })
}

export async function nuevoPedido(s: Sesion, p: PedidoNuevo): Promise<Resultado> {
  const que = p.que.trim()
  if (!que) return mal(400, 'Falta qué pidieron')
  if (!(QUIENES as readonly string[]).includes(p.pedido_por)) return mal(400, 'Falta quién lo pidió')
  if (p.delegado_a && !esEncargado(p.delegado_a)) return mal(400, 'Encargado desconocido')
  const hoy = ahora().hoy
  if (p.vence < hoy) return mal(400, 'El vencimiento no puede ser antes de hoy')
  // Solo Joaquín delega al anotar; un socio anota y Joaquín decide
  const delegado = s.puedeEditar && esEncargado(p.delegado_a) ? p.delegado_a : null
  const ahoraIso = new Date().toISOString()
  const { data, error } = await s.admin.from('pedidos_socios').insert({
    que: que.slice(0, 200),
    pedido_por: p.pedido_por,
    delegado_a: delegado,
    delegado_at: delegado ? ahoraIso : null,
    compromiso: delegado ? p.compromiso : null,
    vence: p.vence,
    estado: delegado ? 'delegado' : 'abierto',
    created_by: s.userId,
  }).select('id').single()
  if (error) return mal(500, faltaTabla(error.message) ? `Falta correr la migración ${MIGRACION}` : error.message)
  const id = (data as { id: string }).id
  if (delegado) await anotar(s, id, `Delegado a ${delegado}`)
  else if (!s.puedeEditar) await anotar(s, id, `Lo anotó ${s.nombre.split(' ')[0] || 'un socio'}`)
  return OK
}

export type CambioEntrada = { cambio: CambioPedido; delegado_a?: string | null; compromiso?: string | null }

export async function cambiarPedido(s: Sesion, id: string, c: CambioEntrada): Promise<Resultado> {
  const { data, error } = await s.admin.from('pedidos_socios').select('*').eq('id', id).maybeSingle()
  if (error) return mal(500, error.message)
  const p = data as Omit<PedidoSocio, 'seguimiento'> | null
  if (!p) return mal(404, 'Ese pedido ya no existe')

  if (c.cambio === 'borrar') {
    if (!s.puedeEditar && p.created_by !== s.userId) return mal(403, 'Solo lo borra quien lo anotó o el Jefe de Operaciones')
    const { error: e } = await s.admin.from('pedidos_socios').delete().eq('id', id)
    if (e) return mal(500, e.message)
    void logAudit(s.admin, {
      userId: s.userId, userName: s.nombre, action: 'pedido_socio_borrado', module: 'configuracion',
      entityType: 'pedido_socio', entityId: id, description: `Borró el pedido de ${p.pedido_por}: ${p.que}`,
    })
    return OK
  }
  if (!s.puedeEditar) return mal(403, 'Los pedidos los mueve el Jefe de Operaciones')

  const hoy = ahora().hoy
  const ahoraIso = new Date().toISOString()
  const cambios: Record<string, unknown> = {}
  let nota: string | null = null

  switch (c.cambio) {
    case 'respondido':
    case 'no_respondido':
      cambios.respondido = c.cambio === 'respondido'
      cambios.respondido_at = c.cambio === 'respondido' ? ahoraIso : null
      break
    case 'delegar': {
      const d = c.delegado_a ?? null
      if (d && !esEncargado(d)) return mal(400, 'Encargado desconocido')
      if ((p.delegado_a ?? null) === d) return OK
      if (p.estado === 'hecho') return mal(400, 'El pedido ya está cerrado')
      if (d) {
        Object.assign(cambios, { delegado_a: d, delegado_at: ahoraIso, estado: 'delegado' })
        nota = `Delegado a ${d}`
      } else {
        Object.assign(cambios, { delegado_a: null, delegado_at: null, compromiso: null, estado: 'abierto' })
        nota = 'Lo hace Joaquín'
      }
      break
    }
    case 'compromiso':
      if (!p.delegado_a) return mal(400, 'El compromiso es del encargado: primero delegalo')
      cambios.compromiso = c.compromiso ?? null
      break
    case 'cumplido':
    case 'no_cumplido':
      Object.assign(cambios, {
        estado: 'hecho', resultado: c.cambio, cerrado: hoy, a_tiempo: hoy <= p.vence, respondido: true,
        respondido_at: p.respondido_at ?? ahoraIso,
      })
      nota = c.cambio === 'cumplido' ? 'Verificado: cumplido' : 'Verificado: no cumplido'
      break
    case 'reprogramar': {
      if (p.estado === 'hecho') return mal(400, 'El pedido ya está cerrado')
      const vence = sumar(p.vence > hoy ? p.vence : hoy, 3)
      cambios.vence = vence
      if (p.delegado_a && p.compromiso) cambios.compromiso = sumar(p.compromiso > hoy ? p.compromiso : hoy, 3)
      cambios.reprogramado = (p.reprogramado ?? 0) + 1
      nota = `Reprogramado al ${corta(vence)}`
      break
    }
    case 'reabrir':
      if (p.estado !== 'hecho') return OK
      Object.assign(cambios, { estado: p.delegado_a ? 'delegado' : 'abierto', resultado: null, cerrado: null, a_tiempo: null })
      nota = 'Reabierto'
      break
  }

  cambios.updated_at = ahoraIso
  const { error: e } = await s.admin.from('pedidos_socios').update(cambios).eq('id', id)
  if (e) return mal(500, e.message)
  if (nota) await anotar(s, id, nota)
  return OK
}

export async function seguimientoPedido(s: Sesion, id: string, texto: string): Promise<Resultado> {
  if (!s.puedeEditar) return mal(403, 'El seguimiento lo anota el Jefe de Operaciones')
  const t = texto.trim()
  if (!t) return mal(400, 'Escribí cómo viene')
  const { data } = await s.admin.from('pedidos_socios').select('id, estado').eq('id', id).maybeSingle()
  if (!data) return mal(404, 'Ese pedido ya no existe')
  if ((data as { estado: string }).estado === 'hecho') return mal(400, 'El pedido ya está cerrado')
  const { error } = await s.admin.from('pedidos_socios_seguimiento').insert({ pedido_id: id, texto: t.slice(0, 200), created_by: s.userId })
  if (error) return mal(500, error.message)
  await s.admin.from('pedidos_socios').update({ updated_at: new Date().toISOString() }).eq('id', id)
  return OK
}
