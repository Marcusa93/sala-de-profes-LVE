// ---------------------------------------------------------------------------
// AI Purchase Order — copiloto de compras
// ---------------------------------------------------------------------------
// Groups critical stock items by supplier, suggests quantities,
// and generates ready-to-send messages via AI.
// Never sends automatically — always requires human confirmation.
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PurchaseItem = {
  item_id: string
  item_name: string
  category: string
  unit: string
  current_qty: number
  min_qty: number
  suggested_qty: number
  reasoning: string
  priority_score: number
}

export type PurchaseOrder = {
  supplier_id: string
  supplier_name: string
  supplier_phone: string | null
  supplier_email: string | null
  items: PurchaseItem[]
  total_items: number
  priority: 'alta' | 'media' | 'baja'
  priority_score: number
  message: string | null // AI-generated
}

export type PurchaseOrderResult = {
  orders: PurchaseOrder[]
  unassigned: PurchaseItem[] // items without supplier
  generatedAt: string
  sources: string[]
}

// ---------------------------------------------------------------------------
// Sensitive categories — need extra buffer
// ---------------------------------------------------------------------------

const SENSITIVE_CATEGORIES = new Set(['bebidas', 'lacteos', 'carnes', 'verduras', 'frutas'])

// ---------------------------------------------------------------------------
// Suggest quantity — conservative, based on real data only
// ---------------------------------------------------------------------------

function suggestQuantity(item: {
  current_qty: number
  min_qty: number
  category: string
}): { qty: number; reasoning: string } {
  const { current_qty, min_qty, category } = item
  const isSensitive = SENSITIVE_CATEGORIES.has(category)
  const buffer = isSensitive ? 1.3 : 1.15 // 30% or 15% buffer

  if (current_qty === 0) {
    const suggested = Math.ceil(min_qty * buffer)
    return {
      qty: Math.max(suggested, 1),
      reasoning: `Sin stock. Sugerido: mínimo (${min_qty}) + ${isSensitive ? '30%' : '15%'} buffer`,
    }
  }

  if (current_qty < min_qty) {
    const deficit = min_qty - current_qty
    const suggested = Math.ceil(deficit * buffer)
    return {
      qty: Math.max(suggested, 1),
      reasoning: `Faltante: ${deficit} unidades para llegar al mínimo${isSensitive ? ' + buffer por categoría sensible' : ''}`,
    }
  }

  if (current_qty <= min_qty * 1.2) {
    const suggested = Math.ceil((min_qty * buffer) - current_qty)
    return {
      qty: Math.max(suggested, 1),
      reasoning: 'Cerca del mínimo — compra preventiva',
    }
  }

  return { qty: 0, reasoning: 'Sin necesidad de compra inmediata' }
}

// ---------------------------------------------------------------------------
// Calculate priority from items
// ---------------------------------------------------------------------------

function calculateOrderPriority(items: PurchaseItem[]): { priority: PurchaseOrder['priority']; score: number } {
  if (items.length === 0) return { priority: 'baja', score: 0 }
  const maxScore = Math.max(...items.map(i => i.priority_score))
  const avgScore = items.reduce((s, i) => s + i.priority_score, 0) / items.length
  const score = Math.round(maxScore * 0.7 + avgScore * 0.3)
  if (score >= 50) return { priority: 'alta', score }
  if (score >= 25) return { priority: 'media', score }
  return { priority: 'baja', score }
}

// ---------------------------------------------------------------------------
// Priority score per item (same logic as stock-priorities but inline)
// ---------------------------------------------------------------------------

function itemPriorityScore(item: { current_qty: number; min_qty: number; category: string; supplier_id: string | null }): number {
  let score = 0
  if (item.current_qty === 0) score += 50
  else if (item.current_qty <= item.min_qty) {
    const deficitPct = item.min_qty > 0 ? (item.min_qty - item.current_qty) / item.min_qty : 1
    score += 20 + Math.round(deficitPct * 25)
  } else if (item.current_qty <= item.min_qty * 1.2) {
    score += 10
  }
  if (!item.supplier_id) score += 20
  if (SENSITIVE_CATEGORIES.has(item.category)) score += 10
  return Math.min(score, 100)
}

// ---------------------------------------------------------------------------
// Generate purchase orders grouped by supplier
// ---------------------------------------------------------------------------

