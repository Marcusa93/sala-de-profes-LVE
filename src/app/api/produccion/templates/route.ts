import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/produccion/templates
// Lista todos los templates activos con sus salidas teóricas.
// ---------------------------------------------------------------------------
// POST /api/produccion/templates
// Crea un nuevo template.
// Body: { name, description?, input_stock_item_id?, input_unit?, outputs: [...] }
// ---------------------------------------------------------------------------

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
    return { user: null, error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }
  }
  return { user, profile, error: null }
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { error: authErr } = await authorize(supabase)
    if (authErr) return authErr

    const admin = createAdminClient()

    const { data: templates, error } = await admin
      .from('production_templates')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (error) throw error

    // Fetch outputs for all templates in one query
    const ids = (templates ?? []).map((t) => t.id)
    const { data: outputs } = ids.length
      ? await admin
          .from('production_template_outputs')
          .select('*, stock_items(id, name, unit)')
          .in('template_id', ids)
          .order('sort_order')
      : { data: [] }

    // Fetch input stock item names
    const { data: stockItems } = await admin
      .from('stock_items')
      .select('id, name, unit')
      .in('id', (templates ?? []).map((t) => t.input_stock_item_id).filter(Boolean))

    const stockMap = Object.fromEntries((stockItems ?? []).map((s) => [s.id, s]))
    const outputsByTemplate: Record<number, typeof outputs> = {}
    for (const o of outputs ?? []) {
      if (!outputsByTemplate[o.template_id]) outputsByTemplate[o.template_id] = []
      outputsByTemplate[o.template_id]!.push(o)
    }

    const result = (templates ?? []).map((t) => ({
      ...t,
      input_stock_item: t.input_stock_item_id ? stockMap[t.input_stock_item_id] ?? null : null,
      outputs: outputsByTemplate[t.id] ?? [],
    }))

    return NextResponse.json({ templates: result, total: result.length })
  } catch (err) {
    console.error('[GET /api/produccion/templates]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { user, profile, error: authErr } = await authorize(supabase)
    if (authErr || !user) return authErr!
    if (!['socio', 'encargado', 'chef'].includes(profile!.role)) {
      return NextResponse.json({ error: 'Sin permisos para crear templates' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body?.name) {
      return NextResponse.json({ error: 'name es requerido' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: template, error: insertErr } = await admin
      .from('production_templates')
      .insert({
        name: body.name,
        description: body.description ?? null,
        input_stock_item_id: body.input_stock_item_id ?? null,
        input_unit: body.input_unit ?? 'kg',
        is_active: true,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    // Insert outputs if provided
    const outputs = Array.isArray(body.outputs) ? body.outputs : []
    if (outputs.length > 0) {
      const outputRows = outputs.map((o: Record<string, unknown>, idx: number) => ({
        template_id: template.id,
        stock_item_id: o.stock_item_id ?? null,
        output_name: o.output_name ?? `Salida ${idx + 1}`,
        theoretical_yield_pct: Number(o.theoretical_yield_pct ?? 0),
        output_unit: o.output_unit ?? 'kg',
        is_waste: Boolean(o.is_waste),
        sort_order: idx,
        notes: o.notes ?? null,
      }))

      const { error: outputErr } = await admin
        .from('production_template_outputs')
        .insert(outputRows)

      if (outputErr) throw outputErr
    }

    return NextResponse.json({ template, success: true }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/produccion/templates]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
