import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function realignStockFromFudo(admin: ReturnType<typeof createAdminClient>) {
  try {
    const { syncFromFudo } = await import('@/lib/fudo/stock-sync')
    const read = await syncFromFudo(admin)
    return { success: true, synced: read.synced, errors: read.errors }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error al re-sincronizar desde Fudo' }
  }
}

// ---------------------------------------------------------------------------
// POST /api/produccion/orders/[id]/complete
// ---------------------------------------------------------------------------
// Cierra la orden de producción aplicando todos los movimientos de stock:
//   - Descuenta los insumos (production_inputs)
//   - Suma los productos obtenidos (production_outputs no-waste con stock_item_id)
//   - Registra la merma
//   - Marca la orden como 'completed'
//
// Retorna: { success, order_id, total_input_qty, total_output_qty, waste_qty,
//            efficiency_pct, movements }
// ---------------------------------------------------------------------------

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const { id: idStr } = await params
    const id = Number(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const admin = createAdminClient()

    // Call the SECURITY DEFINER RPC that handles all stock movements transactionally
    const { data, error } = await admin.rpc('complete_production_order', {
      p_order_id: id,
      p_user_id: user.id,
    })

    if (error) throw error

    const result = data as {
      success: boolean
      error?: string
      order_id?: number
      total_input_qty?: number
      total_output_qty?: number
      waste_qty?: number
      efficiency_pct?: number
      movements?: unknown[]
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Error al completar la orden' }, { status: 400 })
    }

    // Sync affected stock items to Fudo
    const movements = (result.movements ?? []) as { stock_item_id: number; change: number }[]
    let fudoSummary: { synced: number; errors: string[] } | null = null
    if (movements.length > 0) {
      try {
        const { syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
        fudoSummary = await syncProductionToFudo(admin, movements, user.id)
        if (fudoSummary.errors.length > 0) {
          const realignment = await realignStockFromFudo(admin)
          return NextResponse.json({
            success: false,
            order_id: result.order_id,
            status: 'completed_local_fudo_failed',
            error: 'La producción se cerró en LVE pero Fudo no confirmó todos los movimientos. LVE se re-sincronizó desde Fudo cuando fue posible.',
            fudo: fudoSummary,
            realignment,
          }, { status: 502 })
        }
      } catch (err) {
        const realignment = await realignStockFromFudo(admin)
        return NextResponse.json({
          success: false,
          order_id: result.order_id,
          status: 'completed_local_fudo_failed',
          error: `La producción se cerró en LVE pero falló la sincronización con Fudo: ${err instanceof Error ? err.message : 'error desconocido'}. LVE se re-sincronizó desde Fudo cuando fue posible.`,
          fudo: fudoSummary,
          realignment,
        }, { status: 502 })
      }
    }

    return NextResponse.json({
      success: true,
      order_id: result.order_id,
      total_input_qty: result.total_input_qty,
      total_output_qty: result.total_output_qty,
      waste_qty: result.waste_qty,
      efficiency_pct: result.efficiency_pct,
      movements: result.movements,
      fudo: fudoSummary,
      message: `Producción completada — eficiencia ${result.efficiency_pct}%`,
    })
  } catch (err) {
    console.error('[POST /api/produccion/orders/[id]/complete]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
