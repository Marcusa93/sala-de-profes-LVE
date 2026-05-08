import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fullSync, syncToFudo } from '@/lib/fudo/stock-sync'

// ---------------------------------------------------------------------------
// GET /api/stock/sync — Pull stock from Fudo → update Supabase
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const result = await fullSync(admin)

    return NextResponse.json({
      success: true,
      fudoConnected: true,
      ...result,
    })
  } catch (error) {
    console.error('[stock/sync GET]', error)
    return NextResponse.json(
      {
        success: false,
        fudoConnected: false,
        error: error instanceof Error ? error.message : 'Error de sincronización con Fudo',
      },
      { status: 502 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/stock/sync — Write stock change to Supabase + Fudo
// Body: { stockItemId, newQty }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const body = await request.json()
    const { stockItemId, newQty } = body

    if (!stockItemId || typeof newQty !== 'number') {
      return NextResponse.json({ error: 'stockItemId y newQty requeridos' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { fudo } = await import('@/lib/fudoClient')
    const fudoConnection = await fudo.testConnection()
    if (!fudoConnection.ok) {
      return NextResponse.json({
        success: false,
        fudoSynced: false,
        error: `Fudo no está disponible: ${fudoConnection.error}`,
        message: 'Stock no actualizado: Fudo no está disponible',
      }, { status: 502 })
    }

    const result = await syncToFudo(admin, stockItemId, newQty, user.id)

    return NextResponse.json({
      success: result.success,
      fudoSynced: result.fudoSynced,
      error: result.error,
      message: result.fudoSynced
        ? 'Stock actualizado en webapp y Fudo ✓'
        : result.success
          ? 'Stock actualizado en webapp (sin vínculo Fudo)'
          : `Stock no actualizado: ${result.error}`,
    }, { status: result.success ? 200 : 502 })
  } catch (error) {
    console.error('[stock/sync POST]', error)
    return NextResponse.json(
      {
        success: false,
        fudoSynced: false,
        fudoConnected: false,
        error: error instanceof Error ? error.message : 'Error de sincronización con Fudo',
      },
      { status: 502 },
    )
  }
}
