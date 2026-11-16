import type { SupabaseClient } from '@supabase/supabase-js'
import { faltaConfigurar, pedirA24, reintentable } from '@/lib/envios/conexion-24'
import { convertQty } from '@/lib/produccion/units'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Lista de producción con mínimos (sistema de producción, punto 1)
// ---------------------------------------------------------------------------
// Qué produce la cocina de Santa Fe y cuánto tiene que haber como mínimo de
// cada cosa, por separado en Santa Fe y en la 24.
//   · Mínimo de Santa Fe = stock_items.min_qty (el que ya usa toda la app).
//   · Mínimo de la 24 y si va a la 24 = produccion_lista.
// A la 24 se le manda su parte con PUT /api/envios/catalogo, que reemplaza la
// lista entera allá: lo que no se manda, la 24 deja de contarlo al cierre.
// Si la 24 no responde, queda marcado y el pulso lo reintenta.
// El stock de la 24 (para ver qué falta allá) sale de GET /api/envios/stock.
// ---------------------------------------------------------------------------

export const ROLES_VEN_LISTA = ['socio', 'encargado', 'chef', 'cocina'] as const
/** La lista y los mínimos los cambian socios… */
export const ROLES_EDITAN_LISTA = ['socio'] as const
/**
 * …y solo los que dijo el pedido (16/11): Marco y Joaquín. Se puede cambiar
 * sin tocar código con app_settings 'produccion_lista_editores' =
 * { "user_ids": [...] }.
 */
const EDITORES_POR_DEFECTO = [
  'b8f689ca-85ae-4120-8a02-521e378e8585', // Marco Rossi
  '66c1aab8-5f89-434e-8a38-0e8abdbd4848', // Joaquín González
]

export async function editoresLista(admin: SupabaseClient): Promise<{ ids: string[]; nombres: string[] }> {
  const { data } = await admin.from('app_settings').select('value').eq('key', 'produccion_lista_editores').maybeSingle()
  const guardados = (data as { value: { user_ids?: unknown } } | null)?.value?.user_ids
  const ids = Array.isArray(guardados) && guardados.length ? guardados.map(String) : EDITORES_POR_DEFECTO
  const { data: perfiles } = await admin.from('profiles').select('id, first_name').in('id', ids).eq('is_active', true)
  return { ids, nombres: ((perfiles ?? []) as { first_name: string | null }[]).map((p) => p.first_name ?? '').filter(Boolean) }
}

const MAX_LISTA = 300
const MAX_A_LA_24 = 200
const CLAVE_ESTADO = 'catalogo_24'

const r3 = (n: number) => Math.round(n * 1000) / 1000

export type ProductoLista = {
  stock_item_id: string
  nombre: string
  unidad: string
  stock: number
  minimo_sf: number
  va_a_la_24: boolean
  minimo_24: number | null
  en_fudo: boolean
  activo: boolean
  /** último conteo físico (stock_items.last_counted_at) */
  contado_at: string | null
}

export type Resultado24 = {
  item_id: string
  nombre: string
  vinculado: boolean
  producto_24: string | null
  unidad_24: string | null
  unidad_compatible: boolean | null
}

/** Cómo quedó la lista en la 24 (app_settings.catalogo_24) */
export type EstadoCatalogo24 = {
  cambiado_at: string | null
  enviado_at: string | null
  ultimo_error: string | null
  /** el último error fue de la 24 diciendo que no (4xx): no se reintenta solo */
  rechazado: boolean
  resultado: Resultado24[] | null
  desactivados: number | null
}

const ESTADO_VACIO: EstadoCatalogo24 = { cambiado_at: null, enviado_at: null, ultimo_error: null, rechazado: false, resultado: null, desactivados: null }

// ---- Leer -----------------------------------------------------------------

type FilaLista = {
  stock_item_id: string
  va_a_la_24: boolean
  minimo_24: number | null
  orden: number
  stock_items: {
    name: string
    unit: string
    current_qty: number
    min_qty: number | null
    is_active: boolean | null
    fudo_ingredient_id: string | null
    fudo_product_id: string | null
    fudo_skip: boolean | null
    last_counted_at: string | null
  } | null
}

