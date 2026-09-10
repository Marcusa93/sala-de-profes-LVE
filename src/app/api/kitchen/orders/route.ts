import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyOrderToEncargados } from '@/lib/email/send'
import { logAudit } from '@/lib/audit'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { normalizeToStockUnit, parseTypedUnit } from '@/lib/produccion/units'
import { esErrorColumnaFaltante } from '@/lib/costos/confiable'
import { notifyEvent } from '@/lib/push/notify-event'
import { getConsumptionContextWithTimeout } from '@/lib/stock/consumption'
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
      const { items, urgency, note, supplier_id, initial_status } = body as {
        items: { product_name: string; quantity: string; category?: string; stock_item_id?: string | null }[]
        urgency?: string
        note?: string
        supplier_id?: string | number | null
        /** 'ordered' cuando el pedido ya se le mandó al proveedor en el mismo gesto */
        initial_status?: 'pending' | 'ordered'
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
      const startOrdered = initial_status === 'ordered' && ['encargado', 'socio'].includes(profile.role)
      const nowIso = new Date().toISOString()

      // Insert all items
      const inserts = items.map((item) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        category: (item.category || 'otros') as KitchenOrderCategoryValue,
        urgency: orderUrgency as KitchenOrderUrgencyValue,
        note: note || null,
        created_by: user.id,
        stock_item_id: item.stock_item_id ?? null,
        ...(supplier_id ? { supplier_id } : {}),
        ...(startOrdered ? { status: 'ordered', ordered_at: nowIso } : {}),
      }))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let { error: orderError } = await admin.from('kitchen_orders').insert(inserts as any)
      if (orderError && /ordered_at|stock_item_id/.test(orderError.message)) {
        // Migración pendiente: insertar sin las columnas nuevas
        const legacy = inserts.map((row) => {
          const { ordered_at: _o, stock_item_id: _s, ...rest } = row as Record<string, unknown>
          void _o; void _s
          return rest
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;({ error: orderError } = await admin.from('kitchen_orders').insert(legacy as any))
      }
      if (orderError) throw orderError

      // Pedido enviado en el mismo gesto: fecha de "última vez pedido" del insumo
      if (startOrdered) {
        const linkedIds = items.map((i) => i.stock_item_id).filter((x): x is string => Boolean(x))
        if (linkedIds.length > 0) {
          await admin.from('stock_items').update({ last_ordered_at: nowIso }).in('id', linkedIds).then(() => null, () => null)
        }
      }

      const creatorName = profile
        ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Cocina'
        : 'Cocina'
      const itemsSummary = items.map((i) => `${i.product_name} x ${i.quantity}`).join(', ')
      logAudit(admin, {
        userId: user.id,
        userName: creatorName,
        action: 'create_kitchen_order',
        module: 'pedidos',
        entityType: 'kitchen_order',
        description: `${creatorName} creó pedido de cocina: ${itemsSummary}`,
        metadata: { items, urgency: orderUrgency, note },
      }).catch(() => {})

      // Avisar a los encargados. El announcement es un FEED compartido: queda
      // siempre (aunque el pedido lo cree un encargado/socio, el resto lo ve).
      // Lo único que se evita es autonotificar al CREADOR por email/push.
      {
        // Contexto de consumo semanal por insumo (best-effort: si falla o
        // tarda, las notificaciones salen igual sin esa línea — jamás bloquea)
        let consumptionByName = new Map<string, string>()
        try {
          consumptionByName = await getConsumptionContextWithTimeout(
            admin,
            items.map((i) => i.product_name),
          )
        } catch { /* notificación normal sin contexto */ }

        // Create announcement for encargados
        const authorName = creatorName

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
          .map((i) => {
            const ctx = consumptionByName.get(i.product_name)
            return `• ${i.product_name} — ${i.quantity}${ctx ? ` · ${ctx}` : ''}`
          })
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

        // Email to encargados + socios (sin el creador: no se autonotifica)
        notifyOrderToEncargados({
          type: 'cocina',
          authorName,
          items: items.map((i) => ({ name: i.product_name, quantity: i.quantity })),
          urgency: orderUrgency,
          note,
          excludeUserId: user.id,
        }).catch(() => {})

        const pushSummary = items
          .map((i) => {
            const ctx = consumptionByName.get(i.product_name)
            return `${i.product_name} x ${i.quantity}${ctx ? ` · ${ctx}` : ''}`
          })
          .join(', ')

        notifyEvent(admin, 'purchase_created', {
          title: '🛒 Nuevo pedido de cocina',
          body: `${authorName}: ${pushSummary}`,
          url: '/pedidos',
        }, { excludeUserId: user.id }).catch(() => {})
      }

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

      if (!profile || (profile.role !== 'encargado' && profile.role !== 'socio')) {
        return NextResponse.json({ success: false, error: 'Solo encargados pueden cambiar estado' }, { status: 403 })
      }

      const statusUpdate: Record<string, unknown> = { status }
      if (status === 'ordered') statusUpdate.ordered_at = new Date().toISOString()
      let { error } = await admin
        .from('kitchen_orders')
        .update(statusUpdate)
        .eq('id', orderId)
      if (error && /ordered_at/.test(error.message)) {
        ({ error } = await admin.from('kitchen_orders').update({ status }).eq('id', orderId))
      }

      if (error) throw error

      // El insumo vinculado queda con fecha de "última vez pedido" también
      // cuando el pedido pasa pending→ordered acá (flujo chef propone →
      // encargado envía); antes solo se estampaba al crear ya-enviado.
      // Best-effort y tolerante a migración pendiente de stock_item_id.
      if (status === 'ordered') {
        const { data: ord } = await admin
          .from('kitchen_orders')
          .select('stock_item_id')
          .eq('id', orderId)
          .maybeSingle()
        const sid = (ord as { stock_item_id?: string | null } | null)?.stock_item_id
        if (sid) {
          await admin.from('stock_items').update({ last_ordered_at: new Date().toISOString() }).eq('id', sid).then(() => null, () => null)
        }
      }

      logAudit(admin, {
        userId: user.id,
        userName: null,
        action: 'update_kitchen_order_status',
        module: 'pedidos',
        entityType: 'kitchen_order',
        entityId: String(orderId),
        description: `Pedido de cocina #${orderId} cambiado a "${status}"`,
        metadata: { orderId, status },
      }).catch(() => {})

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

      }

      return NextResponse.json({ success: true })
    }

    // ----- CONFIRM ARRIVAL (encargado/socio) — cierre del ciclo sin duplicar Fudo -----
    // La compra se carga UNA vez, en Fudo (Gastos). Acá el pedido se cierra:
    //   mode 'fudo_expense': la compra ya está en Fudo → LVE NO toca stock, sólo
    //                        vincula el gasto (proveedor, monto, fecha) al pedido.
    //   mode 'lve_stock':    la compra NO se cargó en Fudo → LVE suma la cantidad
    //                        recibida como DELTA sobre el stock actual de Fudo
    //                        (nunca pisa ventas) y deja kardex + recibo con precio.
    //   mode 'sin_stock':    sólo cerrar el pedido (ej. se recibió algo que no es stock).
    if (body.action === 'confirm_arrival') {
      const { orderId, source, mode, expense, receivedQty, unitCost, totalCost, amount, note, paymentMethod, expiresAt } = body as {
        orderId: number
        source: 'cocina' | 'barra'
        mode: 'fudo_expense' | 'lve_stock' | 'sin_stock'
        expense?: { id: string; amount: number } | null
        receivedQty?: string | null
        unitCost?: number | null
        /** lve_stock: total pagado del ticket — si viene, el precio unitario lo deriva el SERVER con la cantidad normalizada */
        totalCost?: number | null
        /** sin_stock: monto del gasto (no es un precio unitario) */
        amount?: number | null
        note?: string | null
        /** efectivo | transferencia | tarjeta | cuenta_corriente */
        paymentMethod?: string | null
        /** solo lve_stock: fecha de vencimiento del lote recibido (YYYY-MM-DD) */
        expiresAt?: string | null
      }
      // cuenta_corriente → queda en cuentas a pagar; el resto → pagado de contado
      const paymentStatus: 'pagado' | 'a_pagar' = paymentMethod === 'cuenta_corriente' ? 'a_pagar' : 'pagado'
      if (typeof orderId !== 'number' || !source || !mode) {
        return NextResponse.json({ success: false, error: 'Faltan datos requeridos' }, { status: 400 })
      }
      // sin_stock tiene su propio campo de monto: unitCost/totalCost se ignoran
      // en ese modo (eran estado compartido del diálogo y llegaban de más).
      const sinStockAmount = mode === 'sin_stock' && typeof amount === 'number' && amount > 0 ? amount : null
      // Con monto en juego, el medio de pago es OBLIGATORIO: sin él, el gasto
      // no deja rastro en cuentas (ni "pagado" ni "a pagar").
      if (mode === 'fudo_expense' && expense && !paymentMethod) {
        return NextResponse.json({ success: false, error: 'Elegí el medio de pago: sin él, el monto no queda en cuentas' }, { status: 400 })
      }
      if (mode === 'sin_stock' && sinStockAmount != null && !paymentMethod) {
        return NextResponse.json({ success: false, error: 'Elegí el medio de pago: sin él, el monto no queda en cuentas' }, { status: 400 })
      }
      const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
      if (!profile || (profile.role !== 'encargado' && profile.role !== 'socio')) {
        return NextResponse.json({ success: false, error: 'Solo encargados pueden confirmar recepciones' }, { status: 403 })
      }
      const table = source === 'barra' ? 'bar_orders' : 'kitchen_orders'
      const { data: order, error: fetchErr } = await admin
        .from(table)
        .select('id, product_name, quantity, status, stock_item_id, supplier_id')
        .eq('id', orderId)
        .single()
      if (fetchErr || !order) return NextResponse.json({ success: false, error: 'Pedido no encontrado' }, { status: 404 })
      if (order.status === 'received') return NextResponse.json({ success: false, error: 'El pedido ya fue recibido' }, { status: 409 })

      // Un gasto de Fudo explica UN pedido: si ya está vinculado a otro
      // (cocina o barra), rechazar antes de tocar nada. Tolerante a migración
      // pendiente de fudo_expense_id (sin la columna no hay nada que chequear).
      if (mode === 'fudo_expense' && expense) {
        for (const t of ['kitchen_orders', 'bar_orders'] as const) {
          const dup = await admin.from(t).select('id').eq('fudo_expense_id', expense.id).limit(1)
          if (dup.error) continue
          if ((dup.data ?? []).length > 0) {
            return NextResponse.json({ success: false, error: 'Ese gasto ya está vinculado a otro pedido' }, { status: 409 })
          }
        }
      }

      let stockUpdated = false
      let fudoSynced = false
      if (mode === 'lve_stock') {
        // Manda lo que eligió la persona en el diálogo: puede corregir el
        // insumo pre-vinculado del pedido (si no, la entrada caía en el item
        // equivocado, en LVE y en Fudo).
        const stockItemId = (body.stockItemId as string | undefined)
          ?? (order as { stock_item_id?: string | null }).stock_item_id
          ?? null
        const numericQty = parseFloat(String(receivedQty ?? '').replace(',', '.'))
        if (!stockItemId || isNaN(numericQty) || numericQty <= 0) {
          return NextResponse.json({ success: false, error: 'Para cargar stock desde acá hace falta el insumo y la cantidad recibida' }, { status: 400 })
        }
        const { data: si } = await admin
          .from('stock_items')
          .select('id, name, unit, current_qty, cost_per_unit, supplier_id')
          .eq('id', stockItemId)
          .single()
        if (!si) return NextResponse.json({ success: false, error: 'Insumo no encontrado' }, { status: 404 })
        const receivedUnit = parseTypedUnit(receivedQty) ?? si.unit
        const normalized = normalizeToStockUnit(numericQty, receivedUnit, si)
        if (!normalized.ok) return NextResponse.json({ success: false, error: normalized.error }, { status: 409 })
        const qty = normalized.qty
        // El TOTAL pagado manda: si vino, el precio unitario lo deriva el
        // SERVER con la cantidad YA normalizada (ignorando el unitCost del
        // cliente). Así el sellado cost_source='compra' nunca depende de la
        // conversión de unidades del navegador ('500 g' → $/kg reales).
        const totalNum = typeof totalCost === 'number' && totalCost > 0 ? totalCost : null
        const costPerUnit = totalNum != null
          ? Math.round((totalNum / qty) * 10000) / 10000
          : (typeof unitCost === 'number' && unitCost > 0 ? unitCost : null)
        // syncToFudo con reason 'reception' escribe por DELTA sobre Fudo y deja kardex
        const write = await syncToFudo(admin, stockItemId, Math.round((Number(si.current_qty ?? 0) + qty) * 100) / 100, user.id, {
          reason: 'reception',
          note: `Recepción: ${order.product_name} (+${qty} ${si.unit})${note ? ` — ${note}` : ''}`,
          costPerUnit,
        })
        if (!write.success) {
          return NextResponse.json({ success: false, error: write.error ?? 'No se pudo actualizar el stock' }, { status: 502 })
        }
        stockUpdated = true
        fudoSynced = write.fudoSynced
        // Recibo (precio de compra) — base del historial de precios + cuentas a pagar
        const receivedDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
        const receiptBase = {
          stock_item_id: stockItemId,
          supplier_id: si.supplier_id ?? (order as { supplier_id?: string | null }).supplier_id ?? null,
          order_source: source,
          order_id: orderId,
          qty,
          unit: si.unit,
          cost_total: totalNum ?? (costPerUnit != null ? Math.round(costPerUnit * qty * 100) / 100 : null),
          cost_per_unit: costPerUnit,
          note: `Pedido: ${order.product_name} (${order.quantity})`,
          received_by: user.id,
          received_date: receivedDate,
        }
        let { error: lveReceiptErr } = await admin.from('stock_receipts').insert({
          ...receiptBase,
          payment_status: paymentStatus,
          paid_at: paymentStatus === 'pagado' ? new Date().toISOString() : null,
          paid_by: paymentStatus === 'pagado' ? user.id : null,
          payment_method: paymentMethod ?? null,
        })
        if (lveReceiptErr && /payment_method|payment_status|paid_at|paid_by/.test(lveReceiptErr.message)) {
          ;({ error: lveReceiptErr } = await admin.from('stock_receipts').insert(receiptBase))
        }
        if (lveReceiptErr) console.warn('[confirm_arrival] lve_stock receipt no registrado:', lveReceiptErr.message)

        // Vencimiento informado → lote para el radar de vencimientos
        if (expiresAt) {
          await admin.from('stock_lots').insert({
            stock_item_id: stockItemId,
            lot_code: `REC-${receivedDate}-${si.name.slice(0, 12).replace(/\s+/g, '').toUpperCase()}`,
            qty_original: qty,
            qty_remaining: qty,
            unit: si.unit,
            produced_at: new Date().toISOString(),
            expires_at: expiresAt,
            status: 'active',
            notes: 'Recepción de mercadería',
            created_by: user.id,
          }).then(({ error }) => { if (error) console.warn('[confirm_arrival] lote no creado:', error.message) })
        }
      }

      // fudo_expense: la compra ya existe en Fudo — LVE NO toca stock, pero
      // crea el recibo (historial de precios + cuentas a pagar) y, si el
      // diálogo dedujo un precio unitario (gasto mono-insumo / cantidad
      // parseable), lo sella como costo REAL del insumo (cost_source 'compra').
      if (mode === 'fudo_expense' && paymentMethod) {
        const supplierId = (order as { supplier_id?: string | null }).supplier_id ?? null
        const receivedDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
        const feStockItemId = (body.stockItemId as string | undefined)
          ?? (order as { stock_item_id?: string | null }).stock_item_id
          ?? null
        const feUnitCost = typeof unitCost === 'number' && unitCost > 0 ? unitCost : null
        let feQty = 1
        let feUnit: string | null = null
        if (feStockItemId) {
          const { data: si } = await admin.from('stock_items').select('id, name, unit').eq('id', feStockItemId).single()
          if (si) {
            feUnit = si.unit
            const parsedQty = parseFloat(String(order.quantity ?? '').replace(',', '.'))
            if (Number.isFinite(parsedQty) && parsedQty > 0) {
              // Misma normalización que lve_stock: '500 g' en un item en kg
              // queda 0.5 kg en el recibo. Si la unidad tipeada no es
              // convertible, el recibo guarda la cantidad EN ESA unidad.
              const typedUnit = parseTypedUnit(order.quantity)
              const norm = normalizeToStockUnit(parsedQty, typedUnit ?? si.unit, si)
              if (norm.ok) {
                feQty = norm.qty
              } else {
                feQty = parsedQty
                feUnit = typedUnit
              }
            }
            if (feUnitCost != null) {
              const { error: costErr } = await admin.from('stock_items').update({
                cost_per_unit: feUnitCost,
                cost_source: 'compra',
                cost_updated_at: new Date().toISOString(),
              }).eq('id', feStockItemId)
              if (costErr && esErrorColumnaFaltante(costErr.message, ['cost_source', 'cost_updated_at'])) {
                await admin.from('stock_items').update({ cost_per_unit: feUnitCost }).eq('id', feStockItemId)
              }
            }
          }
        }
        const receiptBase = {
          stock_item_id: feStockItemId,
          supplier_id: supplierId,
          order_source: source,
          order_id: orderId,
          qty: feQty,
          unit: feUnit,
          cost_total: expense?.amount ?? (feUnitCost != null ? Math.round(feUnitCost * feQty * 100) / 100 : null),
          cost_per_unit: feUnitCost,
          note: `Pedido: ${order.product_name} (${order.quantity})${expense ? ` — Fudo gasto #${expense.id}` : ''}`,
          received_by: user.id,
          received_date: receivedDate,
        }
        let { error: feReceiptErr } = await admin.from('stock_receipts').insert({
          ...receiptBase,
          payment_status: paymentStatus,
          paid_at: paymentStatus === 'pagado' ? new Date().toISOString() : null,
          paid_by: paymentStatus === 'pagado' ? user.id : null,
          payment_method: paymentMethod,
        })
        if (feReceiptErr && /payment_method|payment_status|paid_at|paid_by/.test(feReceiptErr.message)) {
          ;({ error: feReceiptErr } = await admin.from('stock_receipts').insert(receiptBase))
        }
        if (feReceiptErr) console.warn('[confirm_arrival] fudo_expense receipt no registrado:', feReceiptErr.message)
      }

      // sin_stock con monto: dejar registro de gasto para cuentas a pagar
      if (mode === 'sin_stock' && paymentMethod && sinStockAmount != null) {
        const supplierId = (order as { supplier_id?: string | null }).supplier_id ?? null
        const receivedDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
        const receiptBase = {
          stock_item_id: null as string | null,
          supplier_id: supplierId,
          order_source: source,
          order_id: orderId,
          qty: 1,
          unit: null as string | null,
          cost_total: sinStockAmount,
          cost_per_unit: null as number | null,
          note: `Pedido: ${order.product_name} (${order.quantity})`,
          received_by: user.id,
          received_date: receivedDate,
        }
        let { error: ssReceiptErr } = await admin.from('stock_receipts').insert({
          ...receiptBase,
          payment_status: paymentStatus,
          paid_at: paymentStatus === 'pagado' ? new Date().toISOString() : null,
          paid_by: paymentStatus === 'pagado' ? user.id : null,
          payment_method: paymentMethod,
        })
        if (ssReceiptErr && /payment_method|payment_status|paid_at|paid_by/.test(ssReceiptErr.message)) {
          ;({ error: ssReceiptErr } = await admin.from('stock_receipts').insert(receiptBase))
        }
        if (ssReceiptErr) console.warn('[confirm_arrival] sin_stock receipt no registrado:', ssReceiptErr.message)
      }

      const { closeOrderWithExpense } = await import('@/lib/compras/conciliar')
      const closed = await closeOrderWithExpense(admin, {
        orderId,
        source,
        userId: user.id,
        expense: mode === 'fudo_expense' ? (expense ?? null) : null,
        mode,
        note: note ?? null,
        receivedQty: receivedQty ?? null,
      })
      if (!closed.success) throw new Error(closed.error)

      const who = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
      logAudit(admin, {
        userId: user.id,
        userName: who,
        action: 'confirm_arrival',
        module: 'pedidos',
        entityType: table,
        entityId: String(orderId),
        description: mode === 'fudo_expense'
          ? `Llegó pedido #${orderId} (${order.product_name}) — compra cargada en Fudo${expense ? ` ($${expense.amount.toLocaleString('es-AR')}, gasto #${expense.id})` : ''}${paymentMethod ? ` · ${paymentMethod}` : ''}`
          : mode === 'lve_stock'
            ? `Llegó pedido #${orderId} (${order.product_name}) — stock cargado desde LVE (${receivedQty})${paymentMethod ? ` · ${paymentMethod}` : ''}`
            : `Llegó pedido #${orderId} (${order.product_name}) — sin movimiento de stock`,
        metadata: { orderId, source, mode, expense: expense ?? null, receivedQty: receivedQty ?? null, unitCost: unitCost ?? null, totalCost: totalCost ?? null, amount: sinStockAmount, expiresAt: expiresAt ?? null, note: note ?? null, stockUpdated, paymentMethod: paymentMethod ?? null },
      }).catch(() => {})

      return NextResponse.json({ success: true, stockUpdated, fudoSynced, mode })
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
