import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// PATCH /api/stock/receipts/[id]
// ---------------------------------------------------------------------------
// Marca un gasto de compra (stock_receipt) como pagado.
// Manager-only. Usado desde /pedidos/cuentas (cuentas por proveedor).
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()

    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const { id } = await context.params
    const receiptId = Number(id)
    if (!Number.isInteger(receiptId) || receiptId <= 0) {
      return NextResponse.json({ error: 'Recibo inválido' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    if (body?.payment_status !== 'pagado') {
      return NextResponse.json({ error: 'payment_status debe ser "pagado"' }, { status: 400 })
    }

    const { data: receipt, error: fetchErr } = await admin
      .from('stock_receipts')
      .select('id, cost_total, payment_status, supplier_id, note, received_date, suppliers:supplier_id(name)')
      .eq('id', receiptId)
      .single()

    if (fetchErr || !receipt) {
      return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 })
    }
    if (receipt.payment_status === 'pagado') {
      return NextResponse.json({ error: 'El recibo ya está pagado' }, { status: 409 })
    }

    const paidAt = new Date().toISOString()
    const { error: updateErr } = await admin
      .from('stock_receipts')
      .update({ payment_status: 'pagado', paid_at: paidAt, paid_by: user.id })
      .eq('id', receiptId)

    if (updateErr) throw updateErr

    const supplierName = (receipt.suppliers as unknown as { name: string } | null)?.name ?? 'Sin proveedor'
    const userName = profile
      ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
      : null

    logAudit(admin, {
      userId: user.id,
      userName,
      action: 'receipt_payment',
      module: 'pedidos',
      entityType: 'stock_receipt',
      entityId: String(receiptId),
      description: `Recibo #${receiptId} (${supplierName}${receipt.cost_total != null ? ` — $${receipt.cost_total}` : ''}) marcado como pagado`,
      metadata: {
        receiptId,
        payment_status: 'pagado',
        cost_total: receipt.cost_total,
        supplier_id: receipt.supplier_id,
        paid_at: paidAt,
      },
    }).catch(() => {})

    return NextResponse.json({ success: true, paid_at: paidAt })
  } catch (error) {
    console.error('[PATCH /api/stock/receipts/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