export async function leerLista(admin: SupabaseClient): Promise<{ productos: ProductoLista[]; falta_migracion: boolean }> {
  const { data, error } = await admin.from('produccion_lista')
    .select('stock_item_id, va_a_la_24, minimo_24, orden, stock_items(name, unit, current_qty, min_qty, is_active, fudo_ingredient_id, fudo_product_id, fudo_skip, last_counted_at)')
    .order('orden')
  if (error) {
    // Tabla todavía no creada (migración 20261116 sin correr)
    if (/produccion_lista/.test(error.message) && /(does not exist|schema cache|not find)/i.test(error.message)) return { productos: [], falta_migracion: true }
    throw new Error(error.message)
  }
  const productos = ((data ?? []) as unknown as FilaLista[])
    .filter((f) => f.stock_items)
    .map((f) => {
      const s = f.stock_items!
      return {
        stock_item_id: f.stock_item_id,
        nombre: s.name,
        unidad: s.unit,
        stock: Number(s.current_qty ?? 0),
        minimo_sf: Number(s.min_qty ?? 0),
        va_a_la_24: Boolean(f.va_a_la_24),
        minimo_24: f.minimo_24 == null ? null : Number(f.minimo_24),
        en_fudo: Boolean(s.fudo_ingredient_id || s.fudo_product_id || s.fudo_skip),
        activo: s.is_active !== false,
        contado_at: s.last_counted_at ?? null,
      }
    })
  return { productos, falta_migracion: false }
}

export async function leerEstado24(admin: SupabaseClient): Promise<EstadoCatalogo24> {
  const { data } = await admin.from('app_settings').select('value').eq('key', CLAVE_ESTADO).maybeSingle()
  return { ...ESTADO_VACIO, ...((data as { value: Partial<EstadoCatalogo24> } | null)?.value ?? {}) }
}

async function guardarEstado24(admin: SupabaseClient, cambios: Partial<EstadoCatalogo24>, userId?: string | null) {
  const actual = await leerEstado24(admin)
  await admin.from('app_settings').upsert({ key: CLAVE_ESTADO, value: { ...actual, ...cambios }, updated_by: userId ?? null, updated_at: new Date().toISOString() })
}

// ---- Guardar ----------------------------------------------------------------

export type EntradaLista = { stock_item_id: string; minimo_sf: number | null; va_a_la_24: boolean; minimo_24: number | null }

export type ResultadoGuardar =
  | { ok: true; productos: number; minimos_sf_cambiados: number; la_24: ResultadoCatalogo | null }
  | { ok: false; status: number; error: string }

const numeroValido = (n: unknown) => n == null || (typeof n === 'number' && Number.isFinite(n) && n >= 0)

/**
 * Guarda la lista entera (lo que no viene se saca) y los mínimos de Santa Fe.
 * Si cambió la parte de la 24, se la manda en el momento.
 */
