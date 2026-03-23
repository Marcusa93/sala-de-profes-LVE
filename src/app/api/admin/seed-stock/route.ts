import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/admin/seed-stock
// ---------------------------------------------------------------------------
// Popula stock_items con inventario real de La Vieja Escuela.
// Solo ejecutar una vez — verifica si ya hay items antes de insertar.
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    const supabase = createAdminClient()

    // Check if stock already has items
    const { count } = await supabase
      .from('stock_items')
      .select('id', { count: 'exact', head: true })

    if (count && count > 0) {
      return NextResponse.json({
        success: false,
        error: `Ya hay ${count} items en stock. Seed cancelado para no duplicar.`,
      })
    }

    // Get suppliers for linking
    const { data: suppliers } = await supabase
      .from('suppliers')
      .select('id, name')

    const supplierMap = new Map(
      (suppliers ?? []).map((s) => [s.name.toLowerCase(), s.id]),
    )

    // Helper to find supplier by partial name match
    function findSupplier(keyword: string): number | null {
      for (const [name, id] of supplierMap) {
        if (name.includes(keyword.toLowerCase())) return id
      }
      return null
    }

    // -----------------------------------------------------------------------
    // Stock items reales de La Vieja Escuela
    // -----------------------------------------------------------------------

    const stockItems = [
      // === LÁCTEOS ===
      {
        name: 'Leche entera',
        category: 'lacteos',
        unit: 'l',
        current_qty: 28,
        min_qty: 20,
        cost_per_unit: 850,
        notes: '2 fardos + 16 litros sueltos',
        supplier_id: findSupplier('lácteo') ?? findSupplier('distrib'),
      },
      {
        name: 'Leche descremada',
        category: 'lacteos',
        unit: 'l',
        current_qty: 21,
        min_qty: 12,
        cost_per_unit: 900,
        notes: '2 fardos + 9 litros sueltos',
        supplier_id: findSupplier('lácteo') ?? findSupplier('distrib'),
      },
      {
        name: 'Leche sin lactosa',
        category: 'lacteos',
        unit: 'l',
        current_qty: 0,
        min_qty: 6,
        cost_per_unit: 1200,
        notes: 'Sin stock — URGENTE',
        supplier_id: findSupplier('lácteo') ?? findSupplier('distrib'),
      },
      {
        name: 'Crema de leche',
        category: 'lacteos',
        unit: 'l',
        current_qty: 3,
        min_qty: 4,
        cost_per_unit: 2500,
        supplier_id: findSupplier('lácteo'),
      },
      {
        name: 'Manteca',
        category: 'lacteos',
        unit: 'kg',
        current_qty: 2,
        min_qty: 3,
        cost_per_unit: 4500,
        supplier_id: findSupplier('lácteo'),
      },
      {
        name: 'Queso cremoso',
        category: 'lacteos',
        unit: 'kg',
        current_qty: 4,
        min_qty: 3,
        cost_per_unit: 8000,
      },

      // === BEBIDAS ===
      {
        name: 'Café Oyambre Santos Finos',
        category: 'bebidas',
        unit: 'kg',
        current_qty: 7,
        min_qty: 10,
        cost_per_unit: 12000,
        notes: '7 kg disponibles — pedir más',
        supplier_id: findSupplier('oyambre') ?? findSupplier('café'),
      },
      {
        name: 'Agua mineral sin gas (500ml)',
        category: 'bebidas',
        unit: 'unidad',
        current_qty: 48,
        min_qty: 24,
        cost_per_unit: 500,
      },
      {
        name: 'Agua mineral con gas (500ml)',
        category: 'bebidas',
        unit: 'unidad',
        current_qty: 36,
        min_qty: 24,
        cost_per_unit: 550,
      },
      {
        name: 'Cerveza artesanal IPA',
        category: 'bebidas',
        unit: 'unidad',
        current_qty: 24,
        min_qty: 12,
        cost_per_unit: 2800,
      },
      {
        name: 'Cerveza artesanal Blonde',
        category: 'bebidas',
        unit: 'unidad',
        current_qty: 18,
        min_qty: 12,
        cost_per_unit: 2500,
      },
      {
        name: 'Vino Malbec (botella)',
        category: 'bebidas',
        unit: 'unidad',
        current_qty: 8,
        min_qty: 6,
        cost_per_unit: 6500,
      },
      {
        name: 'Jugo de naranja exprimido',
        category: 'bebidas',
        unit: 'kg',
        current_qty: 10,
        min_qty: 8,
        cost_per_unit: 2000,
        notes: 'Naranjas para exprimir',
      },
      {
        name: 'Limonada (limones)',
        category: 'bebidas',
        unit: 'kg',
        current_qty: 5,
        min_qty: 4,
        cost_per_unit: 2500,
      },

      // === CONDIMENTOS / INSUMOS BARRA ===
      {
        name: 'Mate cocido (saquitos)',
        category: 'condimentos',
        unit: 'unidad',
        current_qty: 57,
        min_qty: 30,
        cost_per_unit: 50,
        notes: '27 sueltos + 1 caja cerrada',
      },
      {
        name: 'Té negro (saquitos)',
        category: 'condimentos',
        unit: 'unidad',
        current_qty: 46,
        min_qty: 20,
        cost_per_unit: 80,
      },
      {
        name: 'Té verde (saquitos)',
        category: 'condimentos',
        unit: 'unidad',
        current_qty: 30,
        min_qty: 15,
        cost_per_unit: 90,
      },
      {
        name: 'Azúcar (sobres)',
        category: 'condimentos',
        unit: 'caja',
        current_qty: 2.5,
        min_qty: 1,
        cost_per_unit: 3500,
        notes: '2 cajas cerradas + 1 abierta',
      },
      {
        name: 'Edulcorante',
        category: 'condimentos',
        unit: 'unidad',
        current_qty: 0,
        min_qty: 1,
        cost_per_unit: 2000,
        notes: 'Sin unidades selladas — URGENTE',
      },
      {
        name: 'Chocolate 70% (tablitas)',
        category: 'condimentos',
        unit: 'unidad',
        current_qty: 0,
        min_qty: 2,
        cost_per_unit: 3000,
        notes: 'Para submarinos — sin stock',
      },
      {
        name: 'Canela en polvo',
        category: 'condimentos',
        unit: 'unidad',
        current_qty: 2,
        min_qty: 1,
        cost_per_unit: 1500,
      },
      {
        name: 'Cacao en polvo',
        category: 'condimentos',
        unit: 'kg',
        current_qty: 1,
        min_qty: 1,
        cost_per_unit: 8000,
      },
      {
        name: 'Miel',
        category: 'condimentos',
        unit: 'unidad',
        current_qty: 3,
        min_qty: 2,
        cost_per_unit: 4000,
      },
      {
        name: 'Sal fina',
        category: 'condimentos',
        unit: 'kg',
        current_qty: 5,
        min_qty: 2,
        cost_per_unit: 500,
      },
      {
        name: 'Pimienta negra molida',
        category: 'condimentos',
        unit: 'unidad',
        current_qty: 2,
        min_qty: 1,
        cost_per_unit: 2000,
      },
      {
        name: 'Aceite de oliva',
        category: 'condimentos',
        unit: 'l',
        current_qty: 4,
        min_qty: 3,
        cost_per_unit: 7000,
      },

      // === CARNES ===
      {
        name: 'Jamón cocido',
        category: 'carnes',
        unit: 'kg',
        current_qty: 3,
        min_qty: 2,
        cost_per_unit: 9000,
      },
      {
        name: 'Lomito ahumado',
        category: 'carnes',
        unit: 'kg',
        current_qty: 2,
        min_qty: 1.5,
        cost_per_unit: 15000,
      },
      {
        name: 'Bondiola',
        category: 'carnes',
        unit: 'kg',
        current_qty: 4,
        min_qty: 3,
        cost_per_unit: 8500,
      },
      {
        name: 'Pollo (pechuga)',
        category: 'carnes',
        unit: 'kg',
        current_qty: 5,
        min_qty: 4,
        cost_per_unit: 5500,
      },
      {
        name: 'Panceta',
        category: 'carnes',
        unit: 'kg',
        current_qty: 2,
        min_qty: 1.5,
        cost_per_unit: 10000,
      },

      // === VERDURAS ===
      {
        name: 'Tomate',
        category: 'verduras',
        unit: 'kg',
        current_qty: 6,
        min_qty: 4,
        cost_per_unit: 2500,
      },
      {
        name: 'Lechuga',
        category: 'verduras',
        unit: 'unidad',
        current_qty: 8,
        min_qty: 5,
        cost_per_unit: 1200,
      },
      {
        name: 'Cebolla',
        category: 'verduras',
        unit: 'kg',
        current_qty: 5,
        min_qty: 3,
        cost_per_unit: 1500,
      },
      {
        name: 'Palta',
        category: 'verduras',
        unit: 'unidad',
        current_qty: 10,
        min_qty: 6,
        cost_per_unit: 1800,
      },
      {
        name: 'Rúcula',
        category: 'verduras',
        unit: 'unidad',
        current_qty: 4,
        min_qty: 3,
        cost_per_unit: 1500,
      },
      {
        name: 'Papas',
        category: 'verduras',
        unit: 'kg',
        current_qty: 10,
        min_qty: 5,
        cost_per_unit: 1200,
      },
      {
        name: 'Champiñones',
        category: 'verduras',
        unit: 'kg',
        current_qty: 2,
        min_qty: 2,
        cost_per_unit: 5000,
      },

      // === FRUTAS ===
      {
        name: 'Bananas',
        category: 'frutas',
        unit: 'kg',
        current_qty: 4,
        min_qty: 3,
        cost_per_unit: 2000,
      },
      {
        name: 'Frutillas',
        category: 'frutas',
        unit: 'kg',
        current_qty: 2,
        min_qty: 2,
        cost_per_unit: 5000,
      },
      {
        name: 'Arándanos',
        category: 'frutas',
        unit: 'kg',
        current_qty: 1,
        min_qty: 1,
        cost_per_unit: 8000,
      },

      // === PANADERÍA ===
      {
        name: 'Harina 000',
        category: 'panaderia',
        unit: 'kg',
        current_qty: 15,
        min_qty: 10,
        cost_per_unit: 800,
      },
      {
        name: 'Levadura fresca',
        category: 'panaderia',
        unit: 'kg',
        current_qty: 0.5,
        min_qty: 0.5,
        cost_per_unit: 5000,
      },
      {
        name: 'Pan de molde',
        category: 'panaderia',
        unit: 'paquete',
        current_qty: 6,
        min_qty: 4,
        cost_per_unit: 2500,
      },
      {
        name: 'Pan baguette',
        category: 'panaderia',
        unit: 'unidad',
        current_qty: 10,
        min_qty: 8,
        cost_per_unit: 1500,
      },
      {
        name: 'Medialunas',
        category: 'panaderia',
        unit: 'unidad',
        current_qty: 24,
        min_qty: 12,
        cost_per_unit: 500,
      },
      {
        name: 'Huevos',
        category: 'panaderia',
        unit: 'unidad',
        current_qty: 60,
        min_qty: 30,
        cost_per_unit: 200,
        notes: '2 maples',
      },

      // === DESECHABLES ===
      {
        name: 'Vasos descartables 18oz',
        category: 'desechables',
        unit: 'unidad',
        current_qty: 0,
        min_qty: 50,
        cost_per_unit: 120,
        notes: 'Sin stock — vasos grandes para café',
      },
      {
        name: 'Vasos descartables 12oz',
        category: 'desechables',
        unit: 'unidad',
        current_qty: 80,
        min_qty: 50,
        cost_per_unit: 90,
      },
      {
        name: 'Tapas para vasos',
        category: 'desechables',
        unit: 'unidad',
        current_qty: 100,
        min_qty: 50,
        cost_per_unit: 50,
      },
      {
        name: 'Servilletas',
        category: 'desechables',
        unit: 'paquete',
        current_qty: 8,
        min_qty: 4,
        cost_per_unit: 1500,
      },
      {
        name: 'Film plástico',
        category: 'desechables',
        unit: 'unidad',
        current_qty: 2,
        min_qty: 1,
        cost_per_unit: 3000,
      },
      {
        name: 'Papel aluminio',
        category: 'desechables',
        unit: 'unidad',
        current_qty: 1,
        min_qty: 1,
        cost_per_unit: 3500,
      },

      // === LIMPIEZA ===
      {
        name: 'Detergente',
        category: 'limpieza',
        unit: 'l',
        current_qty: 3,
        min_qty: 2,
        cost_per_unit: 2000,
      },
      {
        name: 'Lavandina',
        category: 'limpieza',
        unit: 'l',
        current_qty: 5,
        min_qty: 3,
        cost_per_unit: 1200,
      },
      {
        name: 'Desengrasante',
        category: 'limpieza',
        unit: 'l',
        current_qty: 2,
        min_qty: 2,
        cost_per_unit: 3500,
      },
      {
        name: 'Rejillas',
        category: 'limpieza',
        unit: 'paquete',
        current_qty: 3,
        min_qty: 2,
        cost_per_unit: 1500,
      },
      {
        name: 'Bolsas de residuos',
        category: 'limpieza',
        unit: 'paquete',
        current_qty: 4,
        min_qty: 2,
        cost_per_unit: 2000,
      },
      {
        name: 'Alcohol en gel',
        category: 'limpieza',
        unit: 'l',
        current_qty: 2,
        min_qty: 1,
        cost_per_unit: 3000,
      },

      // === OTROS ===
      {
        name: 'Dispensador cinta adhesiva',
        category: 'otros',
        unit: 'unidad',
        current_qty: 0,
        min_qty: 1,
        cost_per_unit: 2500,
        notes: 'Sin stock',
      },
      {
        name: 'Gas para cocina',
        category: 'otros',
        unit: 'unidad',
        current_qty: 2,
        min_qty: 1,
        cost_per_unit: 15000,
        notes: 'Garrafas de 10kg',
      },
    ]

    // Insert all stock items
    let inserted = 0
    let errors = 0

    for (const item of stockItems) {
      const row: Record<string, unknown> = {
        name: item.name,
        category: item.category,
        unit: item.unit,
        current_qty: item.current_qty,
        min_qty: item.min_qty,
        is_active: true,
      }

      if (item.cost_per_unit) row.cost_per_unit = item.cost_per_unit
      if (item.notes) row.notes = item.notes
      if (item.supplier_id) row.supplier_id = item.supplier_id

      const { error } = await supabase.from('stock_items').insert(row)
      if (error) {
        console.error(`Failed to insert ${item.name}:`, error.message)
        errors++
      } else {
        inserted++
      }
    }

    return NextResponse.json({
      success: true,
      inserted,
      errors,
      total: stockItems.length,
    })
  } catch (error) {
    console.error('[seed-stock] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
