import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/link-suppliers
// ---------------------------------------------------------------------------
// Links stock_items to suppliers using Fudo ingredient → provider relationships.
//
// 1) Fetch all Fudo ingredients (with relationships)
// 2) For each ingredient that has a provider relationship:
//    - Find stock_item by fudo_ingredient_id
//    - Find supplier by fudo_provider_id
//    - Set stock_item.supplier_id = supplier.id
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const supabase = createAdminClient()

    // 1) Fetch Fudo ingredients with relationships
    const fudoIngredients = await fudo.getIngredients()

    // 2) Build fudo_ingredient_id → fudo_provider_id mapping
    const ingredientToProvider = new Map<string, string>()
    for (const ing of fudoIngredients) {
      const providerRel = ing._relationships?.provider
      if (providerRel) {
        const relData = providerRel.data as { id?: string; type?: string } | null
        if (relData?.id) {
          ingredientToProvider.set(ing.id, relData.id)
        }
      }
    }

    // 3) Fetch stock_items with fudo_ingredient_id
    const { data: stockItems } = await supabase
      .from('stock_items')
      .select('id, fudo_ingredient_id, supplier_id')
      .not('fudo_ingredient_id', 'is', null)

    // 4) Fetch suppliers with fudo_provider_id
    const { data: suppliers } = await supabase
      .from('suppliers')
      .select('id, fudo_provider_id')
      .not('fudo_provider_id', 'is', null)

    const providerToSupplier = new Map(
      (suppliers ?? []).map((s) => [s.fudo_provider_id!, s.id]),
    )

    // 5) Link stock_items to suppliers
    let linked = 0
    let alreadyLinked = 0
    let noProvider = 0
    let noSupplier = 0
    let errors = 0

    for (const item of stockItems ?? []) {
      if (!item.fudo_ingredient_id) continue

      const fudoProviderId = ingredientToProvider.get(item.fudo_ingredient_id)
      if (!fudoProviderId) {
        noProvider++
        continue
      }

      const supplierId = providerToSupplier.get(fudoProviderId)
      if (!supplierId) {
        noSupplier++
        continue
      }

      if (item.supplier_id === supplierId) {
        alreadyLinked++
        continue
      }

      const { error } = await supabase
        .from('stock_items')
        .update({ supplier_id: supplierId })
        .eq('id', item.id)

      if (error) {
        console.error(`Failed to link stock item ${item.id}:`, error.message)
        errors++
      } else {
        linked++
      }
    }

    return NextResponse.json({
      success: true,
      totalIngredients: fudoIngredients.length,
      ingredientsWithProvider: ingredientToProvider.size,
      linked,
      alreadyLinked,
      noProvider,
      noSupplier,
      errors,
    })
  } catch (error) {
    console.error('[/api/fudo/sync/link-suppliers] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