export async function generatePurchaseOrders(): Promise<PurchaseOrderResult> {
  const admin = createAdminClient()

  // Fetch stock items that need attention (below minimum * 1.2)
  const { data: items } = await admin
    .from('stock_items')
    .select('id, name, category, unit, current_qty, min_qty, supplier_id, suppliers(id, name, phone, email)')
    .eq('is_active', true)

  if (!items) return { orders: [], unassigned: [], generatedAt: new Date().toISOString(), sources: [] }

  // Filter to items that need replenishment
  const needsOrder = items.filter(i => i.current_qty <= i.min_qty * 1.2 && i.min_qty > 0)

  // Build purchase items
  const purchaseItems: (PurchaseItem & { supplier_id: string | null; supplier_data: { id: string; name: string; phone: string | null; email: string | null } | null })[] =
    needsOrder.map(item => {
      const { qty, reasoning } = suggestQuantity(item)
      const supplierData = item.suppliers as { id: string; name: string; phone: string | null; email: string | null } | null
      return {
        item_id: item.id,
        item_name: item.name,
        category: item.category,
        unit: item.unit ?? 'unidad',
        current_qty: item.current_qty,
        min_qty: item.min_qty,
        suggested_qty: qty,
        reasoning,
        priority_score: itemPriorityScore(item),
        supplier_id: item.supplier_id,
        supplier_data: supplierData,
      }
    })
    .filter(i => i.suggested_qty > 0)
    .sort((a, b) => b.priority_score - a.priority_score)

  // Separate assigned vs unassigned
  const assigned = purchaseItems.filter(i => i.supplier_id && i.supplier_data)
  const unassigned: PurchaseItem[] = purchaseItems
    .filter(i => !i.supplier_id)
    .map(({ supplier_id, supplier_data, ...rest }) => rest)

  // Group by supplier
  const supplierGroups = new Map<string, { supplier: { id: string; name: string; phone: string | null; email: string | null }; items: PurchaseItem[] }>()

  for (const item of assigned) {
    const sid = item.supplier_id!
    if (!supplierGroups.has(sid)) {
      supplierGroups.set(sid, { supplier: item.supplier_data!, items: [] })
    }
    const { supplier_id, supplier_data, ...purchaseItem } = item
    supplierGroups.get(sid)!.items.push(purchaseItem)
  }

  // Build orders
  const orders: PurchaseOrder[] = Array.from(supplierGroups.values())
    .map(({ supplier, items: orderItems }) => {
      const { priority, score } = calculateOrderPriority(orderItems)
      return {
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        supplier_phone: supplier.phone,
        supplier_email: supplier.email,
        items: orderItems,
        total_items: orderItems.length,
        priority,
        priority_score: score,
        message: null, // Generated separately via AI
      }
    })
    .sort((a, b) => b.priority_score - a.priority_score)

  return {
    orders,
    unassigned,
    generatedAt: new Date().toISOString(),
    sources: ['supabase:stock_items', 'supabase:suppliers'],
  }
}

// ---------------------------------------------------------------------------
// AI message generation for a single supplier order
// ---------------------------------------------------------------------------

export async function generateOrderMessage(order: PurchaseOrder): Promise<string> {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY

  // Build items list
  const itemsList = order.items
    .map(i => `- ${i.item_name} x ${i.suggested_qty} ${i.unit}`)
    .join('\n')

  // Fallback — structured text without AI
  const fallback = `Hola ${order.supplier_name}, necesito reponer:\n\n${itemsList}\n\n¿Podés confirmarme disponibilidad y tiempos de entrega? Gracias.`

  if (!OPENROUTER_KEY) return fallback

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content: `Redactá un mensaje breve para pedir mercadería a un proveedor. Tono: profesional pero cercano, como un WhatsApp de trabajo. Español argentino. No uses markdown ni emojis. El mensaje es para ${order.supplier_name}. Incluí la lista de items exacta que te paso. Cerrá pidiendo confirmación de disponibilidad y tiempos.`,
          },
          {
            role: 'user',
            content: `Items a pedir:\n${itemsList}\n\nPrioridad: ${order.priority}`,
          },
        ],
      }),
    })

    if (!res.ok) return fallback
    const json = await res.json()
    return json.choices?.[0]?.message?.content?.trim() ?? fallback
  } catch {
    return fallback
  }
}
