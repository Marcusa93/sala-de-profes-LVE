import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { matchOrdersWithExpenses } from '@/lib/compras/conciliar'
import { fetchFudoExpenses } from '@/lib/fudo/expenses'

// ---------------------------------------------------------------------------
// GET /api/compras/conciliar
//   Para cada pedido "en camino", el gasto de Fudo que mejor lo explica (mismo
//   proveedor, fecha posterior al envío, insumo incluido). Además devuelve los
//   últimos gastos de Fudo por proveedor para elegir a mano.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const admin = createAdminClient()
    const days = Math.min(60, Math.max(7, Number(request.nextUrl.searchParams.get('days') ?? 21) || 21))
    const { matches, orders, expenses_considered } = await matchOrdersWithExpenses(admin, { sinceDays: days })

    // Gastos recientes (para conciliar a mano): sólo los de proveedores con pedidos en camino
    const supplierIds = [...new Set(orders.map((o) => o.supplier_id).filter((x): x is string => Boolean(x)))]
    const { data: suppliers } = supplierIds.length
      ? await admin.from('suppliers').select('id, name, fudo_provider_id').in('id', supplierIds)
      : { data: [] as { id: string; name: string; fudo_provider_id: string | null }[] }
    const providerIds = new Set((suppliers ?? []).map((s) => s.fudo_provider_id).filter(Boolean))
    const sinceISO = new Date(Date.now() - days * 86_400_000).toISOString()
    const expenses = (await fetchFudoExpenses(sinceISO))
      .filter((e) => e.providerId && providerIds.has(e.providerId))
      .slice(0, 80)

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      days,
      expenses_considered,
      matches: matches.map((m) => ({
        order_id: m.order_id,
        source: m.source,
        strength: m.strength,
        why: m.why,
        expense: {
          id: m.expense.id,
          provider: m.expense.provider,
          providerId: m.expense.providerId,
          date: m.expense.date,
          amount: m.expense.amount,
          ingredientNames: m.expense.ingredientNames,
        },
      })),
      expenses: expenses.map((e) => ({
        id: e.id,
        provider: e.provider,
        providerId: e.providerId,
        date: e.date,
        amount: e.amount,
        ingredientNames: e.ingredientNames,
      })),
    })
  } catch (err) {
    console.error('[GET /api/compras/conciliar]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