export async function guardarLista(admin: SupabaseClient, userId: string, entrada: EntradaLista[]): Promise<ResultadoGuardar> {
  if (!Array.isArray(entrada)) return { ok: false, status: 400, error: 'Falta la lista de productos' }
  if (entrada.length > MAX_LISTA) return { ok: false, status: 400, error: `Como mucho ${MAX_LISTA} productos` }
  const ids = entrada.map((e) => String(e?.stock_item_id ?? ''))
  if (ids.some((id) => !id)) return { ok: false, status: 400, error: 'Hay un renglón sin producto' }
  if (new Set(ids).size !== ids.length) return { ok: false, status: 400, error: 'Hay un producto repetido en la lista' }
  if (entrada.filter((e) => e.va_a_la_24).length > MAX_A_LA_24) return { ok: false, status: 400, error: `A la 24 se le pueden mandar como mucho ${MAX_A_LA_24} productos` }

  const { data: items, error: errItems } = ids.length
    ? await admin.from('stock_items').select('id, name, unit, min_qty, is_active').in('id', ids)
    : { data: [], error: null }
  if (errItems) return { ok: false, status: 500, error: errItems.message }
  const insumo = new Map(((items ?? []) as { id: string; name: string; unit: string; min_qty: number | null; is_active: boolean | null }[]).map((s) => [s.id, s]))

  for (const e of entrada) {
    const s = insumo.get(e.stock_item_id)
    if (!s) return { ok: false, status: 400, error: 'Un producto de la lista ya no existe: recargá la pantalla' }
    if (!numeroValido(e.minimo_sf)) return { ok: false, status: 400, error: `${s.name}: el mínimo de Santa Fe no es válido` }
    if (!numeroValido(e.minimo_24)) return { ok: false, status: 400, error: `${s.name}: el mínimo de la 24 no es válido` }
  }

  const antes = await leerLista(admin)
  if (antes.falta_migracion) return { ok: false, status: 503, error: 'Falta correr la migración de la lista de producción (20261116_produccion_lista.sql)' }
  const previo = new Map(antes.productos.map((p) => [p.stock_item_id, p]))

  const ahora = new Date().toISOString()
  if (entrada.length) {
    const { error } = await admin.from('produccion_lista').upsert(
      entrada.map((e, i) => ({
        stock_item_id: e.stock_item_id,
        va_a_la_24: Boolean(e.va_a_la_24),
        minimo_24: e.minimo_24 == null ? null : r3(e.minimo_24),
        orden: i,
        updated_at: ahora,
        updated_by: userId,
      })),
      { onConflict: 'stock_item_id' },
    )
    if (error) return { ok: false, status: 500, error: error.message }
  }
  const quitados = antes.productos.map((p) => p.stock_item_id).filter((id) => !ids.includes(id))
  if (quitados.length) {
    const { error } = await admin.from('produccion_lista').delete().in('stock_item_id', quitados)
    if (error) return { ok: false, status: 500, error: error.message }
  }

  // Mínimo de Santa Fe: el min_qty de siempre (vacío = sin mínimo = 0)
  let minimosCambiados = 0
  for (const e of entrada) {
    const s = insumo.get(e.stock_item_id)!
    const nuevo = e.minimo_sf == null ? 0 : r3(e.minimo_sf)
    if (Number(s.min_qty ?? 0) !== nuevo) {
      const { error } = await admin.from('stock_items').update({ min_qty: nuevo, updated_at: ahora }).eq('id', s.id)
      if (error) return { ok: false, status: 500, error: `${s.name}: ${error.message}` }
      minimosCambiados++
    }
  }

  // ¿Cambió lo que tiene que saber la 24?
  const parte24 = (p: { stock_item_id: string; va_a_la_24: boolean; minimo_24: number | null }) => (p.va_a_la_24 ? `${p.stock_item_id}:${p.minimo_24 ?? ''}` : '')
  const antes24 = antes.productos.map(parte24).filter(Boolean).sort().join('|')
  const ahora24 = entrada.map((e) => parte24({ ...e, minimo_24: e.minimo_24 == null ? null : r3(e.minimo_24) })).filter(Boolean).sort().join('|')
  const estado = await leerEstado24(admin)
  let la24: ResultadoCatalogo | null = null
  if (antes24 !== ahora24 || !estado.enviado_at) {
    await guardarEstado24(admin, { cambiado_at: ahora }, userId)
    la24 = await mandarCatalogo24(admin, userId)
  }

  const nombre = await nombreDe(admin, userId)
  void logAudit(admin, {
    userId,
    userName: nombre,
    action: 'produccion_lista_guardada',
    module: 'produccion',
    entityType: 'produccion_lista',
    description: `Lista de producción: ${entrada.length} productos (${entrada.filter((e) => e.va_a_la_24).length} van a la 24)${quitados.length ? `, sacó ${quitados.length}` : ''}${minimosCambiados ? `, cambió ${minimosCambiados} mínimos de Santa Fe` : ''}`,
    metadata: { productos: entrada, quitados, previo: Object.fromEntries([...previo].map(([k, v]) => [k, { minimo_sf: v.minimo_sf, va_a_la_24: v.va_a_la_24, minimo_24: v.minimo_24 }])) },
  })

  return { ok: true, productos: entrada.length, minimos_sf_cambiados: minimosCambiados, la_24: la24 }
}

async function nombreDe(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('first_name, last_name').eq('id', userId).maybeSingle()
  const p = data as { first_name: string | null; last_name: string | null } | null
  return p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null : null
}

// ---- A la 24 -------------------------------------------------------------------

export type ResultadoCatalogo =
  | { ok: true; productos: Resultado24[]; desactivados: number; sin_vincular: number; unidad_incompatible: number }
  | { ok: false; error: string; reintenta: boolean }

