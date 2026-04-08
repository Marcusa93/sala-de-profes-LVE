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
  | 'PRODUCCION_COMPLETA'
  | 'MISE_EN_PLACE'
  | 'CONSULTA'
  | 'NONE'

export type QueryType =
  | 'STOCK_DISPONIBILIDAD'
  | 'STOCK_DURACION'
  | 'RECETAS_RIESGO'
  | 'PRODUCCION_HOY'
  | 'PENDIENTES_LINKS'
  | 'VENTAS_HOY'
  | 'COSTO_PLATO'
  | 'BRIEFING_DIARIO'
  | 'FICHAJES_ANOMALIAS'

export type QueryData = {
  type: QueryType
  item?: string // nombre de insumo para STOCK_DISPONIBILIDAD y STOCK_DURACION
}

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
// 0. Execute Query — runs read-only queries for QUERY_JSON blocks
// ---------------------------------------------------------------------------

export async function executeQuery(
  admin: SupabaseClient,
  queryData: QueryData,
): Promise<string> {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

  try {
    if (queryData.type === 'STOCK_DISPONIBILIDAD') {
      const itemName = queryData.item ?? ''
      const { data: items } = await admin
        .from('stock_items')
        .select('name, current_qty, min_qty, unit')
        .eq('is_active', true)

      if (!items?.length) return 'No hay items de stock registrados.'

      const n = norm(itemName)
      const match = items.find(
        (i) => norm(i.name) === n || norm(i.name).includes(n) || n.includes(norm(i.name))
      )

      if (!match) return `No encontré "${itemName}" en el stock. Verificá el nombre en la app.`

      const semaphore =
        match.current_qty <= 0 || match.current_qty <= match.min_qty
          ? '🔴'
          : match.current_qty <= match.min_qty * 1.5
          ? '🟡'
          : '🟢'
      return `${semaphore} **${match.name}**: ${match.current_qty} ${match.unit} (mínimo: ${match.min_qty} ${match.unit})`
    }

    if (queryData.type === 'STOCK_DURACION') {
      const itemName = queryData.item ?? ''
      const { data: items } = await admin
        .from('stock_items')
        .select('id, name, current_qty, min_qty, unit')
        .eq('is_active', true)

      if (!items?.length) return 'No hay items de stock registrados.'

      const n = norm(itemName)
      const match = items.find(
        (i) => norm(i.name) === n || norm(i.name).includes(n) || n.includes(norm(i.name))
      )
      if (!match) return `No encontré "${itemName}" en el stock.`

      // Estimate daily usage from production outputs over last 30 days
      const since = new Date()
      since.setDate(since.getDate() - 30)

      const { data: inputs } = await admin
        .from('production_inputs')
        .select('qty_used, production_orders!inner(created_at, status)')
        .eq('stock_item_id', match.id)
        .eq('production_orders.status', 'completed')
        .gte('production_orders.created_at', since.toISOString())

      const totalUsed = (inputs ?? []).reduce((acc, i) => acc + (i.qty_used ?? 0), 0)
      const dailyAvg = totalUsed / 30

      if (dailyAvg < 0.01) {
        return `📦 **${match.name}**: ${match.current_qty} ${match.unit} en stock. Sin producción reciente registrada — no puedo estimar duración.`
      }

      const daysLeft = Math.floor(match.current_qty / dailyAvg)
      const semaphore = daysLeft <= 2 ? '🔴' : daysLeft <= 5 ? '🟡' : '🟢'
      return `${semaphore} **${match.name}**: ${match.current_qty} ${match.unit} en stock. Uso diario promedio: ${dailyAvg.toFixed(2)} ${match.unit}/día. Estimado: **${daysLeft} días**.`
    }

    if (queryData.type === 'RECETAS_RIESGO') {
      // Find stock items in red
      const { data: stockItems } = await admin
        .from('stock_items')
        .select('id, name, current_qty, min_qty')
        .eq('is_active', true)

      const redIds = new Set(
        (stockItems ?? [])
          .filter((i) => i.current_qty <= i.min_qty)
          .map((i) => String(i.id))
      )
      if (redIds.size === 0) return '🟢 No hay recetas en riesgo — todos los insumos están en nivel normal o superior.'

      // Check recipe_ingredients table for affected recipes
      const { data: affected } = await admin
        .from('recipe_ingredients')
        .select('recipes(name), stock_item_id')
        .in('stock_item_id', [...redIds])

      if (!affected?.length) return '🟢 No hay recetas vinculadas a insumos en riesgo.'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recipeNames = [...new Set((affected as any[]).map((r) => r.recipes?.name).filter(Boolean))]
      if (!recipeNames.length) return '🟢 No hay recetas en riesgo.'

      return `⚠️ **Recetas en riesgo** (${recipeNames.length}):\n${recipeNames.map((n) => `- ${n}`).join('\n')}`
    }

    if (queryData.type === 'PRODUCCION_HOY') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const { data: orders } = await admin
        .from('production_orders')
        .select('name, status, chef_id, profiles!production_orders_chef_id_fkey(first_name)')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })

      if (!orders?.length) return 'No hay producciones registradas hoy.'

      const completed = orders.filter((o) => o.status === 'completed')
      const pending = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled')

      const lines = orders.map((o) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chef = (o.profiles as any)?.first_name ?? '?'
        const icon = o.status === 'completed' ? '✅' : o.status === 'in_progress' ? '🔄' : '📋'
        return `${icon} ${o.name} — ${chef} (${o.status})`
      })
      return `📦 **Producción hoy** (${orders.length} total, ${completed.length} completadas, ${pending.length} pendientes):\n${lines.join('\n')}`
    }

    if (queryData.type === 'PENDIENTES_LINKS') {
      const { count } = await admin
        .from('recipe_ingredient_pending_links')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')

      if (!count) return '✅ No hay ingredientes pendientes de vincular al stock.'
      return `🔗 Hay **${count} ingrediente${count !== 1 ? 's' : ''}** pendiente${count !== 1 ? 's' : ''} de vincular al stock. Entrá en **Admin → Recetas → Pending** para revisarlos.`
    }

    // ── VENTAS_HOY — resumen de ventas del día desde Fudo ──
    if (queryData.type === 'VENTAS_HOY') {
      try {
        const { fudo } = await import('@/lib/fudoClient')
        const today = new Date().toISOString().split('T')[0]
        const sales = await fudo.getSales({ from: today })

        if (!sales.length) return '📊 Sin ventas registradas hoy en Fudo.'

        const closed = sales.filter(s => s.saleState === 'CLOSED')
        const inCourse = sales.filter(s => s.saleState === 'IN-COURSE')
        const totalClosed = closed.reduce((s, v) => s + (v.total ?? 0), 0)
        const totalInCourse = inCourse.reduce((s, v) => s + (v.total ?? 0), 0)

        // Get items to find top products
        const productCounts: Record<string, number> = {}
        for (const sale of closed.slice(0, 50)) {
          try {
            const items = await fudo.getSaleItems(sale.id)
            for (const item of items) {
              const name = (item as any).name ?? 'Desconocido'
              productCounts[name] = (productCounts[name] ?? 0) + (item.quantity ?? 1)
            }
          } catch { /* skip */ }
        }

        const topProducts = Object.entries(productCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, qty], i) => `${i + 1}. ${name} (${qty})`)

        let result = `📊 **Ventas hoy**\n`
        result += `- 💰 Cerradas: **$${totalClosed.toLocaleString('es-AR')}** (${closed.length} tickets)\n`
        if (inCourse.length > 0) {
          result += `- 🔄 En curso: **$${totalInCourse.toLocaleString('es-AR')}** (${inCourse.length} mesas)\n`
        }
        result += `- 📝 Total: **$${(totalClosed + totalInCourse).toLocaleString('es-AR')}**`

        if (topProducts.length > 0) {
          result += `\n\n🏆 **Más vendidos:**\n${topProducts.join('\n')}`
        }

        return result
      } catch (err) {
        return `No pude obtener las ventas de Fudo: ${err instanceof Error ? err.message : 'Error'}`
      }
    }

    // ── COSTO_PLATO — costo de producción por receta ──
    if (queryData.type === 'COSTO_PLATO') {
      const recipeName = queryData.item ?? ''

      const { data: recipes } = await admin
        .from('recipes')
        .select('id, name, portion_yield')
        .eq('is_active', true)

      if (!recipes?.length) return 'No hay recetas cargadas.'

      // Find match
      const n = norm(recipeName)
      let match = recipes.find(r => norm(r.name) === n)
      if (!match) match = recipes.find(r => norm(r.name).includes(n) || n.includes(norm(r.name)))

      if (!match) {
        // List all recipes
        const list = recipes.map(r => `- ${r.name}`).join('\n')
        return `No encontré "${recipeName}". Recetas disponibles:\n${list}`
      }

      // Get ingredients with costs
      const { data: ingredients } = await admin
        .from('recipe_ingredients')
        .select('qty_per_portion, stock_items(name, cost_per_unit, unit)')
        .eq('recipe_id', match.id)

      if (!ingredients?.length) return `📋 **${match.name}** no tiene ingredientes vinculados al stock todavía.`

      let totalCost = 0
      const lines: string[] = []

      for (const ing of ingredients) {
        const si = (ing as any).stock_items
        if (!si) continue
        const cost = (si.cost_per_unit ?? 0) * (ing.qty_per_portion ?? 0)
        totalCost += cost
        lines.push(`- ${si.name}: ${ing.qty_per_portion} ${si.unit} × $${si.cost_per_unit?.toFixed(0) ?? '?'} = **$${cost.toFixed(0)}**`)
      }

      // Get sale price from menu_items
      const { data: menuItem } = await admin
        .from('menu_items')
        .select('sale_price')
        .eq('recipe_id', match.id)
        .limit(1)
        .maybeSingle()

      const salePrice = menuItem?.sale_price ?? 0
      const margin = salePrice > 0 ? ((salePrice - totalCost) / salePrice * 100).toFixed(0) : null

      let result = `💰 **Costo: ${match.name}**\n${lines.join('\n')}\n\n`
      result += `📦 **Costo total por porción: $${totalCost.toFixed(0)}**`
      if (salePrice > 0) {
        result += `\n🏷️ Precio de venta: $${salePrice.toFixed(0)}`
        result += `\n📈 Margen: **${margin}%** ($${(salePrice - totalCost).toFixed(0)} de ganancia)`
      }

      return result
    }

    // ── BRIEFING_DIARIO — resumen ejecutivo del día ──
    if (queryData.type === 'BRIEFING_DIARIO') {
      const todayDate = new Date().toISOString().split('T')[0]
      const lines: string[] = ['📋 **Briefing del día**\n']

      // Stock alerts
      const { data: stockItems } = await admin
        .from('stock_items')
        .select('name, current_qty, min_qty')
        .eq('is_active', true)

      const critical = (stockItems ?? []).filter(i => i.current_qty <= 0)
      const low = (stockItems ?? []).filter(i => i.current_qty > 0 && i.current_qty <= i.min_qty)

      if (critical.length > 0) {
        lines.push(`🔴 **${critical.length} insumos agotados:** ${critical.slice(0, 5).map(i => i.name).join(', ')}${critical.length > 5 ? ` (+${critical.length - 5} más)` : ''}`)
      }
      if (low.length > 0) {
        lines.push(`🟡 **${low.length} insumos bajos:** ${low.slice(0, 5).map(i => i.name).join(', ')}${low.length > 5 ? ` (+${low.length - 5} más)` : ''}`)
      }
      if (critical.length === 0 && low.length === 0) {
        lines.push('🟢 Stock: todo en niveles normales')
      }

      // Pending orders
      const { data: pendingOrders } = await admin
        .from('kitchen_orders')
        .select('id')
        .eq('status', 'pending')

      if ((pendingOrders ?? []).length > 0) {
        lines.push(`📦 **${pendingOrders!.length} pedidos pendientes** de mercadería`)
      }

      // Attendance
      const { data: clockedIn } = await admin
        .from('clock_events')
        .select('employee_id, profiles!clock_events_employee_id_fkey(first_name)')
        .eq('event_type', 'clock_in')
        .gte('timestamp', todayDate)

      const presentCount = new Set((clockedIn ?? []).map(c => c.employee_id)).size
      lines.push(`👥 **${presentCount} personas** ficharon hoy`)

      // Open anomalies
      const { count: anomalyCount } = await admin
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')

      if (anomalyCount && anomalyCount > 0) {
        lines.push(`⚠️ **${anomalyCount} anomalías** de fichaje pendientes`)
      }

      // Active announcements
      const { data: urgentAnnouncements } = await admin
        .from('announcements')
        .select('title')
        .in('priority', ['alta', 'critica'])
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .limit(3)

      if ((urgentAnnouncements ?? []).length > 0) {
        lines.push(`🚨 **Avisos urgentes:** ${urgentAnnouncements!.map(a => a.title).join(', ')}`)
      }

      // Pending recipe links
      const { count: pendingLinks } = await admin
        .from('recipe_ingredient_pending_links')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')

      if (pendingLinks && pendingLinks > 0) {
        lines.push(`🔗 **${pendingLinks} ingredientes** pendientes de vincular al stock`)
      }

      return lines.join('\n')
    }

    // ── FICHAJES_ANOMALIAS — anomalías de fichaje recientes ──
    if (queryData.type === 'FICHAJES_ANOMALIAS') {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      // Open anomalies
      const { data: anomalies } = await admin
        .from('attendance_anomalies')
        .select('anomaly_type, severity, status, created_at, employee_id, profiles!attendance_anomalies_employee_id_fkey(first_name, last_name)')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(15)

      // Suspicious logs
      const { data: suspicious } = await admin
        .from('attendance_logs')
        .select('operative_date, suspicious_reasons, profiles!attendance_logs_user_id_fkey(first_name)')
        .eq('is_suspicious', true)
        .gte('operative_date', sevenDaysAgo.toISOString().split('T')[0])
        .order('operative_date', { ascending: false })
        .limit(10)

      const anomRows = anomalies ?? []
      const suspRows = suspicious ?? []

      if (anomRows.length === 0 && suspRows.length === 0) {
        return '✅ Sin anomalías ni fichajes sospechosos en los últimos 7 días.'
      }

      const lines: string[] = ['🔍 **Anomalías de fichaje (últimos 7 días)**\n']

      if (anomRows.length > 0) {
        const openCount = anomRows.filter(a => a.status === 'open').length
        lines.push(`📊 ${anomRows.length} anomalías (${openCount} abiertas)\n`)

        for (const a of anomRows.slice(0, 8)) {
          const name = (a as any).profiles?.first_name ?? '?'
          const tipo =
            a.anomaly_type === 'gps_out_of_range' ? '📍 GPS fuera de rango' :
            a.anomaly_type === 'wifi_mismatch' ? '📶 WiFi no reconocida' :
            a.anomaly_type === 'unknown_device' ? '📱 Dispositivo no registrado' :
            a.anomaly_type === 'rapid_succession' ? '⚡ Fichaje muy rápido' :
            a.anomaly_type === 'unusual_hour' ? '🕐 Horario inusual' :
            `❓ ${a.anomaly_type}`
          const severity = a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '⚪'
          const date = new Date(a.created_at).toLocaleDateString('es-AR')
          lines.push(`${severity} ${name}: ${tipo} (${date}) — ${a.status}`)
        }
      }

      if (suspRows.length > 0) {
        lines.push(`\n⚠️ **Fichajes sospechosos:** ${suspRows.length}`)
        for (const s of suspRows.slice(0, 5)) {
          const name = (s as any).profiles?.first_name ?? '?'
          const reasons = ((s.suspicious_reasons as string[]) ?? []).map(r => r.split(':')[0]).join(', ')
          lines.push(`- ${name} (${s.operative_date}): ${reasons}`)
        }
      }

      lines.push('\nVer detalle completo en **Admin → Reportes → Sospechosos**')
      return lines.join('\n')
    }

  } catch (err) {
    console.error('[executeQuery]', err)
    return 'No pude obtener esa información en este momento.'
  }

  return 'Tipo de consulta no reconocido.'
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
  if (intent.includes('PRODUCCION') || intent.includes('DESPIECE') || intent.includes('PRODUCCION_COMPLETA')) {
    return 'PRODUCCION_COMPLETA'
  }
  if (intent.includes('MISE') || intent.includes('MISE_EN_PLACE') || intent.includes('PREPARACION_LISTA')) {
    return 'MISE_EN_PLACE'
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
// 3b. Permission Check — validate role can perform action
// ---------------------------------------------------------------------------

const ACTION_PERMISSIONS: Record<ActionIntent, string[]> = {
  PEDIDO_MERCADERIA: ['socio', 'encargado', 'chef', 'cocina', 'barista'], // All operational roles
  ACTUALIZAR_STOCK: ['socio', 'encargado', 'chef', 'cocina', 'barista'], // Who can count/update stock
  REPORTE_PROBLEMA: ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha'], // Everyone can report
  AVISO_ENCARGADO: ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha'], // Everyone can notify
  PRODUCCION_COMPLETA: ['socio', 'encargado', 'chef', 'cocina'], // Only kitchen roles can register production
  MISE_EN_PLACE: ['socio', 'encargado', 'chef', 'cocina'], // Kitchen roles can update mise en place
  CONSULTA: ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha'], // Everyone can ask
  NONE: [],
}

// What stock source each role accesses
const ROLE_STOCK_SOURCE: Record<string, 'cocina' | 'barra'> = {
  barista: 'barra',
  chef: 'cocina',
  cocina: 'cocina',
  encargado: 'cocina', // Encargado sees general stock (cocina table)
  socio: 'cocina',
}

export function checkPermission(intent: ActionIntent, role: string): { allowed: boolean; reason?: string } {
  const allowed = ACTION_PERMISSIONS[intent]
  if (!allowed || allowed.length === 0) return { allowed: false, reason: 'Acción no reconocida' }
  if (!allowed.includes(role)) {
    return {
      allowed: false,
      reason: `Los ${role}s no pueden realizar esta acción. Consultá con tu encargado.`,
    }
  }
  return { allowed: true }
}

export function getStockSource(role: string): 'cocina' | 'barra' {
  return ROLE_STOCK_SOURCE[role] ?? 'cocina'
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
  // Check permissions
  const perm = checkPermission(intent, userRole)
  if (!perm.allowed) {
    return {
      intent,
      items: [],
      duplicateWarnings: [],
      confirmationText: `❌ ${perm.reason}`,
      readyToExecute: false,
    }
  }

  const source = getStockSource(userRole)

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

  if (intent === 'PRODUCCION_COMPLETA') {
    // message carries JSON-serialized { input: { name, qty, unit }, outputs: [{ name, qty, unit }] }
    let prodData: { input?: { name: string; qty: number; unit?: string }; outputs?: { name: string; qty: number; unit?: string }[] } = {}
    try { prodData = JSON.parse(message ?? '{}') } catch { /* keep empty */ }

    const inp = prodData.input
    const outs = prodData.outputs ?? []

    if (!inp?.name || !inp.qty) {
      return {
        intent,
        items: [],
        message: message ?? '',
        duplicateWarnings: [],
        confirmationText: '❌ Falta información del insumo de entrada. Indicá qué procesaste y en qué cantidad.',
        readyToExecute: false,
      }
    }

    const totalOut = outs.reduce((acc, o) => acc + o.qty, 0)
    const waste = Math.max(0, inp.qty - totalOut)
    const efficiency = inp.qty > 0 ? Math.round(((inp.qty - waste) / inp.qty) * 1000) / 10 : 0

    const inputLine = `📥 **Entrada:** ${inp.qty} ${inp.unit ?? 'kg'} de ${inp.name}`
    const outputLines = outs.map((o) => `  • ${o.name}: ${o.qty} ${o.unit ?? 'kg'}`)
    const wasteLine = waste > 0 ? `  • Merma: ${waste.toFixed(3)} kg` : ''
    const effLine = `📊 **Eficiencia:** ${efficiency}%`

    const confirmText = `🔪 **Registrar producción:**\n${inputLine}\n📤 **Salidas:**\n${outputLines.join('\n')}${wasteLine ? '\n' + wasteLine : ''}\n${effLine}\n\nEsto actualiza el stock inmediatamente. ¿Confirmo?`

    return {
      intent,
      items: [],
      message: message ?? '',
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

  if (intent === 'MISE_EN_PLACE') {
    const itemsList = matchedItems.map(i => `- ✅ ${i.matchedStockName ?? i.rawName}: ${i.quantity}`).join('\n')
    return {
      intent,
      items: matchedItems,
      duplicateWarnings: [],
      confirmationText: `👨‍🍳 **Mise en place completado:**\n${itemsList}\n\n¿Marco como listo?`,
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
      const source = getStockSource(userRole)

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

    if (proposal.intent === 'PRODUCCION_COMPLETA') {
      let prodData: { input?: { name: string; qty: number; unit?: string }; outputs?: { name: string; qty: number; unit?: string }[] } = {}
      try { prodData = JSON.parse(proposal.message ?? '{}') } catch { /* keep empty */ }

      const inp = prodData.input
      const outs = prodData.outputs ?? []

      if (!inp?.name || !inp.qty) {
        result.success = false
        result.errors.push('Datos de producción incompletos')
        return result
      }

      // Match input stock item
      const { data: stockItems } = await admin.from('stock_items').select('id, name').eq('is_active', true)
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      const inputNorm = norm(inp.name)
      const matchedInput = (stockItems ?? []).find(
        (si) => norm(si.name) === inputNorm || norm(si.name).includes(inputNorm) || inputNorm.includes(norm(si.name))
      )

      if (!matchedInput) {
        result.success = false
        result.errors.push(`No encontré "${inp.name}" en el stock. Usá el nombre exacto del insumo.`)
        return result
      }

      // Create production order
      const { data: order, error: orderErr } = await admin
        .from('production_orders')
        .insert({
          name: `Despiece ${inp.name} ${inp.qty}${inp.unit ?? 'kg'} (chat)`,
          status: 'draft',
          chef_id: userId,
          notes: `Registrado vía chatbot por ${userName}`,
        })
        .select('id')
        .single()

      if (orderErr || !order) {
        result.success = false
        result.errors.push(`Error al crear la orden: ${orderErr?.message}`)
        return result
      }

      // Add input
      const { error: inputErr } = await admin.from('production_inputs').insert({
        production_order_id: order.id,
        stock_item_id: matchedInput.id,
        qty_used: inp.qty,
        unit: inp.unit ?? 'kg',
      })

      if (inputErr) {
        result.errors.push(`Error al registrar entrada: ${inputErr.message}`)
      }

      // Add outputs (match stock items by name when possible)
      for (const out of outs) {
        const outNorm = norm(out.name)
        const matchedOut = (stockItems ?? []).find(
          (si) => norm(si.name) === outNorm || norm(si.name).includes(outNorm) || outNorm.includes(norm(si.name))
        )
        await admin.from('production_outputs').insert({
          production_order_id: order.id,
          stock_item_id: matchedOut?.id ?? null,
          output_name: out.name,
          qty_produced: out.qty,
          unit: out.unit ?? 'kg',
          is_waste: false,
        })
      }

      // Complete the order (updates stock)
      const { data: completed, error: completeErr } = await admin.rpc('complete_production_order', {
        p_order_id: order.id,
        p_user_id: userId,
      })

      if (completeErr) {
        result.success = false
        result.errors.push(`Error al completar: ${completeErr.message}`)
        return result
      }

      const completedData = completed as { efficiency_pct?: number; movements?: { stock_item_id: string; change: number }[] }
      const efficiency = completedData?.efficiency_pct ?? 0

      // Sync affected stock items to Fudo
      const movements = completedData?.movements ?? []
      if (movements.length > 0) {
        const { syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
        const fudoResult = await syncProductionToFudo(admin, movements, userId)
        const fudoTag = fudoResult.synced > 0 ? ` (Fudo ✓ ${fudoResult.synced} items)` : ''
        result.created = 1
        result.details.push(`Producción completada — ${inp.qty}${inp.unit ?? 'kg'} de ${inp.name} → ${outs.length} productos, ${efficiency}% eficiencia${fudoTag}`)
      } else {
        result.created = 1
        result.details.push(`Producción completada — ${inp.qty}${inp.unit ?? 'kg'} de ${inp.name} → ${outs.length} productos, ${efficiency}% eficiencia`)
      }

      await admin.from('audit_trail').insert({
        user_id: userId,
        user_name: userName,
        action: 'chatbot_produccion',
        module: 'cocina',
        entity_type: 'production_order',
        description: `${userName} registró producción vía chatbot: ${inp.qty}${inp.unit ?? 'kg'} de ${inp.name}`,
        metadata: { order_id: order.id, input: inp, outputs: outs, efficiency, channel: 'chatbot' },
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

    // ── MISE_EN_PLACE — mark items as done in current shift ──
    if (proposal.intent === 'MISE_EN_PLACE') {
      const todayStr = new Date().toISOString().split('T')[0]

      // Find active kitchen shift
      const { data: activeShift } = await admin
        .from('kitchen_shifts')
        .select('id, shift_type')
        .eq('date', todayStr)
        .in('status', ['pending', 'in_progress'])
        .limit(1)
        .maybeSingle()

      if (!activeShift) {
        result.errors.push('No hay turno de cocina activo hoy. Abrí un turno primero.')
        result.success = false
      } else {
        // Get all mise en place items for this shift
        const { data: miseItems } = await admin
          .from('mise_en_place_items')
          .select('id, name')
          .eq('is_active', true)
          .in('shift', [activeShift.shift_type, 'both'])

        const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

        for (const item of proposal.items) {
          const itemName = norm(item.rawName)
          const match = (miseItems ?? []).find(m =>
            norm(m.name) === itemName ||
            norm(m.name).includes(itemName) ||
            itemName.includes(norm(m.name))
          )

          if (!match) {
            result.errors.push(`No encontré "${item.rawName}" en mise en place`)
            continue
          }

          // Upsert mise_en_place_records
          const qty = parseFloat(item.quantity) || 0
          const { error } = await admin
            .from('mise_en_place_records')
            .upsert({
              kitchen_shift_id: activeShift.id,
              mise_en_place_item_id: match.id,
              status: 'done',
              quantity_produced: qty > 0 ? qty : null,
              produced_by: userId,
              note: 'Registrado vía chatbot',
            }, { onConflict: 'kitchen_shift_id,mise_en_place_item_id' })

          if (error) {
            result.errors.push(`Error al registrar ${match.name}: ${error.message}`)
          } else {
            result.created++
            result.details.push(`✅ ${match.name}${qty > 0 ? ` (${qty})` : ''} marcado como listo`)
          }
        }

        result.success = result.errors.length === 0

        await admin.from('audit_trail').insert({
          user_id: userId,
          user_name: userName,
          action: 'chatbot_mise_en_place',
          module: 'cocina',
          entity_type: 'mise_en_place_record',
          description: `${userName} completó ${result.created} items de mise en place vía chatbot`,
          metadata: { items: proposal.items.map(i => i.rawName), shift_id: activeShift.id },
        }).catch(() => {})
      }
    }

  } catch (err) {
    result.success = false
    result.errors.push(err instanceof Error ? err.message : 'Error desconocido')
  }

  return result
}
