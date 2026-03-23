import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  try {
    const supabase = createAdminClient()

    // Check if already seeded
    const { data: existing } = await supabase
      .from('bar_stock_items')
      .select('id')
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ message: 'Bar stock already has items', count: existing.length })
    }

    const items = [
      { name: 'Leche entera',               category: 'lacteos',         unit: 'lt',        current_qty: 27, current_detail: null,              min_level: 20,  is_urgent: false, sort_order: 10 },
      { name: 'Leche descremada',           category: 'lacteos',         unit: 'lt',        current_qty: 33, current_detail: null,              min_level: 20,  is_urgent: false, sort_order: 20 },
      { name: 'Leche deslactosada',         category: 'lacteos',         unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 5,   is_urgent: true,  sort_order: 30 },
      { name: 'Café Oyambre Santos Finos',  category: 'cafe',            unit: 'kg',        current_qty: 6,  current_detail: '600g x 6 unid',   min_level: 10,  is_urgent: true,  sort_order: 40 },
      { name: 'Té saquitos',                category: 'insumos_oyambre', unit: 'cajas',     current_qty: 1,  current_detail: null,              min_level: 2,   is_urgent: true,  sort_order: 50 },
      { name: 'Yerba mate',                 category: 'insumos_oyambre', unit: 'cajas',     current_qty: 1,  current_detail: '26 unidades',     min_level: 2,   is_urgent: false, sort_order: 60 },
      { name: 'Nesquik',                    category: 'insumos_oyambre', unit: 'bolsas',    current_qty: 2,  current_detail: null,              min_level: 2,   is_urgent: false, sort_order: 70 },
      { name: 'Cacao amargo',               category: 'insumos_oyambre', unit: 'gr',        current_qty: 70, current_detail: null,              min_level: 200, is_urgent: true,  sort_order: 80 },
      { name: 'Tableta cacao 70%',          category: 'insumos_oyambre', unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 3,   is_urgent: true,  sort_order: 90 },
      { name: 'Edulcorante',                category: 'insumos_oyambre', unit: 'cajas',     current_qty: 0,  current_detail: null,              min_level: 2,   is_urgent: true,  sort_order: 100 },
      { name: 'Azúcar sobres',              category: 'insumos_oyambre', unit: 'cajas',     current_qty: 2,  current_detail: '800 sobres/caja', min_level: 2,   is_urgent: false, sort_order: 110 },
      { name: 'Submarino',                  category: 'suministros',     unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 5,   is_urgent: true,  sort_order: 120 },
      { name: 'Salsa chocolate',            category: 'suministros',     unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 2,   is_urgent: true,  sort_order: 130 },
      { name: 'Tónica',                     category: 'suministros',     unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 6,   is_urgent: true,  sort_order: 140 },
      { name: 'Tónica pomelo',              category: 'suministros',     unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 6,   is_urgent: true,  sort_order: 150 },
      { name: 'Vasos descartables 18oz',    category: 'packaging',       unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 50,  is_urgent: true,  sort_order: 160 },
      { name: 'Dispensador cinta adhesiva', category: 'libreria',        unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 1,   is_urgent: true,  sort_order: 170 },
      { name: 'Marcador permanente negro',  category: 'libreria',        unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 2,   is_urgent: true,  sort_order: 180 },
      { name: 'Esponja XL',                category: 'libreria',        unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 2,   is_urgent: true,  sort_order: 190 },
      { name: 'Papel fibra caña de azúcar', category: 'general',         unit: 'unidades',  current_qty: 0,  current_detail: null,              min_level: 1,   is_urgent: false, sort_order: 200 },
    ]

    const { error } = await supabase.from('bar_stock_items').insert(items)
    if (error) throw error

    return NextResponse.json({ success: true, inserted: items.length })
  } catch (error) {
    console.error('[seed-bar] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
