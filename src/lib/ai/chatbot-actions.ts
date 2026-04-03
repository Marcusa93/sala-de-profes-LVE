// ---------------------------------------------------------------------------
// Chatbot Actions Engine
// ---------------------------------------------------------------------------
// Handles action detection, validation, and execution from chatbot messages.
// The chatbot API calls this when it detects an actionable intent.
//
// PRINCIPLES:
// - Always confirm with the user before executing
// - Always check for duplicates
// - Always match product names to real stock items
// - Always log to audit_trail
// - Never modify stock directly
// - Never send emails (only in-app notifications)
// ---------------------------------------------------------------------------

import { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionIntent =
  | 'PEDIDO_MERCADERIA'
  | 'ACTUALIZAR_STOCK'
  | 'REPORTE_PROBLEMA'
  | 'AVISO_ENCARGADO'
  | 'CONSULTA'
  | 'NONE'

export type ExtractedItem = {
  rawName: string
  quantity: string
  matchedStockId?: string | number
  matchedStockName?: string
  matchConfidence: 'exact' | 'probable' | 'none'
}

export type ActionProposal = {
  intent: ActionIntent
  items: ExtractedItem[]
  message?: string // For reports/announcements
  urgency?: 'normal' | 'alta' | 'urgente'
  duplicateWarnings: string[]
  confirmationText: string
  readyToExecute: boolean
}

export type ActionResult = {
  success: boolean
  created: number
  details: string[]
  errors: string[]
}

// ---------------------------------------------------------------------------
// 1. Detect Intent — called by the chatbot with the AI's structured response
// ---------------------------------------------------------------------------

export function detectIntent(aiAnalysis: {
  intent: string
  items?: { name: string; quantity: string }[]
  message?: string
  urgency?: string
}): ActionIntent {
  const intent = (aiAnalysis.intent || '').toUpperCase().replace(/\s+/g, '_')

  if (intent.includes('ACTUALIZAR') || intent.includes('CARGAR') || intent.includes('UPDATE_STOCK') || intent.includes('STOCK_UPDATE')) {
    return 'ACTUALIZAR_STOCK'
  }
  if (intent.includes('PEDIDO') || intent.includes('ORDER') || intent.includes('NECESITO') || intent.includes('FALTA')) {
    return 'PEDIDO_MERCADERIA'
  }
  if (intent.includes('REPORT') || intent.includes('PROBLEMA') || intent.includes('ROTO') || intent.includes('ROMPIÓ')) {
    return 'REPORTE_PROBLEMA'
  }
  if (intent.includes('AVISO') || intent.includes('AVISALE') || intent.includes('DECILE') || intent.includes('COMUNIC')) {
    return 'AVISO_ENCARGADO'
  }
  if (intent.includes('CONSULT') || intent.includes('CUANTO') || intent.includes('QUE_HAY')) {
    return 'CONSULTA'
  }
  return 'NONE'
}

// ---------------------------------------------------------------------------
// 2. Match Items — find stock items that match the user's names
// ---------------------------------------------------------------------------

export async function matchItems(
  admin: SupabaseClient,
  rawItems: { name: string; quantity: string }[],
  source: 'cocina' | 'barra',
): Promise<ExtractedItem[]> {
  // Fetch the appropriate stock table
  let stockItems: { id: string | number; name: string }[]

  if (source === 'barra') {
    const { data } = await admin
      .from('bar_stock_items')
      .select('id, name')
      .eq('is_active', true)
    stockItems = (data ?? []) as { id: number; name: string }[]
  } else {
    const { data } = await admin
      .from('stock_items')
      .select('id, name')
      .eq('is_active', true)
    stockItems = (data ?? []) as { id: string; name: string }[]
  }

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

  const stockByNorm = new Map(stockItems.map(si => [norm(si.name), si]))

  return rawItems.map(raw => {
    const n = norm(raw.name)

    // Exact match
    if (stockByNorm.has(n)) {
      const match = stockByNorm.get(n)!
      return {
        rawName: raw.name,
        quantity: raw.quantity,
        matchedStockId: match.id,
        matchedStockName: match.name,
        matchConfidence: 'exact' as const,
      }
    }

    // Contains match (both directions)
    for (const [key, si] of stockByNorm) {
      if (key.includes(n) || n.includes(key)) {
        return {
          rawName: raw.name,
          quantity: raw.quantity,
          matchedStockId: si.id,
          matchedStockName: si.name,
          matchConfidence: 'probable' as const,
        }
      }
    }

    // First significant word match
    const mainWord = n.split(/\s+/).filter(w => w.length > 3)[0]
    if (mainWord) {
      for (const [key, si] of stockByNorm) {
        if (key.startsWith(mainWord) || mainWord.startsWith(key.split(/\s+/)[0])) {
          return {
            rawName: raw.name,
            quantity: raw.quantity,
            matchedStockId: si.id,
            matchedStockName: si.name,
            matchConfidence: 'probable' as const,
          }
        }
      }
    }

    // No match
    return {
      rawName: raw.name,
      quantity: raw.quantity,
      matchConfidence: 'none' as const,
    }
  })
}

// ---------------------------------------------------------------------------
// 3. Check Duplicates — verify no pending orders exist for these items
// ---------------------------------------------------------------------------

export async function checkDuplicates(
  admin: SupabaseClient,
  items: ExtractedItem[],
  source: 'cocina' | 'barra',
): Promise<string[]> {
  const warnings: string[] = []
  const table = source === 'barra' ? 'bar_orders' : 'kitchen_orders'

  const { data: pendingOrders } = await admin
    .from(table)
    .select('product_name, quantity, status')
    .in('status', ['pending', 'ordered'])

  if (!pendingOrders?.length) return warnings

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

  for (const item of items) {
    const itemNorm = norm(item.matchedStockName ?? item.rawName)
    const existingOrder = pendingOrders.find(o => {
      const orderNorm = norm(o.product_name)
      return orderNorm === itemNorm || orderNorm.includes(itemNorm) || itemNorm.includes(orderNorm)
    })
    if (existingOrder) {
      warnings.push(
        `Ya hay un pedido pendiente de "${existingOrder.product_name}" (${existingOrder.quantity}, estado: ${existingOrder.status})`
      )
    }
  }

  return warnings
}

// ---------------------------------------------------------------------------
// 4. Build Proposal — create the confirmation message
// ---------------------------------------------------------------------------

export async function buildProposal(
  admin: SupabaseClient,
  intent: ActionIntent,
  rawItems: { name: string; quantity: string }[],
  message: string | undefined,
  urgency: string | undefined,
  userRole: string,
): Promise<ActionProposal> {
  const source: 'cocina' | 'barra' = userRole === 'barista' ? 'barra' : 'cocina'

  if (intent === 'PEDIDO_MERCADERIA') {
    const matched = await matchItems(admin, rawItems, source)
    const duplicates = await checkDuplicates(admin, matched, source)

    const itemLines = matched.map(i => {
      const name = i.matchedStockName ?? i.rawName
      const confidence = i.matchConfidence === 'exact' ? '' :
        i.matchConfidence === 'probable' ? ' (coincidencia probable)' : ' ⚠️ no encontrado en stock'
      return `• **${name}** — ${i.quantity}${confidence}`
    })

    let confirmText = `📋 **Pedido para el encargado:**\n${itemLines.join('\n')}`
    if (duplicates.length > 0) {
      confirmText += `\n\n⚠️ **Atención:**\n${duplicates.map(d => `• ${d}`).join('\n')}`
      confirmText += `\n\n¿Querés enviarlo igual o modificar algo?`
    } else {
      confirmText += `\n\n¿Lo envío al encargado?`
    }

    return {
      intent,
      items: matched,
      urgency: (urgency as 'normal' | 'alta' | 'urgente') ?? 'normal',
      duplicateWarnings: duplicates,
      confirmationText: confirmText,
      readyToExecute: false, // Needs user confirmation
    }
  }

  if (intent === 'ACTUALIZAR_STOCK') {
    const source: 'cocina' | 'barra' = userRole === 'barista' ? 'barra' : 'cocina'
    const matched = await matchItems(admin, rawItems, source)

    const itemLines = matched.map(i => {
      const name = i.matchedStockName ?? i.rawName
      const confidence = i.matchConfidence === 'exact' ? '' :
        i.matchConfidence === 'probable' ? ' (coincidencia probable)' : ' ⚠️ no encontrado en stock'
      return `• **${name}** → ${i.quantity}${confidence}`
    })

    const unmatchedCount = matched.filter(i => i.matchConfidence === 'none').length

    let confirmText = `📦 **Actualizar stock:**\n${itemLines.join('\n')}`
    if (unmatchedCount > 0) {
      confirmText += `\n\n⚠️ ${unmatchedCount} item${unmatchedCount > 1 ? 's' : ''} no encontrado${unmatchedCount > 1 ? 's' : ''} en el sistema`
    }
    confirmText += `\n\nEsto actualiza las cantidades en la webapp y en Fudo. ¿Confirmo?`

    return {
      intent,
      items: matched,
      duplicateWarnings: [],
      confirmationText: confirmText,
      readyToExecute: false,
    }
  }

  if (intent === 'REPORTE_PROBLEMA') {
    return {
      intent,
      items: [],
      message: message ?? '',
      urgency: 'urgente',
      duplicateWarnings: [],
      confirmationText: `⚠️ **Reportar problema:**\n"${message}"\n\nEsto crea un aviso urgente para los encargados. ¿Confirmo?`,
      readyToExecute: false,
    }
  }

  if (intent === 'AVISO_ENCARGADO') {
    return {
      intent,
      items: [],
      message: message ?? '',
      urgency: (urgency as 'normal' | 'alta' | 'urgente') ?? 'normal',
      duplicateWarnings: [],
      confirmationText: `📢 **Aviso para encargados:**\n"${message}"\n\n¿Lo envío?`,
      readyToExecute: false,
    }
  }

  return {
    intent: 'NONE',
    items: [],
    duplicateWarnings: [],
    confirmationText: '',
    readyToExecute: false,
  }
}

// ---------------------------------------------------------------------------
// 5. Execute Action — actually creates records in the database
// ---------------------------------------------------------------------------

export async function executeAction(
  admin: SupabaseClient,
  proposal: ActionProposal,
  userId: string,
  userName: string,
  userRole: string,
): Promise<ActionResult> {
  const result: ActionResult = { success: true, created: 0, details: [], errors: [] }

  try {
    if (proposal.intent === 'PEDIDO_MERCADERIA') {
      const source: 'cocina' | 'barra' = userRole === 'barista' ? 'barra' : 'cocina'

      for (const item of proposal.items) {
        const productName = item.matchedStockName ?? item.rawName

        if (source === 'barra') {
          const { error } = await admin.from('bar_orders').insert({
            product_name: productName,
            category: 'general',
            quantity: item.quantity,
            urgency: proposal.urgency ?? 'normal',
            status: 'pending',
            bar_stock_item_id: typeof item.matchedStockId === 'number' ? item.matchedStockId : null,
            requested_by: userId,
          })
          if (error) {
            result.errors.push(`Error al pedir ${productName}: ${error.message}`)
          } else {
            result.created++
            result.details.push(`${productName} × ${item.quantity}`)
          }
        } else {
          const { error } = await admin.from('kitchen_orders').insert({
            product_name: productName,
            category: 'general',
            quantity: item.quantity,
            urgency: proposal.urgency ?? 'normal',
            status: 'pending',
            created_by: userId,
          })
          if (error) {
            result.errors.push(`Error al pedir ${productName}: ${error.message}`)
          } else {
            result.created++
            result.details.push(`${productName} × ${item.quantity}`)
          }
        }
      }

      // Create notification for encargados
      if (result.created > 0) {
        const itemList = result.details.join(', ')
        const icon = source === 'barra' ? '☕' : '🍳'
        await admin.from('announcements').insert({
          author_id: userId,
          type: 'operativo',
          priority: proposal.urgency === 'urgente' ? 'critica' : proposal.urgency === 'alta' ? 'alta' : 'media',
          title: `${icon} Pedido de ${source === 'barra' ? 'Barra' : 'Cocina'} (vía chat)`,
          body: `${userName} solicita: ${itemList}`,
          scope: 'role',
          target_role: 'encargado',
          is_active: true,
        })
      }

      // Audit trail
      await admin.from('audit_trail').insert({
        user_id: userId,
        user_name: userName,
        action: 'chatbot_order',
        module: source === 'barra' ? 'barra' : 'cocina',
        entity_type: source === 'barra' ? 'bar_order' : 'kitchen_order',
        description: `${userName} creó ${result.created} pedido(s) vía chatbot: ${result.details.join(', ')}`,
        metadata: { items: proposal.items, source, channel: 'chatbot' },
      }).catch(() => {}) // Audit is non-blocking
    }

    if (proposal.intent === 'ACTUALIZAR_STOCK') {
      const { syncToFudo } = await import('@/lib/fudo/stock-sync')

      for (const item of proposal.items) {
        if (!item.matchedStockId || item.matchConfidence === 'none') {
          result.errors.push(`${item.rawName}: no encontrado en stock`)
          continue
        }

        const newQty = parseFloat(item.quantity.replace(/[^\d.,]/g, '')) || 0
        const stockItemId = String(item.matchedStockId)

        const syncResult = await syncToFudo(admin, stockItemId, newQty, userId)

        if (syncResult.success) {
          result.created++
          const fudoTag = syncResult.fudoSynced ? ' (+ Fudo ✓)' : ''
          result.details.push(`${item.matchedStockName ?? item.rawName} → ${item.quantity}${fudoTag}`)
        } else {
          result.errors.push(`${item.matchedStockName ?? item.rawName}: ${syncResult.error}`)
        }
      }

      // Audit
      await admin.from('audit_trail').insert({
        user_id: userId,
        user_name: userName,
        action: 'chatbot_stock_update',
        module: 'stock',
        entity_type: 'stock_item',
        description: `${userName} actualizó ${result.created} item(s) de stock vía chatbot: ${result.details.join(', ')}`,
        metadata: { items: proposal.items, channel: 'chatbot' },
      }).catch(() => {})
    }

    if (proposal.intent === 'REPORTE_PROBLEMA') {
      const { error } = await admin.from('announcements').insert({
        author_id: userId,
        type: 'urgente',
        priority: 'critica',
        title: `🚨 Reporte de problema — ${userName}`,
        body: proposal.message ?? '',
        scope: 'role',
        target_role: 'encargado',
        is_active: true,
      })

      if (error) {
        result.errors.push(`Error al reportar: ${error.message}`)
        result.success = false
      } else {
        result.created = 1
        result.details.push('Reporte enviado a encargados')
      }

      await admin.from('audit_trail').insert({
        user_id: userId,
        user_name: userName,
        action: 'chatbot_report',
        module: 'avisos',
        entity_type: 'announcement',
        description: `${userName} reportó problema vía chatbot: ${(proposal.message ?? '').slice(0, 100)}`,
        metadata: { message: proposal.message, channel: 'chatbot' },
      }).catch(() => {})
    }

    if (proposal.intent === 'AVISO_ENCARGADO') {
      const { error } = await admin.from('announcements').insert({
        author_id: userId,
        type: 'operativo',
        priority: proposal.urgency === 'urgente' ? 'alta' : 'media',
        title: `💬 Aviso de ${userName}`,
        body: proposal.message ?? '',
        scope: 'role',
        target_role: 'encargado',
        is_active: true,
      })

      if (error) {
        result.errors.push(`Error al enviar aviso: ${error.message}`)
        result.success = false
      } else {
        result.created = 1
        result.details.push('Aviso enviado a encargados')
      }

      await admin.from('audit_trail').insert({
        user_id: userId,
        user_name: userName,
        action: 'chatbot_notice',
        module: 'avisos',
        entity_type: 'announcement',
        description: `${userName} envió aviso vía chatbot: ${(proposal.message ?? '').slice(0, 100)}`,
        metadata: { message: proposal.message, channel: 'chatbot' },
      }).catch(() => {})
    }

  } catch (err) {
    result.success = false
    result.errors.push(err instanceof Error ? err.message : 'Error desconocido')
  }

  return result
}
