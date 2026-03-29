import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyOrderToEncargados } from '@/lib/email/send'
import type { KitchenOrderCategoryValue, KitchenOrderUrgencyValue, PriorityValue } from '@/types/database'

// ---------------------------------------------------------------------------
// POST /api/kitchen/orders
// ---------------------------------------------------------------------------
// Operaciones de pedidos de cocina: crear pedido, listar, cambiar estado.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
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

    // ----- CREATE ORDER (single or batch) -----
    if (body.action === 'create_order') {
      const { items, urgency, note } = body as {
        items: { product_name: string; quantity: string; category?: string }[]
        urgency?: string
        note?: string
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ success: false, error: 'Se requiere al menos un producto' }, { status: 400 })
      }

      // Get user profile
      const { data: profile } = await admin
        .from('profiles')
        .select('first_name, last_name, role')
        .eq('id', user.id)
        .single()

      const allowedRoles = ['chef', 'cocina', 'encargado', 'socio']
      if (!profile || !allowedRoles.includes(profile.role)) {
        return NextResponse.json({ success: false, error: 'No tenés permiso para crear pedidos' }, { status: 403 })
      }

      const orderUrgency = urgency || 'normal'

      // Insert all items
      const inserts = items.map((item) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        category: (item.category || 'verduleria') as KitchenOrderCategoryValue,
        urgency: orderUrgency as KitchenOrderUrgencyValue,
        note: note || null,
        created_by: user.id,
      }))

      const { error: orderError } = await admin.from('kitchen_orders').insert(inserts)
      if (orderError) throw orderError

      // Create announcement for encargados
      const authorName = profile
        ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Cocina'
        : 'Cocina'

      const priorityMap: Record<string, string> = {
        normal: 'media',
        alta: 'alta',
        urgente: 'critica',
      }
      const urgencyLabels: Record<string, string> = {
        normal: 'Normal',
        alta: 'Alta',
        urgente: 'Urgente',
      }

      const itemsList = items
        .map((i) => `• ${i.product_name} — ${i.quantity}`)
        .join('\n')

      await admin.from('announcements').insert({
        author_id: user.id,
        type: 'operativo',
        priority: (priorityMap[orderUrgency] || 'media') as PriorityValue,
        title: `🍳 Pedido de Cocina — ${urgencyLabels[orderUrgency] || 'Normal'}`,
        body: `${authorName} solicita:\n${itemsList}${note ? `\n\nNota: ${note}` : ''}`,
        scope: 'role',
        target_role: 'encargado',
        is_active: true,
      })

      // Email to encargados + socios
      notifyOrderToEncargados({
        type: 'cocina',
        authorName,
        items: items.map((i) => ({ name: i.product_name, quantity: i.quantity })),
        urgency: orderUrgency,
        note,
      }).catch(() => {})

      return NextResponse.json({ success: true, count: items.length })
    }

    // ----- LIST ORDERS -----
    if (body.action === 'list_orders') {
      const { status: filterStatus } = body
      let query = admin
        .from('kitchen_orders')
        .select('*, profiles:created_by(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(50)

      if (filterStatus) {
        query = query.eq('status', filterStatus)
      }

      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ success: true, orders: data })
    }

    // ----- UPDATE ORDER STATUS (encargado only) -----
    if (body.action === 'update_status') {
      const { orderId, status } = body
      if (typeof orderId !== 'number' || !status) {
        return NextResponse.json({ success: false, error: 'orderId y status requeridos' }, { status: 400 })
      }

      // Check encargado role
      const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (!profile || profile.role !== 'encargado' && profile.role !== 'socio') {
        return NextResponse.json({ success: false, error: 'Solo encargados pueden cambiar estado' }, { status: 403 })
      }

      const { error } = await admin
        .from('kitchen_orders')
        .update({ status })
        .eq('id', orderId)

      if (error) throw error

      // Notify the order creator about status change
      if (status === 'ordered' || status === 'received' || status === 'cancelled') {
        const { data: order } = await admin
          .from('kitchen_orders')
          .select('created_by, product_name, quantity')
          .eq('id', orderId)
          .single()

        if (order?.created_by) {
          const titleMap: Record<string, string> = {
            ordered: '✅ Pedido enviado al proveedor',
            received: '📦 Pedido recibido',
            cancelled: '❌ Pedido cancelado',
          }
          const bodyMap: Record<string, string> = {
            ordered: `${order.product_name} (${order.quantity}) — tu pedido fue enviado al proveedor`,
            received: `${order.product_name} (${order.quantity}) — ya llegó, stock actualizado`,
            cancelled: `${order.product_name} (${order.quantity}) — fue cancelado`,
          }
          await admin.from('announcements').insert({
            author_id: user.id,
            type: 'operativo',
            priority: 'baja',
            title: titleMap[status] ?? `Pedido ${status}`,
            body: bodyMap[status] ?? `${order.product_name} — ${status}`,
            scope: 'user',
            target_user_id: order.created_by,
            is_active: true,
          })

          // Email to order creator
          try {
            const { notifyOrderStatusChange } = await import('@/lib/email/send')
            notifyOrderStatusChange({
              userId: order.created_by,
              productName: order.product_name,
              quantity: order.quantity,
              newStatus: status as 'ordered' | 'received' | 'cancelled',
            }).catch(() => {})
          } catch { /* email optional */ }
        }

        // When received: update stock_items — multi-strategy match
        if (status === 'received' && order) {
          const qtyNum = parseFloat(String(order.quantity).replace(/[^\d.,]/g, '')) || 0
          if (qtyNum > 0) {
            const productName = order.product_name.toLowerCase().trim()

            // Strategy 1: Exact match by name
            const { data: exactMatches } = await admin
              .from('stock_items')
              .select('id, name, current_qty')
              .ilike('name', productName)

            let matched = exactMatches?.find(
              (m) => m.name.toLowerCase().trim() === productName
            )

            // Strategy 2: Contains match (product name contains stock name or vice versa)
            if (!matched) {
              const { data: allItems } = await admin
                .from('stock_items')
                .select('id, name, current_qty')
                .eq('is_active', true)

              matched = allItems?.find((m) => {
                const stockName = m.name.toLowerCase().trim()
                return stockName.includes(productName) || productName.includes(stockName)
              })
            }

            if (matched) {
              await admin
                .from('stock_items')
                .update({ current_qty: (matched.current_qty || 0) + qtyNum })
                .eq('id', matched.id)
            }
          }
        }
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Acción no reconocida' }, { status: 400 })
  } catch (error) {
    console.error('[/api/kitchen/orders] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
