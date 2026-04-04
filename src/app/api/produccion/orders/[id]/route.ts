import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/produccion/orders/[id]
// Devuelve la orden completa con inputs, outputs y sub-órdenes.
// ---------------------------------------------------------------------------
// PATCH /api/produccion/orders/[id]
// Actualiza la orden. Permite:
//   - Cambiar name, notes, status (solo a 'in_progress' o 'cancelled')
//   - Agregar un input:  { action: 'add_input',  stock_item_id, qty_used, unit }
//   - Eliminar un input: { action: 'del_input',  input_id }
//   - Agregar un output: { action: 'add_output', stock_item_id?, output_name, qty_produced, unit, is_waste?, notes?, theoretical_qty? }
//   - Eliminar un output:{ action: 'del_output', output_id }
//   - Actualizar output: { action: 'upd_output', output_id, qty_produced, notes? }
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { error: authErr } = await authorize(supabase)
    if (authErr) return authErr

    const { id: idStr } = await params
    const id = Number(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const admin = createAdminClient()

    const [orderRes, inputsRes, outputsRes, childRes] = await Promise.all([
      admin
        .from('production_orders')
        .select(`
          *,
          production_templates(name),
          profiles(first_name, last_name, role)
        `)
        .eq('id', id)
        .single(),
      admin
        .from('production_inputs')
        .select('*, stock_items(id, name, unit, current_qty)')
        .eq('production_order_id', id)
        .order('created_at'),
      admin
        .from('production_outputs')
        .select('*, stock_items(id, name, unit)')
        .eq('production_order_id', id)
        .order('is_waste, created_at'),
      admin
        .from('production_orders')
        .select('id, name, status, completed_at, created_at')
        .eq('parent_order_id', id)
        .order('created_at'),
    ])

    if (orderRes.error || !orderRes.data) {
      return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 })
    }

    const order = orderRes.data
    const inputs = inputsRes.data ?? []
    const outputs = outputsRes.data ?? []
    const children = childRes.data ?? []

    // Compute summary
    const totalInput = inputs.reduce((s, i) => s + i.qty_used, 0)
    const totalOutput = outputs.filter((o) => !o.is_waste).reduce((s, o) => s + o.qty_produced, 0)
    const totalWaste = outputs.filter((o) => o.is_waste).reduce((s, o) => s + o.qty_produced, 0)
    const efficiency = totalInput > 0 ? Math.round(((totalInput - totalWaste) / totalInput) * 1000) / 10 : null

    return NextResponse.json({
      order: {
        ...order,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        template_name: (order.production_templates as any)?.name ?? null,
        chef_name: order.profiles
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? `${(order.profiles as any).first_name} ${(order.profiles as any).last_name}`.trim()
          : null,
        inputs: inputs.map((i) => ({
          ...i,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_name: (i.stock_items as any)?.name ?? '—',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_unit: (i.stock_items as any)?.unit ?? '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_current_qty: (i.stock_items as any)?.current_qty ?? 0,
        })),
        outputs: outputs.map((o) => ({
          ...o,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_name: (o.stock_items as any)?.name ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_unit: (o.stock_items as any)?.unit ?? null,
        })),
        child_orders: children,
        summary: { total_input_qty: totalInput, total_output_qty: totalOutput, total_waste_qty: totalWaste, efficiency_pct: efficiency },
      },
    })
  } catch (err) {
    console.error('[GET /api/produccion/orders/[id]]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { user, error: authErr } = await authorize(supabase)
    if (authErr || !user) return authErr!

    const { id: idStr } = await params
    const id = Number(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const admin = createAdminClient()

    // Fetch order for validation
    const { data: order, error: fetchErr } = await admin
      .from('production_orders')
      .select('id, status')
      .eq('id', id)
      .single()

    if (fetchErr || !order) {
      return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 })
    }

    if (order.status === 'completed' || order.status === 'cancelled') {
      return NextResponse.json({ error: `No se puede modificar una orden ${order.status}` }, { status: 409 })
    }

    const action: string = body.action ?? 'update'

    // --- UPDATE fields ---
    if (action === 'update') {
      const patch: Record<string, unknown> = {}
      if (body.name !== undefined) patch.name = body.name
      if (body.notes !== undefined) patch.notes = body.notes
      if (body.status !== undefined) {
        if (!['in_progress', 'cancelled'].includes(body.status)) {
          return NextResponse.json({ error: 'status solo puede cambiarse a in_progress o cancelled' }, { status: 400 })
        }
        patch.status = body.status
      }
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
      }
      const { error } = await admin.from('production_orders').update(patch).eq('id', id)
      if (error) throw error
      return NextResponse.json({ success: true, action })
    }

    // --- ADD INPUT ---
    if (action === 'add_input') {
      if (!body.stock_item_id || !body.qty_used || !body.unit) {
        return NextResponse.json({ error: 'add_input requiere: stock_item_id, qty_used, unit' }, { status: 400 })
      }
      const { data, error } = await admin
        .from('production_inputs')
        .insert({
          production_order_id: id,
          stock_item_id: Number(body.stock_item_id),
          qty_used: Number(body.qty_used),
          unit: body.unit,
          cost_per_unit: body.cost_per_unit ? Number(body.cost_per_unit) : null,
        })
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ success: true, action, input: data })
    }

    // --- DEL INPUT ---
    if (action === 'del_input') {
      if (!body.input_id) return NextResponse.json({ error: 'del_input requiere: input_id' }, { status: 400 })
      const { error } = await admin
        .from('production_inputs')
        .delete()
        .eq('id', Number(body.input_id))
        .eq('production_order_id', id)
      if (error) throw error
      return NextResponse.json({ success: true, action })
    }

    // --- ADD OUTPUT ---
    if (action === 'add_output') {
      if (!body.output_name || body.qty_produced === undefined || !body.unit) {
        return NextResponse.json({ error: 'add_output requiere: output_name, qty_produced, unit' }, { status: 400 })
      }
      const { data, error } = await admin
        .from('production_outputs')
        .insert({
          production_order_id: id,
          stock_item_id: body.stock_item_id ? Number(body.stock_item_id) : null,
          output_name: body.output_name,
          qty_produced: Number(body.qty_produced),
          theoretical_qty: body.theoretical_qty ? Number(body.theoretical_qty) : null,
          unit: body.unit,
          is_waste: Boolean(body.is_waste),
          notes: body.notes ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ success: true, action, output: data })
    }

    // --- DEL OUTPUT ---
    if (action === 'del_output') {
      if (!body.output_id) return NextResponse.json({ error: 'del_output requiere: output_id' }, { status: 400 })
      const { error } = await admin
        .from('production_outputs')
        .delete()
        .eq('id', Number(body.output_id))
        .eq('production_order_id', id)
      if (error) throw error
      return NextResponse.json({ success: true, action })
    }

    // --- UPD OUTPUT ---
    if (action === 'upd_output') {
      if (!body.output_id || body.qty_produced === undefined) {
        return NextResponse.json({ error: 'upd_output requiere: output_id, qty_produced' }, { status: 400 })
      }
      const patch: Record<string, unknown> = { qty_produced: Number(body.qty_produced) }
      if (body.notes !== undefined) patch.notes = body.notes
      if (body.stock_item_id !== undefined) patch.stock_item_id = body.stock_item_id ? Number(body.stock_item_id) : null
      if (body.output_name !== undefined) patch.output_name = body.output_name
      const { error } = await admin
        .from('production_outputs')
        .update(patch)
        .eq('id', Number(body.output_id))
        .eq('production_order_id', id)
      if (error) throw error
      return NextResponse.json({ success: true, action })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (err) {
    console.error('[PATCH /api/produccion/orders/[id]]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
