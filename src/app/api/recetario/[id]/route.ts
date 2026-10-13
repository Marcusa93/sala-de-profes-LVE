import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { ROLES } from '@/lib/constants'
import { logAudit } from '@/lib/audit'
import { costRecipes } from '@/lib/recipes/recipe-cost'
import { UNIDADES_RECETA, avisoCantidad } from '@/lib/recipes/recetario-platos'

// ---------------------------------------------------------------------------
// /api/recetario/[id] — receta de UN plato (id = menu_items.id)
//   GET → ingredientes por porción, cómo se arma, costo, insumos para buscar
//   PUT → guarda (socio, encargado, chef). Crea la receta si el plato no
//         tenía; reemplaza los ingredientes y la marca como editada en la app
//         (así el Excel de Fudo no la pisa al reimportar).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EDITAN = ['socio', 'encargado', 'chef']

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(Object.keys(ROLES))
  if (auth.response) return auth.response
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Plato inválido' }, { status: 400 })
  const admin = createAdminClient()

  const { data: plato } = await admin.from('menu_items').select('id, name, recipe_id, sale_price').eq('id', id).maybeSingle()
  if (!plato) return NextResponse.json({ error: 'Plato no encontrado' }, { status: 404 })

  const [{ data: receta }, { data: ings }, { data: insumos }, costos] = await Promise.all([
    plato.recipe_id
      ? admin.from('recipes').select('id, preparation, editada_en_app_at, fudo_synced_at, editada_por').eq('id', plato.recipe_id).maybeSingle()
      : Promise.resolve({ data: null }),
    plato.recipe_id
      ? admin.from('recipe_ingredients').select('id, stock_item_id, qty_per_portion, ingredient_unit, notes').eq('recipe_id', plato.recipe_id).order('created_at')
      : Promise.resolve({ data: [] }),
    admin.from('stock_items').select('id, name, unit, cost_per_unit, is_produced').eq('is_active', true).order('name'),
    plato.recipe_id ? costRecipes(admin, [plato.recipe_id]).catch(() => new Map()) : Promise.resolve(new Map()),
  ])
  type Insumo = { id: string; name: string; unit: string; cost_per_unit: number | null; is_produced: boolean | null }
  const porId = new Map(((insumos ?? []) as Insumo[]).map((i) => [i.id, i]))
  const c = plato.recipe_id ? costos.get(plato.recipe_id) : undefined
  let editadaPor: string | null = null
  if (receta?.editada_por) {
    const { data: p } = await admin.from('profiles').select('first_name').eq('id', receta.editada_por).maybeSingle()
    editadaPor = p?.first_name ?? null
  }

  return NextResponse.json({
    plato: { id: plato.id, nombre: plato.name, precio: plato.sale_price != null ? Number(plato.sale_price) : null },
    preparacion: receta?.preparation ?? '',
    editadaEnApp: receta?.editada_en_app_at ?? null,
    editadaPor,
    desdeFudo: receta?.fudo_synced_at ?? null,
    costo: c && c.cost > 0 ? c.cost : null,
    costoCompleto: c?.confiable ?? false,
    sinCosto: c?.missingNames ?? [],
    ingredientes: ((ings ?? []) as { stock_item_id: string; qty_per_portion: number | null; ingredient_unit: string | null; notes: string | null }[])
      .map((r) => {
        const i = porId.get(r.stock_item_id)
        return {
          stock_item_id: r.stock_item_id,
          nombre: i?.name ?? '(insumo dado de baja)',
          unidadStock: i?.unit ?? r.ingredient_unit ?? 'unidad',
          qty: Number(r.qty_per_portion ?? 0),
          unidad: r.ingredient_unit ?? i?.unit ?? 'unidad',
          nota: r.notes,
        }
      }),
    insumos: ((insumos ?? []) as Insumo[]).map((i) => ({ id: i.id, nombre: i.name, unidad: i.unit, costo: i.cost_per_unit, elaborado: !!i.is_produced })),
    puedeEditar: EDITAN.includes(auth.user.role),
  })
}

