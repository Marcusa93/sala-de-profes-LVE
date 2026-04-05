import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateSupplierSuggestions } from '@/lib/ai/supplier-match'

// GET /api/ai/supplier-match — get AI suggestions for items without supplier
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const suggestions = await generateSupplierSuggestions()
    return NextResponse.json({ suggestions, generatedAt: new Date().toISOString() })
  } catch (error) {
    console.error('[/api/ai/supplier-match]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// POST /api/ai/supplier-match — accept a suggestion (assign supplier to item)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json()
    const { item_id, supplier_id } = body
    if (!item_id || !supplier_id) {
      return NextResponse.json({ error: 'item_id y supplier_id requeridos' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('stock_items')
      .update({ supplier_id })
      .eq('id', item_id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[/api/ai/supplier-match POST]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
