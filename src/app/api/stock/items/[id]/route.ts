import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { STOCK_CATEGORY_OPTIONS } from '@/lib/constants'
import { STOCK_UNITS } from '@/lib/constants'
import type { StockCategoryValue } from '@/types/database'

const VALID_CATEGORIES = new Set(
  STOCK_CATEGORY_OPTIONS.map((option) => option.value),
)

const VALID_UNITS = new Set(STOCK_UNITS.map((u) => u.value))

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
    const admin = createAdminClient()

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

    if ('unit' in body) {
      if (!body.unit || typeof body.unit !== 'string' || !VALID_UNITS.has(body.unit)) {
        return NextResponse.json({ error: 'Unidad inválida' }, { status: 400 })
      }
      update.unit = body.unit
    }

    if ('min_qty' in body) {
      const value = body.min_qty == null || body.min_qty === '' ? 0 : Number(body.min_qty)
      if (!Number.isFinite(value) || value < 0 || value > 999999) {
        return NextResponse.json(
          { error: 'min_qty debe ser un número mayor o igual a 0' },
          { status: 400 },
        )
      }
      update.min_qty = value
    }

    if ('purchase_lead_time_days' in body) {
      const value = body.purchase_lead_time_days
      if (value == null || value === '') {
        update.purchase_lead_time_days = null
      } else if (!Number.isInteger(value) || value < 0 || value > 60) {
        return NextResponse.json(
          { error: 'purchase_lead_time_days debe ser un entero entre 0 y 60' },
          { status: 400 },
        )
      } else {
        update.purchase_lead_time_days = value
      }
    }

    if ('supplier_id' in body) {
      const value = body.supplier_id
      if (value == null || value === '') {
        update.supplier_id = null
      } else {
        const supplierId = Number(value)
        if (!Number.isInteger(supplierId) || supplierId < 1) {
          return NextResponse.json({ error: 'supplier_id inválido' }, { status: 400 })
        }

        const { data: supplier, error: supplierError } = await admin
          .from('suppliers')
          .select('id')
          .eq('id', supplierId)
          .eq('is_active', true)
          .maybeSingle()

        if (supplierError) throw supplierError
        if (!supplier) {
          return NextResponse.json({ error: 'Proveedor no encontrado o inactivo' }, { status: 400 })
        }

        update.supplier_id = supplierId
      }
    }

    if (Object.keys(update).length === 1) {
      return NextResponse.json({ error: 'No hay cambios para guardar' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('stock_items')
      .update(update)
      .eq('id', id)
      .select('id, name, unit, category, min_qty, supplier_id, purchase_lead_time_days, shelf_life_days, notes')
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