type LineaPut = { stock_item_id: string; qty: number; unidad: string; nota?: string | null }

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(EDITAN)
  if (auth.response) return auth.response
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Plato inválido' }, { status: 400 })
  const body = await request.json().catch(() => null) as { ingredientes?: LineaPut[]; preparacion?: string } | null
  if (!body || !Array.isArray(body.ingredientes)) return NextResponse.json({ error: 'Faltan los ingredientes' }, { status: 400 })
  const admin = createAdminClient()

  const { data: plato } = await admin.from('menu_items').select('id, name, recipe_id').eq('id', id).maybeSingle()
  if (!plato) return NextResponse.json({ error: 'Plato no encontrado' }, { status: 404 })

  // Validar contra el stock: insumo existente, unidad válida y cantidad creíble
  const ids = [...new Set(body.ingredientes.map((l) => l.stock_item_id).filter((x) => UUID.test(x)))]
  const { data: items } = ids.length ? await admin.from('stock_items').select('id, name, unit').in('id', ids) : { data: [] }
  const porId = new Map(((items ?? []) as { id: string; name: string; unit: string }[]).map((i) => [i.id, i]))
  const lineas: LineaPut[] = []
  for (const l of body.ingredientes) {
    const it = porId.get(l.stock_item_id)
    if (!it) return NextResponse.json({ error: 'Hay un insumo que no existe: sacalo y volvé a agregarlo' }, { status: 400 })
    if (!(UNIDADES_RECETA as readonly string[]).includes(l.unidad)) return NextResponse.json({ error: `Unidad inválida en ${it.name}` }, { status: 400 })
    const qty = Number(l.qty)
    const aviso = avisoCantidad(qty, l.unidad, it.unit, it.name)
    if (aviso?.grave) return NextResponse.json({ error: `${it.name}: ${aviso.texto}` }, { status: 400 })
    lineas.push({ stock_item_id: it.id, qty: Math.round(qty * 10000) / 10000, unidad: l.unidad, nota: l.nota?.trim().slice(0, 120) || null })
  }
  const preparacion = typeof body.preparacion === 'string' ? body.preparacion.trim().slice(0, 4000) : null
  const ahora = new Date().toISOString()

  // Receta del plato (se crea si no tenía)
  let recipeId = plato.recipe_id as string | null
  if (!recipeId) {
    const { data: nueva, error } = await admin.from('recipes').insert({
      name: plato.name, category: 'otros', is_active: true, yield_portions: 1, created_by: auth.user.id,
      notes: 'Cargada en el Recetario de platos', preparation: preparacion, editada_en_app_at: ahora, editada_por: auth.user.id,
    }).select('id').single()
    if (error || !nueva) return NextResponse.json({ error: error?.message ?? 'No se pudo crear la receta' }, { status: 500 })
    recipeId = nueva.id
    await admin.from('menu_items').update({ recipe_id: recipeId, recipe_link_source: 'manual' }).eq('id', plato.id)
  } else {
    const { error } = await admin.from('recipes').update({ preparation: preparacion, editada_en_app_at: ahora, editada_por: auth.user.id, updated_at: ahora }).eq('id', recipeId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Reemplazar los ingredientes
  const { data: antes } = await admin.from('recipe_ingredients').select('stock_item_id, qty_per_portion, ingredient_unit').eq('recipe_id', recipeId)
  const { error: errDel } = await admin.from('recipe_ingredients').delete().eq('recipe_id', recipeId)
  if (errDel) return NextResponse.json({ error: errDel.message }, { status: 500 })
  if (lineas.length) {
    const { error: errIns } = await admin.from('recipe_ingredients').insert(lineas.map((l) => ({
      recipe_id: recipeId!, stock_item_id: l.stock_item_id, qty_per_portion: l.qty, ingredient_unit: l.unidad, notes: l.nota ?? null,
    })))
    if (errIns) {
      // Volver a dejar lo que había
      if (antes?.length) await admin.from('recipe_ingredients').insert((antes as { stock_item_id: string; qty_per_portion: number | null; ingredient_unit: string | null }[]).map((a) => ({ ...a, qty_per_portion: Number(a.qty_per_portion ?? 0), recipe_id: recipeId! })))
      return NextResponse.json({ error: errIns.message }, { status: 500 })
    }
  }

  const { data: yo } = await admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle()
  const quien = [yo?.first_name, yo?.last_name].filter(Boolean).join(' ') || 'Alguien'
  void logAudit(admin, {
    userId: auth.user.id, userName: quien, action: 'receta_plato_editar', module: 'recetas', entityType: 'recipe', entityId: recipeId!,
    description: `${quien} editó la receta de "${plato.name}" (${lineas.length} ingrediente${lineas.length !== 1 ? 's' : ''})`,
    metadata: { antes, despues: lineas },
  })
  return NextResponse.json({ success: true, recipeId })
}
