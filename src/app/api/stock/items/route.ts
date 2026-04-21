import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStockItems } from '@/lib/queries/stock'

// ---------------------------------------------------------------------------
// GET /api/stock/items
// Returns all active stock items. Used by production wizard, search inputs,
// and other client components.
//
// Query params:
//   preset — 'minimal' | 'summary' | 'full' | 'withSupplier' (default: summary)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
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

    const preset = (request.nextUrl.searchParams.get('preset') ?? 'summary') as
      'minimal' | 'summary' | 'full' | 'withSupplier'

    const { data: items, error } = await getStockItems(preset)
    if (error) throw error

    return NextResponse.json({ items: items ?? [] })
  } catch (err) {
    console.error('[GET /api/stock/items]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
