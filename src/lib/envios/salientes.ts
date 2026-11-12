import type { SupabaseClient } from '@supabase/supabase-js'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { esCostoConfiable } from '@/lib/costos/confiable'
import { convertQty } from '@/lib/produccion/units'
import { notifyEvent } from '@/lib/push/notify-event'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Envíos de producción de Santa Fe a la 24 (aprobado por Joaquín el 12/11)
// ---------------------------------------------------------------------------
// 1. Se guarda el envío acá (pendiente_envio) con su propio id.
// 2. Se le manda a la 24: POST <ENVIOS_24_URL>/api/envios/entrantes con la
//    clave compartida ENVIOS_CLAVE. El mismo id nunca entra dos veces allá.
// 3. Solo si la 24 lo aceptó (201 o 200) baja el stock de cada insumo acá,
//    como MOVIMIENTO sobre Fudo (motivo 'transfer_out', movement_type 'out'),
//    por el mismo camino que merma/recepción: si Fudo falla, queda en la cola
//    de reintentos. stock_descontado_at evita descontar dos veces.
// 4. Si la 24 no responde (red, 5xx) queda pendiente y el pulso lo reintenta;
//    si responde 4xx, la 24 lo rechazó: se muestra el error y no se reintenta.
// 5. El pulso le pregunta a la 24 si llegó; si llegó con faltantes avisa a
//    socios y encargados. El stock de acá ya salió: no se toca.
// 6. Anular (antes de que llegue): DELETE a la 24 y, si dice que sí, vuelve
//    el stock acá (delta +). Si la 24 ya lo recibió (409), no se puede.
// ---------------------------------------------------------------------------

const TZ = 'America/Argentina/Buenos_Aires'
export const MAX_ITEMS = 100
const ESPERA_MS = 8_000

export const ROLES_ENVIOS = ['socio', 'encargado', 'chef', 'cocina'] as const

export type EstadoEnvio = 'pendiente_envio' | 'en_camino' | 'recibido' | 'anulado'

type FilaEnvio = {
  id: string
  estado: EstadoEnvio
  creado_por: string | null
  created_at: string
  nota: string | null
  enviado_at: string | null
  stock_descontado_at: string | null
  recibido_at: string | null
  recibido_por: string | null
  nota_recepcion: string | null
  anulado_at: string | null
  ultimo_error: string | null
}

type FilaItem = {
  id: string
  envio_id: string
  stock_item_id: string | null
  nombre: string
  unidad: string
  cantidad: number
  costo_unitario: number | null
  cantidad_recibida: number | null
  unidad_recibida: string | null
  producto_24: string | null
}

