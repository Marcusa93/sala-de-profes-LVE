import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyOrderToEncargados, notifyOrderStatusChange } from '@/lib/email/send'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// POST /api/kitchen/bar
// ---------------------------------------------------------------------------
// Operaciones de barra: actualizar stock, crear pedido, cambiar estado pedido.
// Usa admin client para bypasear RLS.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || !body.action) {
      return NextResponse.json({ success: false, error: 'Acción requerida' }, { status: 400 })
    }

    const admin = createAdminClient()

    // ----- UPDATE STOCK QTY -----
    if (body.action === 'update_stock') {
      const { itemId, qty, detail, isUrgent } = body
      if (typeof itemId !== 'number') {
        return NextResponse.json({ success: false, error: 'itemId requerido' }, { status: 400 })
      }

      const { error } = await admin
        .from('bar_stock_items')
        .update({
          current_qty: qty ?? 0,
          current_detail: detail || null,
          is_urgent: isUrgent ?? false,
        })
        .eq('id', itemId)

      if (error) throw error

      logAudit(admin, {
        userId: user.id,
        userName: null,
        action: 'update_bar_stock',
        module: 'barra',
        entityType: 'bar_stock_item',
        entityId: String(itemId),
        description: `Stock de barra item #${itemId} actualizado a ${qty ?? 0}`,
        metadata: { itemId, qty, detail, isUrgent },
      }).catch(() => {})

      return NextResponse.json({ success: true })
    }

    // ----- CREATE ORDER -----
    if (body.action === 'create_order') {
      const { barStockItemId, productName, category, quantity, urgency, note } = body

      // Role check: only barista, cocina, encargado, socio can create bar orders
      const { data: creatorProfile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      const allowedBarRoles = ['barista', 'cocina', 'encargado', 'socio']
      if (!creatorProfile || !allowedBarRoles.includes(creatorProfile.role)) {
        return NextResponse.json({ success: false, error: 'No tenés permiso para crear pedidos de barra' }, { status: 403 })
      }

      // 1) Insert bar_order
      // Table columns: id, product_name, category, quantity, urgency, status, note, requested_by, created_at, updated_at
      // DB urgency constraint: normal, low, high, critical
      // Frontend sends: normal, alta, urgente → map to DB values
      const urgencyMap: Record<string, string> = {
        normal: 'normal',
        alta: 'high',
        urgente: 'critical',
      }
      const dbUrgency = urgencyMap[urgency] || urgency || 'normal'

      const { error: orderError } = await admin.from('bar_orders').insert({
        bar_stock_item_id: barStockItemId ?? null,
        product_name: productName,
        category: category,
        quantity: quantity,
        urgency: dbUrgency,
        note: note || null,
        requested_by: user.id,
      })
      if (orderError) throw orderError

      logAudit(admin, {
        userId: user.id,
        userName: null,
        action: 'create_bar_order',
        module: 'barra',
        entityType: 'bar_order',
        description: `Pedido de barra creado: ${productName} x ${quantity}`,
        metadata: { productName, category, quantity, urgency, note },
      }).catch(() => {})

      // 2) Create announcement for encargado
      const urgencyLabels: Record<string, string> = {
        normal: 'Normal',
        alta: 'Alta',
        urgente: 'Urgente',
      }
      const priorityMap: Record<string, string> = {
        normal: 'media',
        alta: 'alta',
        urgente: 'critica',
      }

      // Get user name from profile
      const { data: profile } = await admin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', user.id)
        .single()

      const authorName = profile
        ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Barista'
        : 'Barista'

      await admin.from('announcements').insert({
        author_id: user.id,
        type: 'operativo',
        priority: priorityMap[urgency] || 'media',
        title: `☕ Pedido de Barra — ${urgencyLabels[urgency] || 'Normal'}`,
        body: `${authorName} solicita: ${productName} — ${quantity}${note ? `\nNota: ${note}` : ''}`,
        scope: 'role',
        target_role: 'encargado',
        is_active: true,
      })

      // Email to encargados + socios
      notifyOrderToEncargados({
        type: 'barra',
        authorName,
        items: [{ name: productName, quantity }],
        urgency: urgency || 'normal',
        note,
      }).catch(() => {})

      return NextResponse.json({ success: true })
    }

    // ----- UPDATE ORDER STATUS -----
    if (body.action === 'update_order_status') {
      const { orderId, status } = body
      if (typeof orderId !== 'number' || !status) {
        return NextResponse.json({ success: false, error: 'orderId y status requeridos' }, { status: 400 })
      }

      const { error } = await admin
        .from('bar_orders')
        .update({ status })
        .eq('id', orderId)

      if (error) throw error

      logAudit(admin, {
        userId: user.id,
        userName: null,
        action: 'update_bar_order_status',
        module: 'barra',
        entityType: 'bar_order',
        entityId: String(orderId),
        description: `Pedido de barra #${orderId} cambiado a "${status}"`,
        metadata: { orderId, status },
      }).catch(() => {})

      // Notify the order creator about status change
      if (status === 'ordered' || status === 'received' || status === 'cancelled') {
        const { data: order } = await admin
          .from('bar_orders')
          .select('requested_by, product_name, quantity')
          .eq('id', orderId)
          .single()

        // NOTE: Stock does NOT auto-update on "received".
        // The barista manually updates stock after verifying the delivery.

        if (order?.requested_by) {
          const titleMap: Record<string, string> = {
            ordered: '✅ Pedido enviado al proveedor',
            received: '📦 Mercadería recibida — actualizá stock',
            cancelled: '❌ Pedido cancelado',
          }
          const bodyMap: Record<string, string> = {
            ordered: `${order.product_name} (${order.quantity}) — el encargado ya lo pidió al proveedor`,
            received: `${order.product_name} (${order.quantity}) — ya llegó. Revisá y actualizá el stock de barra.`,
            cancelled: `${order.product_name} (${order.quantity}) — fue cancelado`,
          }
          await admin.from('announcements').insert({
            author_id: user.id,
            type: 'operativo',
            priority: status === 'received' ? 'alta' : 'baja',
            title: titleMap[status] ?? `Pedido ${status}`,
            body: bodyMap[status] ?? `${order.product_name} — ${status}`,
            scope: 'user',
            target_user_id: order.requested_by,
            is_active: true,
          })

          // Email to order creator
          notifyOrderStatusChange({
            userId: order.requested_by,
            productName: order.product_name,
            quantity: order.quantity,
            newStatus: status as 'ordered' | 'received' | 'cancelled',
          }).catch(() => {})
        }
      }

      return NextResponse.json({ success: true })
    }

    // ----- UPDATE SUPPLIER -----
    if (body.action === 'update_supplier') {
      const { itemId, supplierId } = body
      if (typeof itemId !== 'number') {
        return NextResponse.json({ success: false, error: 'itemId requerido' }, { status: 400 })
      }

      const { error } = await admin
        .from('bar_stock_items')
        .update({ supplier_id: supplierId || null })
        .eq('id', itemId)

      if (error) throw error

      logAudit(admin, {
        userId: user.id,
        userName: null,
        action: 'update_bar_item_supplier',
        module: 'barra',
        entityType: 'bar_stock_item',
        entityId: String(itemId),
        description: `Proveedor de item de barra #${itemId} actualizado a ${supplierId || 'ninguno'}`,
        metadata: { itemId, supplierId },
      }).catch(() => {})

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Acción no reconocida' }, { status: 400 })
  } catch (error) {
    console.error('[/api/kitchen/bar] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
