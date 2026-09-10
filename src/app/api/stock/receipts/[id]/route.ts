import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { fudoFetch } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// PATCH /api/stock/receipts/[id]
// ---------------------------------------------------------------------------
// Edita un recibo de compra: monto, nota, medio de pago, cantidad.
// Si cambia la cantidad y el recibo tiene stock_item_id, aplica el delta a Fudo.
//
// DELETE /api/stock/receipts/[id]
// ---------------------------------------------------------------------------
// Anula un recibo:
//   - Revierte el delta de stock en Fudo/LVE si el insumo está vinculado.
//   - Resetea el pedido a "ordered" para poder volver a recibirlo.
//   - Elimina el registro de stock_receipts.
// ---------------------------------------------------------------------------

type ReceiptRow = {
  id: number
  stock_item_id: string | null
  qty: number
  unit: string | null
  cost_total: number | null
  cost_per_unit: number | null
  note: string | null
  payment_status: string | null
  payment_method: string | null
  supplier_id: string | null
  order_id: number | null
  order_source: string | null
}

async function loadReceipt(admin: ReturnType<typeof createAdminClient>, receiptId: number): Promise<ReceiptRow | null> {
  const { data } = await admin
    .from('stock_receipts')
    .select('id, stock_item_id, qty, unit, cost_total, cost_per_unit, note, payment_status, payment_method, supplier_id, order_id, order_source')
    .eq('id', receiptId)
    .maybeSingle()
  return (data as ReceiptRow | null) ?? null
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!isManagerOrAbove(profile?.role)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

    const { id } = await context.params
    const receiptId = Number(id)
    if (!Number.isInteger(receiptId) || receiptId <= 0) return NextResponse.json({ error: 'Recibo inválido' }, { status: 400 })

    const receipt = await loadReceipt(admin, receiptId)
    if (!receipt) return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 })

    const body = await request.json().catch(() => ({})) as Record<string, unknown>

    // Marcar como pagado
    if (body.payment_status === 'pagado') {
      if (receipt.payment_status === 'pagado') return NextResponse.json({ error: 'Ya está pagado' }, { status: 409 })
      const paidAt = new Date().toISOString()
      const newPaidMethod = typeof body.payment_method === 'string' && body.payment_method ? body.payment_method : null
      const update: Record<string, unknown> = { payment_status: 'pagado', paid_at: paidAt, paid_by: user.id }
      if (newPaidMethod) update.payment_method = newPaidMethod
      const { error: upErr } = await admin.from('stock_receipts').update(update).eq('id', receiptId)
      if (upErr) throw upErr

      // Intentar imputar en Fudo si el pedido vinculado tiene fudo_expense_id
      let fudoSynced = false
      if (receipt.order_id && receipt.order_source && receipt.cost_total && receipt.cost_total > 0) {
        const table = receipt.order_source === 'barra' ? 'bar_orders' : 'kitchen_orders'
        const { data: order } = await admin.from(table).select('fudo_expense_id').eq('id', receipt.order_id).maybeSingle()
        const fudoExpenseId = (order as { fudo_expense_id?: string | null } | null)?.fudo_expense_id ?? null
        if (fudoExpenseId) {
          try {
            await fudoFetch(`/expenses/${fudoExpenseId}/payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: { type: 'Payment', attributes: { amount: receipt.cost_total, canceled: false } } }),
            })
            fudoSynced = true
          } catch (fudoErr) {
            console.warn('[PATCH receipt] Fudo payment post failed:', fudoErr instanceof Error ? fudoErr.message : fudoErr)
          }
        }
      }

      const userName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null
      logAudit(admin, { userId: user.id, userName, action: 'receipt_payment', module: 'pedidos', entityType: 'stock_receipt', entityId: String(receiptId), description: `Recibo #${receiptId} marcado como pagado${newPaidMethod ? ` (${newPaidMethod})` : ''}${fudoSynced ? ' — imputado en Fudo' : ''}`, metadata: { receiptId, cost_total: receipt.cost_total, payment_method: newPaidMethod, fudoSynced } }).catch(() => {})
      return NextResponse.json({ success: true, paid_at: paidAt, fudoSynced })
    }

    // Edición de campos
    const newQty = typeof body.qty === 'number' && body.qty > 0 ? body.qty : null
    const newCostTotal = typeof body.cost_total === 'number' ? body.cost_total : undefined
    const newNote = typeof body.note === 'string' ? body.note.trim() || null : undefined
    const newPaymentMethod = typeof body.payment_method === 'string' ? body.payment_method || null : undefined
    const newPaymentStatus = body.payment_status === 'a_pagar' ? 'a_pagar' : undefined

    // Si cambia la cantidad y hay insumo vinculado → aplicar delta al stock
    let fudoSynced = false
    if (newQty !== null && newQty !== receipt.qty && receipt.stock_item_id) {
      const qtyDiff = newQty - receipt.qty
      const { data: si } = await admin.from('stock_items').select('id, name, unit, current_qty, fudo_ingredient_id, fudo_product_id, fudo_skip').eq('id', receipt.stock_item_id).single()
      if (si) {
        const write = await syncToFudo(admin, receipt.stock_item_id, Number(si.current_qty) + qtyDiff, user.id, {
          reason: 'reception',
          deltaOverride: qtyDiff,
          note: `Corrección de recibo #${receiptId}: ${qtyDiff > 0 ? '+' : ''}${qtyDiff} ${si.unit}`,
        })
        if (!write.success) return NextResponse.json({ error: write.error ?? 'No se pudo ajustar el stock' }, { status: 502 })
        fudoSynced = write.fudoSynced
      }
    }

    // Actualizar el recibo
    const update: Record<string, unknown> = {}
    if (newQty !== null && newQty !== receipt.qty) {
      update.qty = newQty
      if (newCostTotal !== undefined) {
        update.cost_total = newCostTotal
        update.cost_per_unit = newQty > 0 ? Math.round((newCostTotal / newQty) * 100) / 100 : null
      } else if (receipt.cost_per_unit != null) {
        update.cost_total = Math.round(newQty * receipt.cost_per_unit * 100) / 100
      }
    } else if (newCostTotal !== undefined) {
      update.cost_total = newCostTotal
      update.cost_per_unit = newQty != null && newQty > 0 ? Math.round((newCostTotal / newQty) * 100) / 100 : receipt.qty > 0 ? Math.round((newCostTotal / receipt.qty) * 100) / 100 : null
    }
    if (newNote !== undefined) update.note = newNote
    if (newPaymentMethod !== undefined) update.payment_method = newPaymentMethod
    if (newPaymentStatus !== undefined) {
      update.payment_status = newPaymentStatus
      update.paid_at = null
      update.paid_by = null
    }

    if (Object.keys(update).length > 0) {
      const { error: upErr } = await admin.from('stock_receipts').update(update).eq('id', receiptId)
      if (upErr) throw upErr
    }

    const userName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null
    logAudit(admin, { userId: user.id, userName, action: 'edit_receipt', module: 'pedidos', entityType: 'stock_receipt', entityId: String(receiptId), description: `Recibo #${receiptId} editado`, metadata: { receiptId, changes: update, fudoSynced } }).catch(() => {})

    return NextResponse.json({ success: true, fudoSynced })
  } catch (error) {
    console.error('[PATCH /api/stock/receipts/[id]]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!isManagerOrAbove(profile?.role)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

    const { id } = await context.params
    const receiptId = Number(id)
    if (!Number.isInteger(receiptId) || receiptId <= 0) return NextResponse.json({ error: 'Recibo inválido' }, { status: 400 })

    const receipt = await loadReceipt(admin, receiptId)
    if (!receipt) return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 })

    // 1) Revertir stock en Fudo/LVE si corresponde
    let stockReversed = false
    let fudoReversed = false
    if (receipt.stock_item_id && receipt.qty > 0) {
      const { data: si } = await admin.from('stock_items').select('id, name, unit, current_qty, fudo_ingredient_id, fudo_product_id, fudo_skip').eq('id', receipt.stock_item_id).single()
      if (si) {
        const write = await syncToFudo(admin, receipt.stock_item_id, Math.max(0, Number(si.current_qty) - receipt.qty), user.id, {
          reason: 'reception',
          deltaOverride: -receipt.qty,
          note: `Anulación de recibo #${receiptId}: -${receipt.qty} ${si.unit}`,
        })
        // No abortamos si Fudo falla — registramos y seguimos con la eliminación
        stockReversed = true
        fudoReversed = write.fudoSynced
        if (!write.success) console.warn('[DELETE receipt] Stock reversal failed:', write.error)
      }
    }

    // 2) Resetear el pedido a "ordered" para que se pueda volver a recibir
    if (receipt.order_id && receipt.order_source) {
      const table = receipt.order_source === 'barra' ? 'bar_orders' : 'kitchen_orders'
      const resetFields: Record<string, unknown> = {
        status: 'ordered',
        received_by: null,
        received_at: null,
        received_qty: null,
        received_mode: null,
        received_note: null,
        fudo_expense_id: null,
        fudo_amount: null,
      }
      let { error: resetErr } = await admin.from(table).update(resetFields).eq('id', receipt.order_id).eq('status', 'received')
      if (resetErr && /received_mode|fudo_expense_id|fudo_amount/.test(resetErr.message)) {
        ;({ error: resetErr } = await admin.from(table).update({ status: 'ordered', received_by: null, received_at: null, received_qty: null }).eq('id', receipt.order_id).eq('status', 'received'))
      }
      if (resetErr) console.warn('[DELETE receipt] Order reset failed:', resetErr.message)
    }

    // 3) Eliminar el recibo
    const { error: delErr } = await admin.from('stock_receipts').delete().eq('id', receiptId)
    if (delErr) throw delErr

    const userName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null
    logAudit(admin, { userId: user.id, userName, action: 'delete_receipt', module: 'pedidos', entityType: 'stock_receipt', entityId: String(receiptId), description: `Recibo #${receiptId} eliminado${stockReversed ? ` (stock revertido${fudoReversed ? ' en Fudo' : ' solo en LVE'})` : ''}`, metadata: { receiptId, qty: receipt.qty, stock_item_id: receipt.stock_item_id, stockReversed, fudoReversed } }).catch(() => {})

    return NextResponse.json({ success: true, stockReversed, fudoReversed })
  } catch (error) {
    console.error('[DELETE /api/stock/receipts/[id]]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