/** Lo que devuelve la 24 en GET /api/envios/entrantes/<envio_id> */
type Estado24 = {
  envio_id: string
  estado: 'en_camino' | 'recibido' | 'anulado'
  recibido_at: string | null
  recibido_por: string | null
  nota_recepcion: string | null
  anulado_at: string | null
  items: { item_id: string; cantidad_recibida: number | null; unidad_recibida: string | null; producto_24: string | null }[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const cant = (n: number, unidad: string) => `${Number(n.toFixed(3)).toLocaleString('es-AR')} ${unidad}`
const diaDe = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit' })
const ahora = () => new Date().toISOString()

// ---- Conexión con la 24 -------------------------------------------------------

/** null si está todo para hablar con la 24; si no, qué falta */
export function faltaConfigurar(): string | null {
  const clave = process.env.ENVIOS_CLAVE
  if (!clave || clave.length < 32) return 'Falta configurar ENVIOS_CLAVE en la app de Santa Fe (la misma clave que tiene la 24)'
  return null
}

const base24 = () => (process.env.ENVIOS_24_URL || 'https://lve24.com.ar').trim().replace(/\/+$/, '')

/** status 0 = la 24 no respondió (red, tiempo agotado, sin configurar) */
type Resp24 = { status: number; body: Record<string, unknown> | null; error: string | null }

async function llamar24(method: 'GET' | 'POST' | 'DELETE', ruta: string, body?: unknown): Promise<Resp24> {
  const falta = faltaConfigurar()
  if (falta) return { status: 0, body: null, error: falta }
  try {
    const res = await fetch(`${base24()}/api/envios/entrantes${ruta}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.ENVIOS_CLAVE}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(ESPERA_MS),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    const error = res.ok ? null : typeof json?.error === 'string' ? json.error : `La 24 respondió ${res.status}`
    return { status: res.status, body: json, error }
  } catch (err) {
    const nombre = err instanceof Error ? err.name : ''
    return {
      status: 0,
      body: null,
      error: nombre === 'TimeoutError' || nombre === 'AbortError'
        ? 'La 24 no respondió a tiempo'
        : `No se pudo hablar con la 24 (${err instanceof Error ? err.message : 'error de red'})`,
    }
  }
}

/** Sin respuesta o error del lado de la 24: se puede reintentar. 4xx no. */
const reintentable = (status: number) => status === 0 || status >= 500

// ---- Lectura ----------------------------------------------------------------

async function leerEnvio(admin: SupabaseClient, id: string): Promise<{ envio: FilaEnvio; items: FilaItem[] } | null> {
  const { data: envio } = await admin.from('envios_salientes').select('*').eq('id', id).maybeSingle()
  if (!envio) return null
  const { data: items } = await admin.from('envios_salientes_items').select('*').eq('envio_id', id).order('created_at')
  return {
    envio: envio as FilaEnvio,
    items: ((items ?? []) as FilaItem[]).map((i) => ({
      ...i,
      cantidad: Number(i.cantidad),
      costo_unitario: i.costo_unitario == null ? null : Number(i.costo_unitario),
      cantidad_recibida: i.cantidad_recibida == null ? null : Number(i.cantidad_recibida),
    })),
  }
}

async function nombreDe(admin: SupabaseClient, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await admin.from('profiles').select('first_name, last_name').eq('id', userId).maybeSingle()
  const p = data as { first_name: string | null; last_name: string | null } | null
  return p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null : null
}

/** El item_id con el que la 24 conoce cada producto: el id del insumo de Santa Fe */
const itemIdPara24 = (i: FilaItem) => i.stock_item_id ?? i.id

/**
 * Faltantes de un envío recibido: lo que llegó (en la unidad de la 24) pasado
 * a la unidad de Santa Fe, contra lo que se mandó. Si las unidades no se
 * pueden comparar (kg contra unidad) no se cuenta como faltante.
 */
export function faltantesDe(items: Pick<FilaItem, 'nombre' | 'unidad' | 'cantidad' | 'cantidad_recibida' | 'unidad_recibida'>[]): string[] {
  const out: string[] = []
  for (const i of items) {
    if (i.cantidad_recibida == null || !i.unidad_recibida) continue
    const llego = convertQty(Number(i.cantidad_recibida), i.unidad_recibida, i.unidad)
    if (llego == null) continue
    if (llego < Number(i.cantidad) - 0.0005) out.push(`${i.nombre}: llegaron ${cant(llego, i.unidad)} de ${cant(Number(i.cantidad), i.unidad)}`)
  }
  return out
}

// ---- Crear y mandar ----------------------------------------------------------

export type ItemPedido = { stock_item_id: string; cantidad: number }

export type ResultadoEnvio =
  | { ok: true; id: string; estado: EstadoEnvio; mensaje: string; erroresStock?: string[] }
  | { ok: false; id?: string; estado?: EstadoEnvio; status: number; error: string }

type InsumoParaEnviar = {
  id: string
  name: string
  unit: string
  is_active: boolean | null
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  fudo_skip: boolean | null
  cost_source: string | null
  cost_per_unit: number | null
}

export async function crearEnvio(admin: SupabaseClient, p: { userId: string; items: ItemPedido[]; nota: string | null }): Promise<ResultadoEnvio> {
  const falta = faltaConfigurar()
  if (falta) return { ok: false, status: 503, error: falta }

  const items = p.items
  if (!Array.isArray(items) || items.length === 0) return { ok: false, status: 400, error: 'Elegí al menos un producto para mandar' }
  if (items.length > MAX_ITEMS) return { ok: false, status: 400, error: `Como mucho ${MAX_ITEMS} productos por envío` }
  const ids = items.map((i) => String(i.stock_item_id ?? ''))
  if (ids.some((id) => !id)) return { ok: false, status: 400, error: 'Falta elegir el producto en algún renglón' }
  if (new Set(ids).size !== ids.length) return { ok: false, status: 400, error: 'Hay un producto repetido: sumá las cantidades en un solo renglón' }

  const { data: filas, error: errInsumos } = await admin.from('stock_items')
    .select('id, name, unit, is_active, fudo_ingredient_id, fudo_product_id, fudo_skip, cost_source, cost_per_unit')
    .in('id', ids)
  if (errInsumos) return { ok: false, status: 500, error: errInsumos.message }
  const insumo = new Map(((filas ?? []) as InsumoParaEnviar[]).map((s) => [s.id, s]))

  const renglones: Omit<FilaItem, 'id' | 'envio_id' | 'cantidad_recibida' | 'unidad_recibida' | 'producto_24'>[] = []
  for (const it of items) {
    const s = insumo.get(it.stock_item_id)
    if (!s || s.is_active === false) return { ok: false, status: 400, error: 'Un producto del envío ya no está en stock: recargá la pantalla' }
    const cantidad = Number(it.cantidad)
    if (!Number.isFinite(cantidad) || cantidad <= 0) return { ok: false, status: 400, error: `${s.name}: la cantidad tiene que ser mayor a 0` }
    // Sin vínculo con Fudo el stock no se puede bajar (ni acá ni allá)
    if (!s.fudo_ingredient_id && !s.fudo_product_id && !s.fudo_skip) {
      return { ok: false, status: 400, error: `${s.name} no está vinculado a Fudo: vinculalo (o marcalo como "solo en la app") en su ficha de Stock antes de mandarlo` }
    }
    const costo = s.cost_per_unit == null ? null : Number(s.cost_per_unit)
    renglones.push({
      stock_item_id: s.id,
      nombre: s.name,
      unidad: s.unit,
      cantidad: r3(cantidad),
      costo_unitario: esCostoConfiable(s.cost_source, costo) ? costo : null,
    })
  }

  const { data: creado, error: errEnvio } = await admin.from('envios_salientes')
    .insert({ estado: 'pendiente_envio', creado_por: p.userId, nota: p.nota?.trim().slice(0, 500) || null })
    .select('id').single()
  if (errEnvio || !creado) return { ok: false, status: 500, error: errEnvio?.message ?? 'No se pudo guardar el envío' }
  const id = (creado as { id: string }).id

  const { error: errItems } = await admin.from('envios_salientes_items').insert(renglones.map((r) => ({ ...r, envio_id: id })))
  if (errItems) {
    await admin.from('envios_salientes').delete().eq('id', id)
    return { ok: false, status: 500, error: errItems.message }
  }

  const res = await mandarEnvio(admin, id)
  void logAudit(admin, {
    userId: p.userId,
    userName: await nombreDe(admin, p.userId),
    action: 'envio_24_creado',
    module: 'cocina',
    entityType: 'envio_saliente',
    entityId: id,
    description: `Envío a la 24: ${renglones.slice(0, 5).map((r) => `${cant(r.cantidad, r.unidad)} ${r.nombre}`).join(', ')}${renglones.length > 5 ? ` y ${renglones.length - 5} más` : ''} → ${res.ok ? res.estado : res.error}`.slice(0, 1000),
    metadata: { estado: res.ok ? res.estado : res.estado ?? null, error: res.ok ? null : res.error },
  })
  return res
}

/**
 * Le manda a la 24 un envío pendiente. Lo usa la creación, el pulso y el
 * botón Reintentar; es seguro llamarlo dos veces (la 24 no duplica el id y el
 * stock se descuenta una sola vez).
 */
export async function mandarEnvio(admin: SupabaseClient, id: string): Promise<ResultadoEnvio> {
  const leido = await leerEnvio(admin, id)
  if (!leido) return { ok: false, status: 404, error: 'Envío no encontrado' }
  const { envio, items } = leido
  if (envio.estado !== 'pendiente_envio') return { ok: true, id, estado: envio.estado, mensaje: 'Ya estaba enviado' }

  const r = await llamar24('POST', '', {
    envio_id: envio.id,
    enviado_at: envio.created_at,
    enviado_por: await nombreDe(admin, envio.creado_por),
    nota: envio.nota,
    items: items.map((i) => ({ item_id: itemIdPara24(i), nombre: i.nombre, unidad: i.unidad, cantidad: i.cantidad, costo_unitario: i.costo_unitario })),
  })

  if (r.status === 200 || r.status === 201) {
    const { data: marcado } = await admin.from('envios_salientes')
      .update({ estado: 'en_camino', enviado_at: ahora(), ultimo_error: null })
      .eq('id', id).eq('estado', 'pendiente_envio').select('id')
    if (!marcado?.length) {
      // Mientras viajaba el pedido alguien lo anuló acá: que la 24 tampoco lo espere
      const { data: actual } = await admin.from('envios_salientes').select('estado').eq('id', id).maybeSingle()
      if ((actual as { estado: string } | null)?.estado === 'anulado') {
        await llamar24('DELETE', `/${encodeURIComponent(id)}`)
        return { ok: false, id, estado: 'anulado', status: 409, error: 'El envío se anuló mientras se mandaba' }
      }
    }
    const stock = await descontarStock(admin, id)
    return {
      ok: true,
      id,
      estado: 'en_camino',
      mensaje: stock.errores.length ? 'La 24 lo recibió en camino, pero algún stock no se pudo bajar' : 'En camino a la 24',
      ...(stock.errores.length ? { erroresStock: stock.errores } : {}),
    }
  }

  if (reintentable(r.status)) {
    await admin.from('envios_salientes').update({ ultimo_error: (r.error ?? 'La 24 no respondió').slice(0, 500) }).eq('id', id).eq('estado', 'pendiente_envio')
    return { ok: true, id, estado: 'pendiente_envio', mensaje: `Quedó guardado y se manda solo cuando la 24 responda (${r.error ?? 'sin respuesta'})` }
  }

  // 4xx: la 24 lo rechazó. No se reintenta y el stock no se tocó.
  const error = `La 24 lo rechazó: ${r.error ?? `error ${r.status}`}`
  await admin.from('envios_salientes')
    .update({ estado: 'anulado', anulado_at: ahora(), ultimo_error: error.slice(0, 500) })
    .eq('id', id).eq('estado', 'pendiente_envio')
  return { ok: false, id, estado: 'anulado', status: 400, error }
}

/**
 * Baja el stock de Santa Fe de un envío que la 24 ya aceptó. Una sola vez: la
 * marca stock_descontado_at se toma antes de mover nada.
 */
async function descontarStock(admin: SupabaseClient, id: string): Promise<{ hecho: boolean; errores: string[] }> {
  const { data: tomado } = await admin.from('envios_salientes')
    .update({ stock_descontado_at: ahora() })
    .eq('id', id).in('estado', ['en_camino', 'recibido']).is('stock_descontado_at', null)
    .select('id, creado_por, created_at')
  const envio = (tomado?.[0] ?? null) as Pick<FilaEnvio, 'id' | 'creado_por' | 'created_at'> | null
  if (!envio) return { hecho: false, errores: [] }

  const leido = await leerEnvio(admin, id)
  const errores = await moverStock(admin, leido?.items ?? [], {
    reason: 'transfer_out',
    signo: -1,
    userId: envio.creado_por,
    nota: (i) => `Envío a la 24 del ${diaDe(envio.created_at)}: −${cant(i.cantidad, i.unidad)}`,
  })
  if (errores.length) {
    await admin.from('envios_salientes').update({ ultimo_error: `Stock: ${errores.join('; ')}`.slice(0, 500) }).eq('id', id)
  }
  return { hecho: true, errores }
}

async function moverStock(
  admin: SupabaseClient,
  items: FilaItem[],
  p: { reason: 'transfer_out' | 'transfer_return'; signo: 1 | -1; userId: string | null; nota: (i: FilaItem) => string },
): Promise<string[]> {
  const errores: string[] = []
  for (const i of items) {
    if (!i.stock_item_id) { errores.push(`${i.nombre}: el insumo ya no existe`); continue }
    const { data: actual } = await admin.from('stock_items').select('current_qty').eq('id', i.stock_item_id).maybeSingle()
    const delta = r3(p.signo * Number(i.cantidad))
    const res = await syncToFudo(admin, i.stock_item_id, r3(Number((actual as { current_qty: number } | null)?.current_qty ?? 0) + delta), p.userId ?? undefined, {
      reason: p.reason,
      deltaOverride: delta,
      note: p.nota(i),
    })
    if (!res.success) errores.push(`${i.nombre}: ${res.error ?? 'no se pudo mover el stock'}`)
  }
  return errores
}

// ---- Anular -------------------------------------------------------------------

export async function anularEnvio(admin: SupabaseClient, id: string, userId: string): Promise<ResultadoEnvio> {
  const leido = await leerEnvio(admin, id)
  if (!leido) return { ok: false, status: 404, error: 'Envío no encontrado' }
  const { envio } = leido
  if (envio.estado === 'anulado') return { ok: true, id, estado: 'anulado', mensaje: 'Ya estaba anulado' }
  if (envio.estado === 'recibido') return { ok: false, id, estado: 'recibido', status: 409, error: 'La 24 ya lo recibió: no se puede anular' }

  const r = await llamar24('DELETE', `/${encodeURIComponent(id)}`)
  // 404: la 24 no lo tiene (nunca le llegó), así que nadie lo va a recibir
  if (r.status === 200 || r.status === 404) return anularAca(admin, id, userId)
  if (r.status === 409) {
    await consultarEnvio(admin, id)
    return { ok: false, id, estado: 'recibido', status: 409, error: 'La 24 ya lo recibió: no se puede anular' }
  }
  if (reintentable(r.status)) return { ok: false, id, estado: envio.estado, status: 502, error: `${r.error ?? 'La 24 no respondió'}. Probá de nuevo en un rato.` }
  return { ok: false, id, estado: envio.estado, status: 400, error: r.error ?? `La 24 respondió ${r.status}` }
}

/** La 24 ya no lo espera: se marca anulado acá y, si el stock había salido, vuelve. */
async function anularAca(admin: SupabaseClient, id: string, userId: string | null): Promise<ResultadoEnvio> {
  const { data: tomado } = await admin.from('envios_salientes')
    .update({ estado: 'anulado', anulado_at: ahora(), ultimo_error: null })
    .eq('id', id).in('estado', ['pendiente_envio', 'en_camino'])
    .select('stock_descontado_at, created_at, creado_por')
  const fila = (tomado?.[0] ?? null) as Pick<FilaEnvio, 'stock_descontado_at' | 'created_at' | 'creado_por'> | null
  if (!fila) {
    const { data: actual } = await admin.from('envios_salientes').select('estado').eq('id', id).maybeSingle()
    const estado = (actual as { estado: EstadoEnvio } | null)?.estado
    if (estado === 'anulado') return { ok: true, id, estado, mensaje: 'Ya estaba anulado' }
    return { ok: false, id, estado, status: 409, error: 'El envío cambió mientras se anulaba: recargá la pantalla' }
  }

  let errores: string[] = []
  if (fila.stock_descontado_at) {
    const leido = await leerEnvio(admin, id)
    errores = await moverStock(admin, leido?.items ?? [], {
      reason: 'transfer_return',
      signo: 1,
      userId: userId ?? fila.creado_por,
      nota: (i) => `Envío a la 24 del ${diaDe(fila.created_at)} anulado: vuelve +${cant(i.cantidad, i.unidad)}`,
    })
    if (errores.length) await admin.from('envios_salientes').update({ ultimo_error: `Stock al anular: ${errores.join('; ')}`.slice(0, 500) }).eq('id', id)
  }
  void logAudit(admin, {
    userId,
    userName: await nombreDe(admin, userId),
    action: 'envio_24_anulado',
    module: 'cocina',
    entityType: 'envio_saliente',
    entityId: id,
    description: `Anuló el envío a la 24 del ${diaDe(fila.created_at)}${fila.stock_descontado_at ? ' (el stock volvió)' : ''}${errores.length ? ` · errores: ${errores.join('; ')}` : ''}`.slice(0, 1000),
  })
  return {
    ok: true,
    id,
    estado: 'anulado',
    mensaje: fila.stock_descontado_at ? 'Anulado: el stock volvió' : 'Anulado',
    ...(errores.length ? { erroresStock: errores } : {}),
  }
}

// ---- ¿Llegó? -------------------------------------------------------------------

/** Le pregunta a la 24 por un envío en camino y guarda lo que haya. */
export async function consultarEnvio(admin: SupabaseClient, id: string): Promise<{ estado: EstadoEnvio | null; respondio: boolean; faltantes?: string[] }> {
  const r = await llamar24('GET', `/${encodeURIComponent(id)}`)
  if (r.status === 200 && r.body) {
    const e24 = r.body as unknown as Estado24
    if (e24.estado === 'recibido') return { ...(await guardarRecepcion(admin, id, e24)), respondio: true }
    if (e24.estado === 'anulado') {
      // Solo Santa Fe anula: si allá figura anulado y acá no, se cortó a la mitad
      const res = await anularAca(admin, id, null)
      return { estado: res.ok ? 'anulado' : res.estado ?? null, respondio: true }
    }
    return { estado: 'en_camino', respondio: true }
  }
  if (r.status === 404) {
    await admin.from('envios_salientes').update({ ultimo_error: 'La 24 no tiene este envío (si no va a llegar, anulalo para que vuelva el stock)' }).eq('id', id).eq('estado', 'en_camino')
    return { estado: 'en_camino', respondio: true }
  }
  return { estado: null, respondio: !reintentable(r.status) }
}

async function guardarRecepcion(admin: SupabaseClient, id: string, e24: Estado24): Promise<{ estado: EstadoEnvio | null; faltantes?: string[] }> {
  const items24 = Array.isArray(e24.items) ? e24.items : []
  // La 24 marca «recibido» y enseguida guarda lo que llegó de cada cosa: si
  // todavía no está todo, se espera al próximo pulso (salvo que ya pasó un rato)
  const haceMs = Date.now() - Date.parse(e24.recibido_at ?? '')
  if (items24.some((i) => i.cantidad_recibida == null) && Number.isFinite(haceMs) && haceMs < 3 * 60_000) {
    return { estado: 'en_camino' }
  }

  const leido = await leerEnvio(admin, id)
  if (!leido) return { estado: null }
  if (leido.envio.estado !== 'en_camino') return { estado: leido.envio.estado }

  const porId = new Map(items24.map((i) => [String(i.item_id), i]))
  const items: FilaItem[] = []
  for (const i of leido.items) {
    const llego = porId.get(itemIdPara24(i))
    const fila: FilaItem = llego
      ? {
        ...i,
        cantidad_recibida: llego.cantidad_recibida == null ? null : Number(llego.cantidad_recibida),
        unidad_recibida: llego.unidad_recibida ?? null,
        producto_24: llego.producto_24 ?? null,
      }
      : i
    if (llego) {
      await admin.from('envios_salientes_items')
        .update({ cantidad_recibida: fila.cantidad_recibida, unidad_recibida: fila.unidad_recibida, producto_24: fila.producto_24 })
        .eq('id', i.id)
    }
    items.push(fila)
  }

  // Lo toma uno solo: el aviso de faltantes sale una vez
  const { data: tomado } = await admin.from('envios_salientes')
    .update({
      estado: 'recibido',
      recibido_at: e24.recibido_at ?? ahora(),
      recibido_por: e24.recibido_por ? String(e24.recibido_por).slice(0, 200) : null,
      nota_recepcion: e24.nota_recepcion ? String(e24.nota_recepcion).slice(0, 1000) : null,
      ultimo_error: null,
    })
    .eq('id', id).eq('estado', 'en_camino').select('id, created_at')
  if (!tomado?.length) return { estado: 'recibido' }

  const faltantes = faltantesDe(items)
  const dia = diaDe((tomado[0] as { created_at: string }).created_at)
  void logAudit(admin, {
    userId: null,
    userName: 'La 24',
    action: 'envio_24_recibido',
    module: 'cocina',
    entityType: 'envio_saliente',
    entityId: id,
    description: `La 24 recibió el envío del ${dia}${e24.recibido_por ? ` (${e24.recibido_por})` : ''}${faltantes.length ? ` con faltantes: ${faltantes.join('; ')}` : ' completo'}`.slice(0, 1000),
    metadata: { faltantes, nota_recepcion: e24.nota_recepcion ?? null },
  })
  if (faltantes.length) {
    await notifyEvent(admin, 'envio_24_faltantes', {
      title: '🚚 La 24 recibió con faltantes',
      body: `La 24 recibió con faltantes el envío del ${dia}: ${faltantes.join('; ')}${e24.nota_recepcion ? ` — «${e24.nota_recepcion}»` : ''}`.slice(0, 600),
      url: '/cocina/envios',
    }).catch(() => {})
  }
  return { estado: 'recibido', faltantes }
}

// ---- Pulso ----------------------------------------------------------------------

/**
 * Paso del pulso (cada 10 min): manda lo pendiente, termina de bajar el stock
 * de lo que se cortó a la mitad y le pregunta a la 24 por lo que está en
 * camino. Si la 24 no responde, corta y sigue en el próximo pulso.
 */
export async function procesarEnvios(admin: SupabaseClient, opciones?: { hastaMs?: number }) {
  if (faltaConfigurar()) return 'sin configurar (ENVIOS_CLAVE)'
  const limite = Date.now() + (opciones?.hastaMs ?? 35_000)
  const out = { enviados: 0, siguen_pendientes: 0, rechazados: 0, stock_completado: 0, recibidos: 0, con_faltantes: 0, la_24_no_responde: false }

  const { data: pendientes } = await admin.from('envios_salientes').select('id').eq('estado', 'pendiente_envio').order('created_at').limit(10)
  for (const { id } of (pendientes ?? []) as { id: string }[]) {
    if (Date.now() > limite) break
    const r = await mandarEnvio(admin, id)
    if (r.ok && r.estado === 'en_camino') out.enviados++
    else if (r.ok && r.estado === 'pendiente_envio') { out.siguen_pendientes++; out.la_24_no_responde = true; break }
    else if (!r.ok && r.estado === 'anulado') out.rechazados++
  }

  // Aceptados por la 24 a los que no se les llegó a bajar el stock
  const { data: sinDescontar } = await admin.from('envios_salientes').select('id')
    .in('estado', ['en_camino', 'recibido']).is('stock_descontado_at', null).order('created_at').limit(10)
  for (const { id } of (sinDescontar ?? []) as { id: string }[]) {
    if (Date.now() > limite) break
    if ((await descontarStock(admin, id)).hecho) out.stock_completado++
  }

  if (!out.la_24_no_responde) {
    const r = await consultarEnCamino(admin, { hastaMs: Math.max(0, limite - Date.now()), limite: 20 })
    out.recibidos = r.recibidos
    out.con_faltantes = r.con_faltantes
    out.la_24_no_responde = r.la_24_no_responde
  }
  return out
}

/** Le pregunta a la 24 por los envíos en camino (los más viejos primero). */
export async function consultarEnCamino(admin: SupabaseClient, p: { hastaMs: number; limite: number }) {
  const out = { consultados: 0, recibidos: 0, con_faltantes: 0, la_24_no_responde: false }
  if (faltaConfigurar()) return out
  const limite = Date.now() + p.hastaMs
  const { data: enCamino } = await admin.from('envios_salientes').select('id').eq('estado', 'en_camino').order('created_at').limit(p.limite)
  for (const { id } of (enCamino ?? []) as { id: string }[]) {
    if (Date.now() > limite) break
    const r = await consultarEnvio(admin, id)
    out.consultados++
    if (!r.respondio) { out.la_24_no_responde = true; break }
    if (r.estado === 'recibido' && r.faltantes) {
      out.recibidos++
      if (r.faltantes.length) out.con_faltantes++
    }
  }
  return out
}

/** Para Hoy: cuántos están en camino y cuántos no se pudieron mandar todavía */
export async function resumenEnvios(admin: SupabaseClient): Promise<{ en_camino: number; pendientes: number }> {
  const { data } = await admin.from('envios_salientes').select('estado').in('estado', ['pendiente_envio', 'en_camino'])
  const filas = (data ?? []) as { estado: string }[]
  return {
    en_camino: filas.filter((f) => f.estado === 'en_camino').length,
    pendientes: filas.filter((f) => f.estado === 'pendiente_envio').length,
  }
}

// ---- Prueba de conexión ----------------------------------------------------------

/**
 * Prueba la conexión con la 24 SIN tocar nada de Santa Fe (ni envíos ni
 * stock): manda un envío de prueba con "avisar": false, lo consulta y lo
 * anula. En la 24 queda un envío anulado de prueba.
 */
export async function probarConexion(): Promise<{ ok: boolean; pasos: { paso: string; ok: boolean; detalle: string }[] }> {
  const pasos: { paso: string; ok: boolean; detalle: string }[] = []
  const falta = faltaConfigurar()
  if (falta) return { ok: false, pasos: [{ paso: 'Configuración', ok: false, detalle: falta }] }

  const envioId = `prueba-${crypto.randomUUID()}`
  const post = await llamar24('POST', '', {
    envio_id: envioId,
    enviado_at: ahora(),
    enviado_por: 'Prueba de conexión',
    nota: 'Prueba de conexión desde Santa Fe: se anula sola, no hay que recibirla',
    avisar: false,
    items: [{ item_id: 'prueba-conexion', nombre: 'Prueba de conexión (no recibir)', unidad: 'unidad', cantidad: 1, costo_unitario: null }],
  })
  const aceptado = post.status === 201 || post.status === 200
  pasos.push({ paso: 'Mandar', ok: aceptado, detalle: aceptado ? `La 24 lo aceptó (${post.status})` : post.error ?? `Respondió ${post.status}` })
  if (!aceptado) return { ok: false, pasos }

  const get = await llamar24('GET', `/${encodeURIComponent(envioId)}`)
  const estado = typeof get.body?.estado === 'string' ? get.body.estado : null
  pasos.push({ paso: 'Consultar', ok: get.status === 200 && estado === 'en_camino', detalle: get.status === 200 ? `Figura ${estado ?? 'sin estado'}` : get.error ?? `Respondió ${get.status}` })

  const del = await llamar24('DELETE', `/${encodeURIComponent(envioId)}`)
  pasos.push({ paso: 'Anular', ok: del.status === 200, detalle: del.status === 200 ? 'Anulado en la 24' : del.error ?? `Respondió ${del.status}` })

  return { ok: pasos.every((p) => p.ok), pasos }
}

// ---- Lo que ve Santa Fe -------------------------------------------------------------

export type EnvioVista = {
  id: string
  estado: EstadoEnvio
  created_at: string
  enviado_por: string | null
  nota: string | null
  enviado_at: string | null
  stock_descontado: boolean
  recibido_at: string | null
  recibido_por: string | null
  nota_recepcion: string | null
  anulado_at: string | null
  ultimo_error: string | null
  faltantes: string[]
  items: {
    id: string
    stock_item_id: string | null
    nombre: string
    unidad: string
    cantidad: number
    cantidad_recibida: number | null
    unidad_recibida: string | null
    /** lo que llegó pasado a la unidad de Santa Fe (null si no se puede) */
    recibida_aca: number | null
    producto_24: string | null
  }[]
}

export async function listarEnvios(admin: SupabaseClient, opciones?: { dias?: number; limite?: number }): Promise<EnvioVista[]> {
  const desde = new Date(Date.now() - (opciones?.dias ?? 30) * 86_400_000).toISOString()
  const { data: envios } = await admin.from('envios_salientes').select('*')
    .gte('created_at', desde).order('created_at', { ascending: false }).limit(opciones?.limite ?? 40)
  const filas = (envios ?? []) as FilaEnvio[]
  if (filas.length === 0) return []

  const [{ data: items }, { data: perfiles }] = await Promise.all([
    admin.from('envios_salientes_items').select('*').in('envio_id', filas.map((e) => e.id)).order('created_at'),
    admin.from('profiles').select('id, first_name, last_name').in('id', [...new Set(filas.map((e) => e.creado_por).filter((x): x is string => !!x))]),
  ])
  const nombre = new Map(((perfiles ?? []) as { id: string; first_name: string | null; last_name: string | null }[])
    .map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null]))
  const porEnvio = new Map<string, FilaItem[]>()
  for (const i of (items ?? []) as FilaItem[]) {
    const lista = porEnvio.get(i.envio_id) ?? []
    lista.push({ ...i, cantidad: Number(i.cantidad), cantidad_recibida: i.cantidad_recibida == null ? null : Number(i.cantidad_recibida) })
    porEnvio.set(i.envio_id, lista)
  }

  return filas.map((e) => {
    const its = porEnvio.get(e.id) ?? []
    return {
      id: e.id,
      estado: e.estado,
      created_at: e.created_at,
      enviado_por: e.creado_por ? nombre.get(e.creado_por) ?? null : null,
      nota: e.nota,
      enviado_at: e.enviado_at,
      stock_descontado: Boolean(e.stock_descontado_at),
      recibido_at: e.recibido_at,
      recibido_por: e.recibido_por,
      nota_recepcion: e.nota_recepcion,
      anulado_at: e.anulado_at,
      ultimo_error: e.ultimo_error,
      faltantes: e.estado === 'recibido' ? faltantesDe(its) : [],
      items: its.map((i) => ({
        id: i.id,
        stock_item_id: i.stock_item_id,
        nombre: i.nombre,
        unidad: i.unidad,
        cantidad: i.cantidad,
        cantidad_recibida: i.cantidad_recibida,
        unidad_recibida: i.unidad_recibida,
        recibida_aca: i.cantidad_recibida != null && i.unidad_recibida ? convertQty(i.cantidad_recibida, i.unidad_recibida, i.unidad) : null,
        producto_24: i.producto_24,
      })),
    }
  })
}

export type InsumoEnviable = { id: string; name: string; unit: string; current_qty: number; elaborado: boolean; en_fudo: boolean }

/** Insumos activos para el buscador: elaborados (o proveedor "Cocina LVE") primero */
export async function insumosEnviables(admin: SupabaseClient): Promise<InsumoEnviable[]> {
  const [{ data: items }, { data: cocina }] = await Promise.all([
    admin.from('stock_items').select('id, name, unit, current_qty, is_produced, supplier_id, fudo_ingredient_id, fudo_product_id, fudo_skip').eq('is_active', true).order('name'),
    admin.from('suppliers').select('id').ilike('name', 'cocina lve'),
  ])
  const deCocina = new Set(((cocina ?? []) as { id: string }[]).map((s) => s.id))
  type Fila = { id: string; name: string; unit: string; current_qty: number; is_produced: boolean | null; supplier_id: string | null; fudo_ingredient_id: string | null; fudo_product_id: string | null; fudo_skip: boolean | null }
  return ((items ?? []) as Fila[])
    .map((s) => ({
      id: s.id,
      name: s.name,
      unit: s.unit,
      current_qty: Number(s.current_qty ?? 0),
      elaborado: Boolean(s.is_produced) || (!!s.supplier_id && deCocina.has(s.supplier_id)),
      en_fudo: Boolean(s.fudo_ingredient_id || s.fudo_product_id || s.fudo_skip),
    }))
    .sort((a, b) => Number(b.elaborado) - Number(a.elaborado) || a.name.localeCompare(b.name, 'es'))
}
