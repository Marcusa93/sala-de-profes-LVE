import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// POST /api/kitchen/produce
// ---------------------------------------------------------------------------
// Descuenta insumos del stock al producir porciones de una receta.
// Uso: Cocina Diaria — al confirmar la producción del día.
//
// Body: { recipeId: number, portions: number, referenceId?: string }
//
// Llama a la RPC `produce_recipe` en Supabase que:
//   1. Lee los ingredientes de la receta
//   2. Calcula qty_per_portion * portions por ingrediente
//   3. Registra movimientos de stock con reason = 'production'
//
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['encargado', 'socio', 'chef', 'cocina'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: 'Sin permisos' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)

    if (!body || typeof body.recipeId !== 'number' || typeof body.portions !== 'number') {
      return NextResponse.json(
        { success: false, error: 'Body inválido. Se requiere { recipeId: number, portions: number }' },
        { status: 400 },
      )
    }

    const { recipeId, portions, referenceId } = body as {
      recipeId: number
      portions: number
      referenceId?: string
    }

    if (portions <= 0) {
      return NextResponse.json(
        { success: false, error: 'Las porciones deben ser mayor a 0' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase.rpc('produce_recipe', {
      p_recipe_id: recipeId,
      p_portions: portions,
      p_reference_id: referenceId ?? null,
    })

    if (error) {
      console.error('[/api/kitchen/produce] RPC error:', error)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      )
    }

    logAudit(supabase, {
      userId: user.id,
      userName: null,
      action: 'produce_recipe',
      module: 'produccion',
      entityType: 'production',
      entityId: String(recipeId),
      description: `Producción de receta #${recipeId}: ${portions} porciones`,
      metadata: { recipeId, portions, referenceId },
    }).catch(() => {})

    // data es el JSONB que devuelve la función
    return NextResponse.json(data)
  } catch (error) {
    console.error('[/api/kitchen/produce] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 },
    )
  }
}
