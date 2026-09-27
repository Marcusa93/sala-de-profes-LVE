import type { SupabaseClient } from '@supabase/supabase-js'
import { canon, toStockUnitStrict } from '@/lib/recipes/recipe-cost'

// ---------------------------------------------------------------------------
// Conteo diario a partir del mensaje de WhatsApp del encargado
// ---------------------------------------------------------------------------
// "Bifes de pollo 48 porciones" → Pollo porcionado = 48.
// Cada renglón con un número es un conteo; sin número, es un comentario.
// El nombre se busca así:
//   1. un nombre ya confirmado antes (stock_count_aliases)
//   2. coincidencia segura: todas las palabras del renglón están en UN solo
//      elaborado (entendiendo plurales, "lve" = la vieja escuela, muzza…)
//   3. si hay varios posibles o ninguno: se pregunta, nunca se adivina.
// ---------------------------------------------------------------------------

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'a', 'al', 'p', 'para', 'x', 'en',
  'unidad', 'unidades', 'u', 'un', 'uds', 'ud', 'porcion', 'porciones', 'porc'])
const SINONIMO: Record<string, string> = {
  mozzarella: 'muzza', muzzarella: 'muzza', mozarella: 'muzza', mozza: 'muzza', muza: 'muzza',
  jyq: 'jq', jamon: 'jamon',
}
const UNIDAD = '(porciones?|porc\\.?|unidades?|unid\\.?|uds?\\.?|u\\.?|kg|kilos?|g|gr|grs|l|lts?|litros?)'
const RE_FIN = new RegExp(`^(.+?)\\s*[:=\\-–]?\\s*(\\d+(?:[.,]\\d+)?)\\s*${UNIDAD}?\\s*\\.?$`, 'i')
const RE_INICIO = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${UNIDAD}?\\s*(?:de\\s+)?(.+)$`, 'i')

function singular(t: string): string {
  if (t.length > 4 && t.endsWith('es') && /[nlrdz]$/.test(t.slice(0, -2))) return t.slice(0, -2)
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1)
  return t
}

export function tokensNombre(s: string): string[] {
  const n = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\blve\b/g, ' la vieja escuela ')
    .replace(/j\s*&\s*q|j\s*y\s*q/g, ' jq ')
    .replace(/[^a-z0-9 ]/g, ' ')
  return [...new Set(n.split(/\s+/)
    .filter((t) => t && !STOP.has(t) && !/^\d/.test(t))
    .map(singular)
    .map((t) => SINONIMO[t] ?? t))]
}

/** Clave con la que se recuerda un nombre (mismas palabras, sin orden) */
export function claveAlias(nombre: string): string {
  return tokensNombre(nombre).sort().join(' ')
}

type Item = { id: string; name: string; unit: string; current_qty: number; is_produced: boolean | null }

export type LineaConteo = {
  texto: string
  nombre: string
  alias: string
  qty: number | null
  unidad_texto: string | null
  item: { id: string; name: string; unit: string; current_qty: number } | null
  origen: 'recordado' | 'automatico' | 'dudoso' | 'sin_coincidencia' | 'ignorado' | 'comentario'
  candidatos: { id: string; name: string; unit: string; current_qty: number }[]
  problema: string | null
}

function parsearLinea(raw: string): { nombre: string; qty: number; unidad: string | null } | null {
  const t = raw.replace(/^[\s•*\-–·>]+/, '').trim()
  if (!t) return null
  let m = t.match(RE_FIN)
  if (m && /[a-z]/i.test(m[1])) return { nombre: m[1].trim(), qty: Number(m[2].replace(',', '.')), unidad: m[3] ?? null }
  m = t.match(RE_INICIO)
  if (m && /[a-z]/i.test(m[3])) return { nombre: m[3].trim(), qty: Number(m[1].replace(',', '.')), unidad: m[2] ?? null }
  return null
}

/** Cantidad del renglón expresada en la unidad del insumo (o problema si no se puede). */
function convertir(qty: number, unidad: string | null, item: Item): { qty: number | null; problema: string | null } {
  const u = (unidad ?? '').toLowerCase().replace('.', '')
  const esUnidad = !u || /^(porc|porcion|porciones|unid|unidad|unidades|u|ud|uds)$/.test(u)
  const itemUnidad = item.unit.toLowerCase().trim()
  const itemEsUnidad = /^(u|un|unid|unidad|unidades|porcion|porciones)$/.test(itemUnidad)
  if (esUnidad) {
    if (itemEsUnidad) return { qty, problema: null }
    return { qty: null, problema: `Se cuenta en ${item.unit}: escribí la cantidad en ${item.unit}` }
  }
  const unidadCanon = /^(kilo|kilos)$/.test(u) ? 'kg' : /^(gr|grs)$/.test(u) ? 'g' : /^(lt|lts|litro|litros)$/.test(u) ? 'l' : u
  const c = canon(qty, unidadCanon)
  const enItem = toStockUnitStrict(c.qty, c.unit, item.unit)
  if (enItem === null) return { qty: null, problema: `Dice ${unidad} pero se cuenta en ${item.unit}` }
  return { qty: Math.round(enItem * 1000) / 1000, problema: null }
}

export async function analizarConteo(admin: SupabaseClient, texto: string): Promise<LineaConteo[]> {
  const [{ data: items, error }, { data: aliases }] = await Promise.all([
    admin.from('stock_items').select('id, name, unit, current_qty, is_produced').eq('is_active', true),
    admin.from('stock_count_aliases').select('alias, stock_item_id'),
  ])
  if (error) throw new Error(error.message)
  const todos = (items ?? []) as Item[]
  const porId = new Map(todos.map((i) => [i.id, i]))
  const recordado = new Map((aliases ?? []).map((a: { alias: string; stock_item_id: string | null }) => [a.alias, a.stock_item_id]))
  const tokItem = new Map(todos.map((i) => [i.id, new Set(tokensNombre(i.name))]))

  const out: LineaConteo[] = []
  for (const raw of texto.split(/\r?\n/)) {
    const linea = raw.trim()
    if (!linea) continue
    const p = parsearLinea(linea)
    if (!p) {
      out.push({ texto: linea, nombre: linea, alias: '', qty: null, unidad_texto: null, item: null, origen: 'comentario', candidatos: [], problema: null })
      continue
    }
    const alias = claveAlias(p.nombre)
    const base: LineaConteo = { texto: linea, nombre: p.nombre, alias, qty: p.qty, unidad_texto: p.unidad, item: null, origen: 'sin_coincidencia', candidatos: [], problema: null }

    let elegido: Item | null = null
    if (recordado.has(alias)) {
      const id = recordado.get(alias)
      if (id === null) { out.push({ ...base, origen: 'ignorado' }); continue }
      elegido = porId.get(id!) ?? null
      if (elegido) base.origen = 'recordado'
    }

    if (!elegido) {
      const q = tokensNombre(p.nombre)
      const contiene = (i: Item) => q.length > 0 && q.every((t) => tokItem.get(i.id)!.has(t))
      const producidos = todos.filter((i) => i.is_produced && contiene(i))
      const pool = producidos.length > 0 ? producidos : todos.filter(contiene)
      // exacto (mismas palabras) gana; si no, único que las contiene
      const exactos = pool.filter((i) => tokItem.get(i.id)!.size === q.length)
      if (exactos.length === 1) elegido = exactos[0]
      else if (pool.length === 1) elegido = pool[0]
      if (elegido) base.origen = 'automatico'
      else {
        // candidatos: los que contienen todas las palabras, o comparten alguna
        const parecidos = pool.length > 0 ? pool : todos
          .map((i) => ({ i, n: q.filter((t) => tokItem.get(i.id)!.has(t)).length }))
          .filter((x) => x.n > 0)
          .sort((a, b) => Number(b.i.is_produced) - Number(a.i.is_produced) || b.n - a.n)
          .map((x) => x.i)
        base.candidatos = parecidos.slice(0, 5).map((i) => ({ id: i.id, name: i.name, unit: i.unit, current_qty: Number(i.current_qty) }))
        base.origen = base.candidatos.length > 0 ? 'dudoso' : 'sin_coincidencia'
      }
    }

    if (elegido) {
      const conv = convertir(p.qty, p.unidad, elegido)
      base.item = { id: elegido.id, name: elegido.name, unit: elegido.unit, current_qty: Number(elegido.current_qty) }
      base.qty = conv.qty ?? p.qty
      base.problema = conv.problema
    }
    out.push(base)
  }
  return out
}

/** Elaborados contados hoy (hora Argentina) sobre los que se llevan. */
export async function estadoConteoHoy(admin: SupabaseClient): Promise<{ contados: number; total: number; ultimo: string | null }> {
  const hoyAR = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
  const desde = new Date(`${hoyAR}T00:00:00-03:00`).toISOString()
  const { data } = await admin.from('stock_items').select('name, last_counted_at').eq('is_active', true).eq('is_produced', true)
  const lista = ((data ?? []) as { name: string; last_counted_at: string | null }[]).filter((i) => !/\bpre\s*-?\s*producto\b/i.test(i.name))
  const hoy = lista.filter((i) => i.last_counted_at && i.last_counted_at >= desde)
  const ultimo = hoy.map((i) => i.last_counted_at!).sort().at(-1) ?? null
  return { contados: hoy.length, total: lista.length, ultimo }
}
