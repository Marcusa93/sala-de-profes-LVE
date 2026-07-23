// ---------------------------------------------------------------------------
// POST /api/stock/create-from-fudo — Crear stock_items desde Fudo con un tap
// GET  /api/stock/create-from-fudo — Listar ingredientes/productos Fudo sin item LVE
// ---------------------------------------------------------------------------
// Fudo es la fuente de verdad: cuando el sync detecta ingredientes/productos
// con control de stock en Fudo que no existen en LVE, este endpoint los crea
// al toque para no perder trazabilidad. Manager-only. Idempotente: si ya hay
// un stock_item vinculado a ese fudo_ingredient_id / fudo_product_id, se saltea.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { getFudoToken, fudo } from '@/lib/fudoClient'
import { logAudit } from '@/lib/audit'

export const maxDuration = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FudoIngredientWithUnit = {
  id: string
  name: string
  cost: number | null
  stock: number | null
  stockControl: boolean
  unit: 'kg' | 'l' | 'unidad'
}

type UnmappedProduct = {
  id: string
  name: string
  cost: number | null
  stock: number | null
}

// ---------------------------------------------------------------------------
// Fudo helpers
// ---------------------------------------------------------------------------

/** Mapea la unidad de Fudo ('kg' | 'litre' | 'unit') a la unidad LVE */
function mapFudoUnit(raw: string | null | undefined): 'kg' | 'l' | 'unidad' {
  const value = (raw ?? '').toLowerCase()
  if (value.includes('kg') || value.includes('kilo')) return 'kg'
  if (value.includes('lit') || value === 'l') return 'l'
  return 'unidad'
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Lee todos los ingredientes de Fudo con su unidad (include=unit, paginado) */
async function readFudoIngredientsWithUnit(): Promise<FudoIngredientWithUnit[]> {
  const token = await getFudoToken()
  const all: FudoIngredientWithUnit[] = []
  let page = 1

  while (page <= 10) {
    const res = await fetch(
      `https://api.fu.do/v1alpha1/ingredients?include=unit&page[size]=200&page[number]=${page}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    )

    if (!res.ok) {
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000))
        continue
      }
      throw new Error(`Fudo API error: ${res.status}`)
    }

    const data = await res.json()
    const items = data.data ?? []
    const included = data.included ?? []

    // Mapa de unidades incluidas: id → nombre/código ('kg' | 'litre' | 'unit')
    const unitMap = new Map<string, string>()
    for (const inc of included) {
      if ((inc.type ?? '').toLowerCase() === 'unit') {
        const label = inc.attributes?.name ?? inc.attributes?.code ?? inc.id
        unitMap.set(String(inc.id), String(label))
      }
    }

    for (const item of items) {
      const unitRef = item.relationships?.unit?.data as { id?: string } | null | undefined
      const rawUnit = unitRef?.id != null
        ? (unitMap.get(String(unitRef.id)) ?? String(unitRef.id))
        : null
      all.push({
        id: String(item.id),
        name: item.attributes?.name ?? `Ingrediente ${item.id}`,
        cost: asNullableNumber(item.attributes?.cost),
        stock: asNullableNumber(item.attributes?.stock),
        stockControl: item.attributes?.stockControl ?? false,
        unit: mapFudoUnit(rawUnit),
      })
    }

    if (items.length < 200) break
    page++
  }

  return all
}

/** Productos Fudo con control de stock (terminados, ej. empanadas) */
async function readFudoProductsWithStock(): Promise<UnmappedProduct[]> {
  const products = await fudo.getProducts()
  return products
    .filter(p => p.stockControl && p.stock != null)
    .map(p => ({
      id: String(p.id),
      name: p.name,
      cost: asNullableNumber(p.cost),
      stock: asNullableNumber(p.stock),
    }))
}

/** Sets de ids Fudo ya vinculados a algún stock_item (activo o no) */
async function readLinkedFudoIds(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin
    .from('stock_items')
    .select('fudo_ingredient_id, fudo_product_id')

  if (error) throw error

  const linkedIngredients = new Set<string>()
  const linkedProducts = new Set<string>()
  for (const row of data ?? []) {
    if (row.fudo_ingredient_id) linkedIngredients.add(String(row.fudo_ingredient_id))
    if (row.fudo_product_id) linkedProducts.add(String(row.fudo_product_id))
  }
  return { linkedIngredients, linkedProducts }
}

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, first_name, last_name')
    .eq('id', user.id)
    .single()

  if (!isManagerOrAbove(profile?.role)) {
    return { error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }
  }

  const userName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null
  return { user, userName }
}

// ---------------------------------------------------------------------------
// GET — lista de ingredientes/productos Fudo sin item en LVE
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const auth = await requireManager()
    if ('error' in auth) return auth.error

    const admin = createAdminClient()
    const [ingredients, products, { linkedIngredients, linkedProducts }] = await Promise.all([
      readFudoIngredientsWithUnit(),
      readFudoProductsWithStock(),
      readLinkedFudoIds(admin),
    ])

    const unmappedIngredients = ingredients
      .filter(i => i.stockControl && !linkedIngredients.has(i.id))
      .map(({ id, name, unit, cost, stock }) => ({ id, name, unit, cost, stock }))

    const unmappedProducts = products.filter(p => !linkedProducts.has(p.id))

    return NextResponse.json({
      unmapped_ingredients: unmappedIngredients,
      unmapped_products: unmappedProducts,
      total: unmappedIngredients.length + unmappedProducts.length,
    })
  } catch (error) {
    console.error('[GET /api/stock/create-from-fudo]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST — crear los stock_items
// Body: { fudo_ingredient_id } | { fudo_product_id } | { all: true }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireManager()
    if ('error' in auth) return auth.error
    const { user, userName } = auth

    const body = await request.json().catch(() => ({})) as {
      fudo_ingredient_id?: string | number
      fudo_product_id?: string | number
      all?: boolean
    }

    const targetIngredientId = body.fudo_ingredient_id != null ? String(body.fudo_ingredient_id) : null
    const targetProductId = body.fudo_product_id != null ? String(body.fudo_product_id) : null
    const all = body.all === true

    if (!all && !targetIngredientId && !targetProductId) {
      return NextResponse.json(
        { error: 'Indicá fudo_ingredient_id, fudo_product_id o all: true' },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    const needIngredients = all || Boolean(targetIngredientId)
    const needProducts = all || Boolean(targetProductId)

    const [ingredients, products, { linkedIngredients, linkedProducts }] = await Promise.all([
      needIngredients ? readFudoIngredientsWithUnit() : Promise.resolve([]),
      needProducts ? readFudoProductsWithStock() : Promise.resolve([]),
      readLinkedFudoIds(admin),
    ])

    // Candidatos según el modo
    const ingredientCandidates = all
      ? ingredients.filter(i => i.stockControl)
      : ingredients.filter(i => i.id === targetIngredientId)
    const productCandidates = all
      ? products
      : products.filter(p => p.id === targetProductId)

    if (!all && targetIngredientId && ingredientCandidates.length === 0) {
      return NextResponse.json(
        { error: `Ingrediente ${targetIngredientId} no encontrado en Fudo` },
        { status: 404 },
      )
    }
    if (!all && targetProductId && productCandidates.length === 0) {
      return NextResponse.json(
        { error: `Producto ${targetProductId} no encontrado en Fudo` },
        { status: 404 },
      )
    }

    let created = 0
    let skipped = 0
    const createdNames: string[] = []
    const errors: string[] = []
    const now = new Date().toISOString()

    for (const ing of ingredientCandidates) {
      if (linkedIngredients.has(ing.id)) {
        skipped++
        continue
      }
      const { error } = await admin.from('stock_items').insert({
        name: ing.name,
        unit: ing.unit,
        cost_per_unit: ing.cost != null && ing.cost > 0 ? ing.cost : null,
        current_qty: typeof ing.stock === 'number' ? Math.round(ing.stock * 100) / 100 : 0,
        fudo_ingredient_id: ing.id,
        is_active: true,
        category: 'otros',
        semaphore: 'green',
        updated_at: now,
      })
      if (error) {
        errors.push(`${ing.name}: ${error.message}`)
      } else {
        created++
        createdNames.push(ing.name)
        linkedIngredients.add(ing.id)
      }
    }

    for (const prod of productCandidates) {
      if (linkedProducts.has(prod.id)) {
        skipped++
        continue
      }
      const { error } = await admin.from('stock_items').insert({
        name: prod.name,
        unit: 'unidad',
        cost_per_unit: prod.cost != null && prod.cost > 0 ? prod.cost : null,
        current_qty: typeof prod.stock === 'number' ? Math.round(prod.stock * 100) / 100 : 0,
        fudo_product_id: prod.id,
        is_active: true,
        category: 'otros',
        semaphore: 'green',
        updated_at: now,
      })
      if (error) {
        errors.push(`${prod.name}: ${error.message}`)
      } else {
        created++
        createdNames.push(prod.name)
        linkedProducts.add(prod.id)
      }
    }

    if (created > 0) {
      logAudit(admin, {
        userId: user.id,
        userName,
        action: 'create_from_fudo',
        module: 'stock',
        entityType: 'stock_item',
        description: `${userName ?? 'Encargado'}: creó ${created} item${created === 1 ? '' : 's'} de stock desde Fudo${skipped > 0 ? ` (${skipped} ya existían)` : ''}`,
        metadata: {
          created,
          skipped,
          errors: errors.length > 0 ? errors : undefined,
          items: createdNames.slice(0, 120),
          mode: all ? 'all' : targetIngredientId ? 'ingredient' : 'product',
        },
      })
    }

    return NextResponse.json({
      success: errors.length === 0,
      created,
      skipped,
      errors,
      items: createdNames,
    })
  } catch (error) {
    console.error('[POST /api/stock/create-from-fudo]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
