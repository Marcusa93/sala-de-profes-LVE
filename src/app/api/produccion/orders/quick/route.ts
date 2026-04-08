import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/produccion/orders/quick
// ---------------------------------------------------------------------------
// Creates a production order, adds inputs/outputs, and completes it in a
// single request. Replaces the 4-request sequence from the wizard:
//   1. POST /orders (create draft)
//   2. PATCH /orders/:id (add_input)
//   3. PATCH /orders/:id (add_output × N)
//   4. POST /orders/:id/complete
//
// If any step fails, the order stays as 'draft' for manual review.
//
// Body:
//   name:         string (required)
//   template_id:  number | null
//   notes:        string | null
//   input: {
//     stock_item_id: string (UUID)
//     qty_used:      number
//     unit:          string
//   }
//   outputs: [{
//     stock_item_id:   string | null
//     output_name:     string
//     qty_produced:    number
//     theoretical_qty: number | null
//     unit:            string
//     is_waste:        boolean
//     notes:           string | null
//   }]
//   auto_complete: boolean (default true — run complete_production_order RPC)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body?.name || !body?.input || !body?.outputs?.length) {
      return NextResponse.json({
        error: 'Campos requeridos: name, input (stock_item_id, qty_used, unit), outputs[]',
      }, { status: 400 })
    }

    const admin = createAdminClient()
    const autoComplete = body.auto_complete !== false

    // ── 1. Create order ──
    const { data: order, error: orderErr } = await admin
      .from('production_orders')
      .insert({
        name: body.name,
        template_id: body.template_id ?? null,
        status: 'draft',
        chef_id: user.id,
        notes: body.notes ?? null,
      })
      .select('id')
      .single()

    if (orderErr || !order) {
      throw new Error(orderErr?.message ?? 'Error al crear la orden')
    }

    const orderId = order.id

    // ── 2. Add input ──
    const { error: inputErr } = await admin
      .from('production_inputs')
      .insert({
        production_order_id: orderId,
        stock_item_id: body.input.stock_item_id,
        qty_used: Number(body.input.qty_used),
        unit: body.input.unit ?? 'kg',
        cost_per_unit: body.input.cost_per_unit ? Number(body.input.cost_per_unit) : null,
      })

    if (inputErr) {
      throw new Error(`Error al agregar insumo: ${inputErr.message}`)
    }

    // ── 3. Add all outputs ──
    const outputRows = body.outputs
      .filter((o: { output_name: string; qty_produced: number }) => o.output_name && o.qty_produced !== undefined)
      .map((o: {
        stock_item_id?: string | null
        output_name: string
        qty_produced: number
        theoretical_qty?: number | null
        unit?: string
        is_waste?: boolean
        notes?: string | null
      }) => ({
        production_order_id: orderId,
        stock_item_id: o.stock_item_id || null,
        output_name: o.output_name,
        qty_produced: Number(o.qty_produced),
        theoretical_qty: o.theoretical_qty ? Number(o.theoretical_qty) : null,
        unit: o.unit ?? 'kg',
        is_waste: Boolean(o.is_waste),
        notes: o.notes ?? null,
      }))

    if (outputRows.length === 0) {
      throw new Error('Se requiere al menos una salida')
    }

    const { error: outputErr } = await admin
      .from('production_outputs')
      .insert(outputRows)

    if (outputErr) {
      throw new Error(`Error al agregar salidas: ${outputErr.message}`)
    }

    // ── 4. Complete (optional) ──
    if (autoComplete) {
      const { data: result, error: completeErr } = await admin.rpc(
        'complete_production_order',
        { p_order_id: orderId, p_user_id: user.id },
      )

      if (completeErr) {
        throw new Error(`Error al completar: ${completeErr.message}`)
      }

      const rpcResult = result as {
        success: boolean
        error?: string
        order_id?: number
        total_input_qty?: number
        total_output_qty?: number
        waste_qty?: number
        efficiency_pct?: number
        movements?: unknown[]
      }

      if (!rpcResult.success) {
        return NextResponse.json({
          error: rpcResult.error ?? 'Error al completar la orden',
          order_id: orderId,
          status: 'draft',
        }, { status: 400 })
      }

      // Sync to Fudo
      const movements = (rpcResult.movements ?? []) as { stock_item_id: string; change: number }[]
      if (movements.length > 0) {
        try {
          const { syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
          await syncProductionToFudo(admin, movements, user.id)
        } catch (e) {
          console.warn('[quick] Fudo sync warning:', e)
        }
      }

      return NextResponse.json({
        success: true,
        order_id: orderId,
        status: 'completed',
        total_input_qty: rpcResult.total_input_qty,
        total_output_qty: rpcResult.total_output_qty,
        waste_qty: rpcResult.waste_qty,
        efficiency_pct: rpcResult.efficiency_pct,
        message: `Produccion completada — eficiencia ${rpcResult.efficiency_pct}%`,
      }, { status: 201 })
    }

    // Not auto-completing — return draft order
    return NextResponse.json({
      success: true,
      order_id: orderId,
      status: 'draft',
      message: 'Orden creada como borrador',
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/produccion/orders/quick]', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Error interno',
    }, { status: 500 })
  }
}