/** Le manda a la 24 su parte de la lista (la reemplaza entera allá). */
export async function mandarCatalogo24(admin: SupabaseClient, userId?: string | null): Promise<ResultadoCatalogo> {
  const falta = faltaConfigurar()
  if (falta) {
    await guardarEstado24(admin, { ultimo_error: falta, rechazado: false }, userId)
    return { ok: false, error: falta, reintenta: false }
  }
  // Se toma la hora ANTES de leer: si alguien cambia algo mientras tanto,
  // queda cambiado_at > enviado_at y el pulso lo vuelve a mandar
  const inicio = new Date().toISOString()
  const { productos, falta_migracion } = await leerLista(admin)
  if (falta_migracion) return { ok: false, error: 'Falta correr la migración de la lista de producción', reintenta: false }

  const payload = productos
    .filter((p) => p.va_a_la_24 && p.activo)
    .map((p) => ({ item_id: p.stock_item_id, nombre: p.nombre, unidad: p.unidad, minimo_24: p.minimo_24 }))
  const r = await pedirA24('PUT', '/catalogo', { productos: payload })

  if (r.status === 200 && r.body?.ok === true) {
    const resultado = (Array.isArray(r.body.productos) ? r.body.productos : []) as Resultado24[]
    const desactivados = Number(r.body.desactivados ?? 0)
    await guardarEstado24(admin, { enviado_at: inicio, ultimo_error: null, rechazado: false, resultado, desactivados }, userId)
    return {
      ok: true,
      productos: resultado,
      desactivados,
      sin_vincular: resultado.filter((p) => !p.vinculado).length,
      unidad_incompatible: resultado.filter((p) => p.unidad_compatible === false).length,
    }
  }
  const error = r.error ?? `La 24 respondió ${r.status}`
  const reintenta = reintentable(r.status)
  await guardarEstado24(admin, { ultimo_error: (reintenta ? error : `La 24 no aceptó la lista: ${error}`).slice(0, 500), rechazado: !reintenta }, userId)
  return { ok: false, error, reintenta }
}

/** Paso del pulso: si la lista cambió y la 24 todavía no la tiene, se la manda. */
export async function reintentarCatalogo24(admin: SupabaseClient): Promise<string | ResultadoCatalogo> {
  if (faltaConfigurar()) return 'sin configurar (ENVIOS_CLAVE)'
  const estado = await leerEstado24(admin)
  if (!estado.cambiado_at) return 'sin lista'
  if (estado.enviado_at && estado.enviado_at >= estado.cambiado_at) return 'al día'
  // Si la 24 la rechazó (dato inválido), no se insiste: hay que corregir la lista
  if (estado.rechazado) return 'rechazada por la 24: corregir la lista'
  return mandarCatalogo24(admin)
}

// ---- El stock de la 24 -----------------------------------------------------------

export type Linea24 = {
  vinculado: boolean
  producto_24: string | null
  unidad_24: string | null
  unidad_compatible: boolean | null
  /** en la unidad de Santa Fe; null si no se puede saber */
  stock: number | null
  en_camino: number
  falta: number | null
  contado_hoy: boolean
  contado_at: string | null
}

export type ConteoCierre24 = { hecho_hoy: boolean; ultimo: { quien: string | null; hora: string; productos: number } | null }

export type Stock24 =
  | { ok: true; generado_at: string; conteo_cierre: ConteoCierre24; productos: Record<string, Linea24> }
  | { ok: false; error: string }

type Producto24Raw = {
  item_id: string
  unidad: string
  stock: number | null
  en_camino: number | null
  falta: number | null
  contado_at: string | null
  contado_hoy: boolean
  producto_24: string | null
  unidad_24: string | null
}

/** GET /api/envios/stock: el stock de la 24 de cada producto de su lista */
export async function stockDeLa24(esperaMs = 6_000): Promise<Stock24> {
  const r = await pedirA24('GET', '/stock', undefined, esperaMs)
  if (r.status !== 200 || !r.body) return { ok: false, error: r.error ?? `La 24 respondió ${r.status}` }
  const b = r.body as { generado_at?: string; conteo_cierre?: ConteoCierre24; productos?: Producto24Raw[] }
  const productos: Record<string, Linea24> = {}
  for (const p of Array.isArray(b.productos) ? b.productos : []) {
    productos[String(p.item_id)] = {
      vinculado: Boolean(p.producto_24),
      producto_24: p.producto_24 ?? null,
      unidad_24: p.unidad_24 ?? null,
      unidad_compatible: p.unidad_24 ? convertQty(1, p.unidad, p.unidad_24) != null : null,
      stock: p.stock == null ? null : Number(p.stock),
      en_camino: Number(p.en_camino ?? 0),
      falta: p.falta == null ? null : Number(p.falta),
      contado_hoy: Boolean(p.contado_hoy),
      contado_at: p.contado_at ?? null,
    }
  }
  return {
    ok: true,
    generado_at: b.generado_at ?? new Date().toISOString(),
    conteo_cierre: b.conteo_cierre ?? { hecho_hoy: false, ultimo: null },
    productos,
  }
}
