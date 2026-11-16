import type { SupabaseClient } from '@supabase/supabase-js'
import { faltaConfigurar } from '@/lib/envios/conexion-24'
import { leerLista, stockDeLa24, type ConteoCierre24, type Linea24, type ProductoLista } from '@/lib/produccion/lista'

// ---------------------------------------------------------------------------
// «Qué producir» del encargado de producción (sistema de producción, punto 3)
// ---------------------------------------------------------------------------
// Para cada producto de la lista de producción:
//   falta en Santa Fe = mínimo de Santa Fe − stock de Santa Fe
//   falta en la 24    = lo que dice la 24 (mínimo − su stock − en camino)
//   producir          = falta en Santa Fe + falta en la 24 − lo ya cargado con
//                       «Lo hice» que todavía no se confirmó
// El stock de Santa Fe ya es el estimado que pidieron: Fudo descuenta las
// ventas sobre el último conteo. Si da negativo (producción sin cargar) se
// toma como 0 y se avisa que falta contarlo. Lo que está completo no aparece.
// ---------------------------------------------------------------------------

export const ROLES_A_PRODUCIR = ['socio', 'encargado', 'chef', 'cocina'] as const

/** Producción cargada y sin confirmar de estos días (la misma ventana que confirma la jefa) */
const DIAS_EN_ESPERA = 3

export type Estado24 = 'ok' | 'no_va' | 'sin_minimo' | 'no_vinculado' | 'otra_unidad' | 'sin_dato' | 'sin_conexion'

export type ItemAProducir = {
  stock_item_id: string
  nombre: string
  unidad: string
  stock_sf: number
  /** la app da negativo: falta contarlo (se toma como 0) */
  stock_negativo: boolean
  contado_at: string | null
  minimo_sf: number
  falta_sf: number
  va_a_la_24: boolean
  minimo_24: number | null
  stock_24: number | null
  en_camino_24: number
  falta_24: number
  estado_24: Estado24
  /** cargado con «Lo hice» y todavía sin confirmar */
  en_espera: number
  producir: number
}

export type AProducir = {
  generado_at: string
  falta_migracion: boolean
  items: ItemAProducir[]
  completos: { stock_item_id: string; nombre: string }[]
  /** sin mínimo cargado (ni acá ni en la 24): no se puede saber cuánto falta */
  sin_minimo: { stock_item_id: string; nombre: string }[]
  la_24: { ok: true; conteo_cierre: ConteoCierre24 } | { ok: false; error: string } | null
}

/** Para arriba: en unidades enteras; en kg o litros, de a 0,1 */
function redondearArriba(n: number, unidad: string): number {
  if (n <= 0) return 0
  if (/^(unidad|u|un)$/i.test(unidad.trim())) return Math.ceil(n - 1e-9)
  return Math.ceil(n * 10 - 1e-9) / 10
}

/**
 * Un producto: cuánto falta acá, cuánto en la 24 y cuánto producir.
 * linea24: undefined = no se pudo hablar con la 24; null = la 24 no lo tiene.
 */
export function calcularItem(
  p: Pick<ProductoLista, 'stock_item_id' | 'nombre' | 'unidad' | 'stock' | 'contado_at' | 'minimo_sf' | 'va_a_la_24' | 'minimo_24'>,
  linea24: Linea24 | null | undefined,
  enEspera: number,
): ItemAProducir {
  const base = Math.max(0, p.stock)
  const faltaSf = p.minimo_sf > 0 ? Math.max(0, p.minimo_sf - base) : 0

  let estado24: Estado24 = 'no_va'
  let falta24 = 0
  let stock24: number | null = null
  let camino24 = 0
  if (p.va_a_la_24) {
    if (linea24 === undefined) estado24 = 'sin_conexion'
    else if (linea24 === null) estado24 = 'sin_dato'
    else {
      stock24 = linea24.stock
      camino24 = linea24.en_camino
      if (!linea24.vinculado) estado24 = 'no_vinculado'
      else if (linea24.unidad_compatible === false) estado24 = 'otra_unidad'
      else if (p.minimo_24 == null) estado24 = 'sin_minimo'
      else if (linea24.falta == null) estado24 = 'sin_dato'
      else { estado24 = 'ok'; falta24 = linea24.falta }
    }
  }

  return {
    stock_item_id: p.stock_item_id,
    nombre: p.nombre,
    unidad: p.unidad,
    stock_sf: p.stock,
    stock_negativo: p.stock < 0,
    contado_at: p.contado_at,
    minimo_sf: p.minimo_sf,
    falta_sf: faltaSf,
    va_a_la_24: p.va_a_la_24,
    minimo_24: p.minimo_24,
    stock_24: stock24,
    en_camino_24: camino24,
    falta_24: falta24,
    estado_24: estado24,
    en_espera: enEspera,
    producir: redondearArriba(faltaSf + falta24 - enEspera, p.unidad),
  }
}

export async function calcularAProducir(admin: SupabaseClient): Promise<AProducir> {
  const desde = new Date(Date.now() - DIAS_EN_ESPERA * 86_400_000).toISOString()
  const [lista, la24, { data: enEsperaRows }] = await Promise.all([
    leerLista(admin),
    faltaConfigurar() ? Promise.resolve(null) : stockDeLa24(),
    admin.from('production_outputs')
      .select('stock_item_id, qty_produced, is_waste, production_orders!inner(status, created_at)')
      .eq('production_orders.status', 'pending_review')
      .gte('production_orders.created_at', desde),
  ])

  const enEspera = new Map<string, number>()
  for (const r of (enEsperaRows ?? []) as unknown as { stock_item_id: string | null; qty_produced: number; is_waste: boolean | null }[]) {
    if (!r.stock_item_id || r.is_waste) continue
    enEspera.set(r.stock_item_id, (enEspera.get(r.stock_item_id) ?? 0) + Number(r.qty_produced))
  }

  const items: ItemAProducir[] = []
  const completos: AProducir['completos'] = []
  const sinMinimo: AProducir['sin_minimo'] = []
  for (const p of lista.productos.filter((x) => x.activo)) {
    const linea = la24?.ok ? (la24.productos[p.stock_item_id] ?? null) : undefined
    const item = calcularItem(p, linea, enEspera.get(p.stock_item_id) ?? 0)
    if (item.producir > 0) items.push(item)
    else if (p.minimo_sf <= 0 && item.estado_24 !== 'ok') sinMinimo.push({ stock_item_id: p.stock_item_id, nombre: p.nombre })
    else completos.push({ stock_item_id: p.stock_item_id, nombre: p.nombre })
  }

  // Lo que más falta (en proporción a su mínimo) primero
  const peso = (i: ItemAProducir) => i.producir / Math.max(1, i.minimo_sf + (i.minimo_24 ?? 0))
  items.sort((a, b) => peso(b) - peso(a) || a.nombre.localeCompare(b.nombre, 'es'))

  return {
    generado_at: new Date().toISOString(),
    falta_migracion: lista.falta_migracion,
    items,
    completos,
    sin_minimo: sinMinimo,
    la_24: la24 ? (la24.ok ? { ok: true, conteo_cierre: la24.conteo_cierre } : { ok: false, error: la24.error }) : null,
  }
}
