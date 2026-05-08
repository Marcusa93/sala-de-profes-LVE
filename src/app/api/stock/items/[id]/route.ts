import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { STOCK_CATEGORY_OPTIONS } from '@/lib/constants'
import type { StockCategoryValue } from '@/types/database'

const VALID_CATEGORIES = new Set(
  STOCK_CATEGORY_OPTIONS.map((option) => option.value),
)

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if ('shelf_life_days' in body) {
      const value = body.shelf_life_days
      if (value == null || value === '') {
        update.shelf_life_days = null
      } else if (!Number.isInteger(value) || value < 1 || value > 365) {
        return NextResponse.json(
          { error: 'shelf_life_days debe ser un entero entre 1 y 365' },
          { status: 400 },
        )
      } else {
        update.shelf_life_days = value
      }
    }

    if ('notes' in body) {
      if (body.notes == null || body.notes === '') {
        update.notes = null
      } else if (typeof body.notes !== 'string') {
        return NextResponse.json({ error: 'notes debe ser texto' }, { status: 400 })
      } else {
        update.notes = body.notes.trim() || null
      }
    }

    if ('category' in body) {
      if (body.category == null || body.category === '') {
        return NextResponse.json({ error: 'category no puede ser vacío' }, { status: 400 })
      }
      if (!VALID_CATEGORIES.has(body.category)) {
        return NextResponse.json({ error: 'category inválida' }, { status: 400 })
      }
      update.category = body.category as StockCategoryValue
    }

    if (Object.keys(update).length === 1) {
      return NextResponse.json({ error: 'No hay cambios para guardar' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('stock_items')
      .update(update)
      .eq('id', id)
      .select('id, name, category, shelf_life_days, notes')
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, item: data })
  } catch (error) {
    console.error('[PATCH /api/stock/items/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
