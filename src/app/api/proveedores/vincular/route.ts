import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

// POST /api/proveedores/vincular
// Body: { supplierId: string, link: number[], unlink: number[] }
// Vincula y desvincula insumos de un proveedor en una sola operación (admin client, bypasea RLS).

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (!isManagerOrAbove(profile?.role)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const supplierId = typeof body.supplierId === 'string' ? body.supplierId.trim() : null
    // Los IDs de stock_items son UUID strings
    const link: string[] = Array.isArray(body.link)
      ? (body.link as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
      : []
    const unlink: string[] = Array.isArray(body.unlink)
      ? (body.unlink as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
      : []

    if (!supplierId) return NextResponse.json({ error: 'supplierId requerido' }, { status: 400 })

    // Verificar que el proveedor existe y está activo
    const { data: supplier } = await admin.from('suppliers').select('id, name').eq('id', supplierId).eq('is_active', true).maybeSingle()
    if (!supplier) return NextResponse.json({ error: 'Proveedor no encontrado o inactivo' }, { status: 404 })

    let linked = 0
    let unlinked = 0

    if (link.length > 0) {
      const { error } = await admin.from('stock_items').update({ supplier_id: supplierId, updated_at: new Date().toISOString() }).in('id', link)
      if (error) throw error
      linked = link.length
    }

    if (unlink.length > 0) {
      const { error } = await admin.from('stock_items').update({ supplier_id: null, updated_at: new Date().toISOString() }).in('id', unlink)
      if (error) throw error
      unlinked = unlink.length
    }

    return NextResponse.json({ success: true, linked, unlinked, supplierName: supplier.name })
  } catch (error) {
    console.error('[POST /api/proveedores/vincular]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
