import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per-user)
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(userId)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }

  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 1500

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatRequest = {
  message: string
  history?: { role: 'user' | 'assistant'; content: string }[]
}

type StockItemRow = {
  id: string
  name: string
  category: string
  unit: string
  current_qty: number
  min_qty: number
  supplier_id: string | null
  suppliers: { name: string } | null
}

type AttendanceRow = {
  clock_in_at: string
  clock_out_at: string | null
  profiles: { first_name: string; last_name: string; role: string } | null
}

type ShiftRow = {
  shift_date: string
  start_time: string
  end_time: string
  profiles: { first_name: string; last_name: string; role: string } | null
}

type AnnouncementRow = {
  title: string
  body: string
  priority: string
  type: string
  created_at: string
}

type SupplierRow = {
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  category: string | null
  notes: string | null
}

type BarStockRow = {
  name: string
  category: string
  unit: string
  current_qty: number
  current_detail: string | null
  min_level: number
  is_urgent: boolean
}

type BarOrderRow = {
  product_name: string
  category: string
  quantity: string
  urgency: string
  status: string
  note: string | null
  created_at: string
  profiles: { first_name: string } | null
}

type ChecklistItemRow = {
  title: string
  status: string
  completed_by_profile: { first_name: string } | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSemaphore(currentQty: number, minQty: number): 'green' | 'yellow' | 'red' {
  if (currentQty <= 0) return 'red'
  if (currentQty <= minQty) return 'red'
  if (currentQty <= minQty * 1.5) return 'yellow'
  return 'green'
}

// ---------------------------------------------------------------------------
// System prompt — exhaustivo y preciso
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Sos **La Vieja de Historia**, la asistente interna de **La Vieja Escuela** (LVE), una cafetería/restaurante ubicada en Santa Fe 746, San Miguel de Tucumán, Argentina.

## TU PERSONALIDAD — TONADA TUCUMANA
- Sos profesional pero con onda tucumana. Hablás con tonada del norte argentino.
- Usás expresiones tucumanas naturalmente: "mirá", "fijate", "dale nomás", "sabé que...", "qué macana", "che", "ahí nomás".
- Tuteás con "vos" y conjugás tucumano: "tenés", "fijate", "mirá vos", "andá".
- Usás diminutivos con cariño: "un ratito", "tranqui nomás", "esperá un cachito".
- Sos como la abuela sabia del local que sabe todo lo que pasa y te lo dice con cariño pero sin vueltas.
- Podés meter alguna referencia tucumana cuando viene al caso ("más complicado que subir al Aconquija", "más seco que el Salí en agosto").
- Usás emojis con moderación para hacer la respuesta más visual (☕, 🔴, 🟡, 🟢, 📋, ⚠️, 👨‍🍳, etc).
- Respondés siempre de forma concisa, organizada y accionable.
- NUNCA inventás datos. Si no tenés información en el contexto, lo decís claramente: "Mirá, de eso no tengo data, fijate en la app".
- Si te piden algo fuera de la gestión del restaurante, redirigís con onda: "Ay mijo, yo de eso no sé, pero preguntame sobre el local que ahí sí te ayudo".

## EQUIPO DE LVE (18 empleados)
**Encargados** (acceso total): Ricardo, Noelia, Ignacio, Marco
**Chef**: Facundo Yapura
**Cocina**: Melina, Gastón, Samuel, Marisol, Facundo Torres
**Baristas**: Agustín, Ivoti, Patricia, Gonzalo
**Runners**: Juan Pablo, Fernanda, Aimé, Sebastián

## ROLES Y PERMISOS
| Rol | Acceso |
|-----|--------|
| encargado | Todo: dashboard, stock, proveedores, cocina, barra, equipo, alertas, chatbot, recetario |
| chef | Cocina, checklists, mise en place, recetario |
| cocina | Cocina, checklists, mise en place, recetario |
| barista | Barra (stock cafetería, pedidos barra) |
| runner | Solo base: fichar, ver turnos, notificaciones |

## ESTRUCTURA DE LA APP ("Sala de Profes")
- **Inicio** (/) — Dashboard del encargado con resúmenes
- **Mi Turno** (/mi-turno) — Fichaje con geolocalización (150m del local)
- **Horarios** (/mis-horarios) — Turnos semanales
- **Avisos** (/notificaciones) — Sistema de notificaciones por rol, tipo y prioridad
- **Cocina** (/cocina) — Turnos de cocina, checklists, mise en place
- **Barra** (/cocina/barra) — Stock cafetería, pedidos de barra
- **Stock** (/stock) — Inventario general con semáforo (🟢🟡🔴)
- **Proveedores** (/proveedores) — Directorio de proveedores
- **Equipo** (/equipo) — Gestión de empleados y roles
- **Recetario** (/recetas) — Recetas con ingredientes y rendimiento
- **Control** (/admin) — Dashboard administrativo
- **Asistente** (/asistente) — Este chatbot (todos los roles, con info filtrada)

## ACCESO POR ROL AL CHATBOT
Cada rol ve datos adaptados a su función:
- **socio**: Ve TODO sin restricciones
- **encargado**: Ve TODO (asistencia, stock, barra, cocina, proveedores, recetas completas, equipo, avisos)
- **barista**: Ve stock de barra, pedidos de barra, carta/menú (descripción de platos), protocolo de atención, turnos, avisos
- **chef / cocina**: Ve cocina (checklists, turnos cocina), stock general (para ingredientes), recetas CON CANTIDADES Y PREPARACIÓN DETALLADA, avisos
- **runner**: Ve carta/menú (qué es cada plato, cómo se sirve), protocolo de atención completo, turnos generales, avisos, barra (Agustín)
- **bacha**: Ve vajilla, protocolo de atención, turnos generales, avisos

IMPORTANTE:
- Runners NO ven cantidades de recetas ni stock, pero SÍ saben qué contiene cada plato para informar al cliente.
- Runners tienen acceso al protocolo de atención (saludo, servicio, vajilla, demoras).
- Si un runner pregunta "¿qué lleva la milanesa napolitana?" respondé con la descripción del plato, NO con cantidades de ingredientes.
- Si un runner pregunta "¿en qué se sirve un cortado?" respondé con la vajilla correcta.
- Cocina/Chef ven las recetas completas con cantidades, preparación paso a paso y rendimiento.
- Si un barista pregunta por proveedores, decile con onda que eso lo maneja el encargado.

## SISTEMA DE STOCK (SEMÁFORO)
- 🟢 Verde: stock > min_qty × 1.5
- 🟡 Amarillo: stock entre min_qty y min_qty × 1.5
- 🔴 Rojo: stock ≤ min_qty o stock = 0
Categorías: bebidas, lácteos, carnes, verduras, frutas, panadería, condimentos, limpieza, desechables, otros

## BARRA / CAFETERÍA
Stock separado del stock general. Categorías: lácteos, café, packaging, suministros, insumos_oyambre, librería, general.
Las baristas pueden crear pedidos con urgencia: normal / alta / urgente.
Los pedidos van: pending → ordered → received.

## COCINA
- **Turnos**: morning (mañana) / night (noche). Status: pending → in_progress → completed.
- **Checklists**: opening (apertura), production (producción), service (servicio), closing (cierre). Items: pending / done / skipped / overdue.
- **Mise en Place**: Preparaciones diarias por familia (proteínas, verduras, panadería, lácteos, etc). Status: pending / in_progress / done / low / missing.

## SERVICIOS GASTRONÓMICOS
- **Desayuno y Meriendas**: desayunos_meriendas, entrepanes, tostones, sin_trigo, panadería_salada, bebidas, postres
- **Almuerzos y Cenas**: entradas, ensaladas, kids, especialidades, pizzas, entre_panes, bebidas, postres

## NOTIFICACIONES
Tipos: general, urgente, recordatorio, operativo
Prioridades: baja, media, alta, crítica
Scope: todos, por_rol, usuario específico

## CÓMO RESPONDER

### Para consultas de stock:
Mostrá el semáforo visual, agrupá por urgencia, sugerí qué pedir primero y a qué proveedor.

### Para consultas de personal:
Decí quién está, quién falta, quién no marcó egreso. Relacioná con los turnos programados.

### Para resúmenes del día:
Combiná asistencia + stock crítico + avisos urgentes + pedidos pendientes en un resumen ejecutivo.

### Para consultas de barra:
Mostrá items bajos, pedidos pendientes, qué se necesita comprar.

### Para consultas sobre proveedores:
Dá los datos de contacto completos y qué productos proveen.

### Para consultas sobre la carta/menú:
Explicá qué es el plato, qué contiene, cómo se sirve. NO des cantidades a runners. Sí a cocina.

### Para consultas de protocolo/atención:
Respondé con el protocolo de LVE. Vajilla, servicio, saludo, demoras. Sé específico.

### Para sugerencias y recomendaciones:
Basate SIEMPRE en los datos reales. Podés sugerir acciones basándote en patrones (ej: "Café Oyambre está en rojo, recomiendo pedir a [proveedor]").

### Formato de respuesta:
- Usá listas y secciones claras
- Negrita para datos importantes
- Emojis como indicadores visuales (no decorativos)
- Máximo 500 palabras por respuesta
- Si la respuesta es muy larga, priorizá lo más urgente

IMPORTANTE: La fecha y hora actual están en el contexto. Usala para contextualizar tus respuestas (ej: "Hoy viernes 20 de marzo..." ).`

// ---------------------------------------------------------------------------
// Recopilar contexto de datos — ampliado
// ---------------------------------------------------------------------------

async function gatherContext(supabase: Awaited<ReturnType<typeof createClient>>, role: string) {
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const tomorrowStr = format(new Date(today.getTime() + 86400000), 'yyyy-MM-dd')

  const sections: string[] = []

  sections.push(`FECHA Y HORA ACTUAL: ${format(today, "EEEE d 'de' MMMM yyyy, HH:mm", { locale: es })}`)

  // Define what data each role can access — socio sees everything
  const isSocio = role === 'socio'
  const canSeeAttendance = isSocio || ['encargado'].includes(role)
  const canSeeAllShifts = isSocio || ['encargado'].includes(role)
  const canSeeStockGeneral = isSocio || ['encargado', 'chef', 'cocina'].includes(role)
  const canSeeBarStock = isSocio || ['encargado', 'barista'].includes(role)
  const canSeeBarOrders = isSocio || ['encargado', 'barista'].includes(role)
  const canSeeKitchen = isSocio || ['encargado', 'chef', 'cocina'].includes(role)
  const canSeeAnnouncements = true // All roles
  const canSeeSuppliers = isSocio || ['encargado'].includes(role)
  const canSeeRecipesFull = isSocio || ['encargado', 'chef', 'cocina'].includes(role) // Full with quantities
  const canSeeRecipesMenu = true // ALL roles see menu descriptions (runners need to know dishes)
  const canSeeTeamShifts = true // Everyone sees who works today

  try {
    // 1. Asistencia de hoy (solo encargados ven detalle completo)
    if (canSeeAttendance) {
      const { data: attendance } = await supabase
        .from('attendance_logs')
        .select('clock_in_at, clock_out_at, profiles!attendance_logs_user_id_fkey(first_name, last_name, role)')
        .eq('operative_date', todayStr)

      const attendanceRows = (attendance ?? []) as unknown as AttendanceRow[]

      if (attendanceRows.length > 0) {
        const lines = attendanceRows.map((a) => {
          const name = a.profiles ? `${a.profiles.first_name} ${a.profiles.last_name}` : 'Desconocido'
          const r = a.profiles?.role ?? '?'
          const checkIn = a.clock_in_at ? format(new Date(a.clock_in_at), 'HH:mm') : '?'
          const checkOut = a.clock_out_at ? format(new Date(a.clock_out_at), 'HH:mm') : 'aún en turno'
          return `- ${name} (${r}): ingreso ${checkIn}, egreso ${checkOut}`
        })
        sections.push(`ASISTENCIA HOY:\n${lines.join('\n')}`)
      } else {
        sections.push('ASISTENCIA HOY: Nadie ha marcado ingreso hoy.')
      }

      // Egresos sin marcar
      const sinEgreso = attendanceRows.filter((a) => a.clock_in_at && !a.clock_out_at)
      if (sinEgreso.length > 0) {
        const lines = sinEgreso.map((a) =>
          `- ${a.profiles ? `${a.profiles.first_name} ${a.profiles.last_name}` : '?'} (ingreso: ${a.clock_in_at ? format(new Date(a.clock_in_at), 'HH:mm') : '?'})`
        )
        sections.push(`EGRESOS SIN MARCAR:\n${lines.join('\n')}`)
      }
    }

    // 2. Turnos hoy y mañana
    if (canSeeAllShifts || canSeeTeamShifts) {
      const { data: shifts } = await supabase
        .from('shifts')
        .select('shift_date, start_time, end_time, profiles!shifts_user_id_fkey(first_name, last_name, role)')
        .in('shift_date', [todayStr, tomorrowStr])
        .order('shift_date', { ascending: true })
        .order('start_time', { ascending: true })

      const shiftRows = (shifts ?? []) as unknown as ShiftRow[]

      // Non-encargados only see shifts for their own role area
      const filterShifts = (rows: ShiftRow[]) => {
        if (canSeeAllShifts) return rows
        // Baristas see barista shifts, cocina sees cocina/chef shifts, runners see all (just names)
        if (role === 'barista') return rows.filter((s) => s.profiles?.role === 'barista')
        if (role === 'cocina' || role === 'chef') return rows.filter((s) => ['cocina', 'chef'].includes(s.profiles?.role ?? ''))
        return rows // runners see everyone's names
      }

      const todayShifts = filterShifts(shiftRows.filter((s) => s.shift_date === todayStr))
      const tomorrowShifts = filterShifts(shiftRows.filter((s) => s.shift_date === tomorrowStr))

      if (todayShifts.length > 0) {
        const lines = todayShifts.map((s) =>
          `- ${s.profiles ? `${s.profiles.first_name} ${s.profiles.last_name}` : '?'} (${s.profiles?.role ?? '?'}): ${s.start_time.slice(0, 5)} - ${s.end_time.slice(0, 5)}`
        )
        sections.push(`TURNOS HOY:\n${lines.join('\n')}`)
      } else {
        sections.push('TURNOS HOY: No hay turnos programados.')
      }

      if (tomorrowShifts.length > 0) {
        const lines = tomorrowShifts.map((s) =>
          `- ${s.profiles ? `${s.profiles.first_name} ${s.profiles.last_name}` : '?'}: ${s.start_time.slice(0, 5)} - ${s.end_time.slice(0, 5)}`
        )
        sections.push(`TURNOS MAÑANA:\n${lines.join('\n')}`)
      }
    }

    // 3. Stock general (encargados, chef, cocina)
    if (canSeeStockGeneral) {
      const { data: stockItems } = await supabase
        .from('stock_items')
        .select('id, name, category, unit, current_qty, min_qty, supplier_id, suppliers(name)')
        .eq('is_active', true)
        .order('name', { ascending: true })

      const stockRows = (stockItems ?? []) as unknown as StockItemRow[]
      const redItems = stockRows.filter((i) => getSemaphore(i.current_qty, i.min_qty) === 'red')
      const yellowItems = stockRows.filter((i) => getSemaphore(i.current_qty, i.min_qty) === 'yellow')

      if (redItems.length > 0) {
        const lines = redItems.map((i) =>
          `- 🔴 ${i.name}: ${i.current_qty} ${i.unit} (mín: ${i.min_qty})${i.suppliers?.name ? ` [${i.suppliers.name}]` : ''}`
        )
        sections.push(`STOCK CRÍTICO (ROJO):\n${lines.join('\n')}`)
      }

      if (yellowItems.length > 0) {
        const lines = yellowItems.map((i) =>
          `- 🟡 ${i.name}: ${i.current_qty} ${i.unit} (mín: ${i.min_qty})${i.suppliers?.name ? ` [${i.suppliers.name}]` : ''}`
        )
        sections.push(`STOCK EN ATENCIÓN (AMARILLO):\n${lines.join('\n')}`)
      }

      const greenCount = stockRows.length - redItems.length - yellowItems.length
      sections.push(`RESUMEN STOCK GENERAL: ${stockRows.length} items — 🔴 ${redItems.length} críticos, 🟡 ${yellowItems.length} en atención, 🟢 ${greenCount} normales`)
    }

    // 4. Stock de Barra / Cafetería (encargados, baristas)
    if (canSeeBarStock) {
      const { data: barStock } = await supabase
        .from('bar_stock_items')
        .select('name, category, unit, current_qty, current_detail, min_level, is_urgent')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      const barRows = (barStock ?? []) as BarStockRow[]
      const barLow = barRows.filter((b) => b.current_qty <= b.min_level || b.is_urgent)

      if (barLow.length > 0) {
        const lines = barLow.map((b) =>
          `- ${b.is_urgent ? '🔴' : '🟡'} ${b.name} (${b.category}): ${b.current_qty} ${b.unit} (mín: ${b.min_level})${b.current_detail ? ` — ${b.current_detail}` : ''}`
        )
        sections.push(`BARRA — ITEMS BAJOS O URGENTES:\n${lines.join('\n')}`)
      }

      sections.push(`RESUMEN BARRA: ${barRows.length} items — ${barLow.length} bajos/urgentes, ${barRows.length - barLow.length} normales`)
    }

    // 5. Pedidos de barra pendientes (encargados, baristas)
    if (canSeeBarOrders) {
      const { data: barOrders } = await supabase
        .from('bar_orders')
        .select('product_name, category, quantity, urgency, status, note, created_at, profiles:created_by(first_name)')
        .in('status', ['pending', 'ordered'])
        .order('created_at', { ascending: false })
        .limit(20)

      const orderRows = (barOrders ?? []) as unknown as BarOrderRow[]

      if (orderRows.length > 0) {
        const lines = orderRows.map((o) => {
          const urgTag = o.urgency === 'urgente' ? '🔴 URGENTE' : o.urgency === 'alta' ? '🟡 ALTA' : ''
          const who = o.profiles?.first_name ?? '?'
          return `- ${o.product_name} × ${o.quantity} (${o.status}) ${urgTag} — pedido por ${who}${o.note ? ` | nota: ${o.note}` : ''}`
        })
        sections.push(`PEDIDOS DE BARRA PENDIENTES:\n${lines.join('\n')}`)
      }
    }

    // 6. Checklist del turno activo (encargados, chef, cocina)
    if (canSeeKitchen) {
      const { data: activeShift } = await supabase
        .from('kitchen_shifts')
        .select('id, shift_type, status')
        .eq('shift_date', todayStr)
        .in('status', ['pending', 'in_progress'])
        .limit(1)
        .maybeSingle()

      if (activeShift) {
        const { data: checklistItems } = await supabase
          .from('checklist_items')
          .select('title, status, completed_by_profile:completed_by(first_name)')
          .eq('kitchen_shift_id', activeShift.id)

        const items = (checklistItems ?? []) as unknown as ChecklistItemRow[]
        const pending = items.filter((i) => i.status === 'pending')
        const done = items.filter((i) => i.status === 'done')

        sections.push(`COCINA — TURNO ${activeShift.shift_type === 'morning' ? 'MAÑANA' : 'NOCHE'} (${activeShift.status}): ${done.length}/${items.length} tareas completadas, ${pending.length} pendientes`)

        if (pending.length > 0) {
          const lines = pending.slice(0, 10).map((i) => `- ⬜ ${i.title}`)
          sections.push(`TAREAS PENDIENTES COCINA:\n${lines.join('\n')}`)
        }
      }
    }

    // 7. Avisos urgentes y activos (todos los roles)
    if (canSeeAnnouncements) {
      const { data: announcements } = await supabase
        .from('announcements')
        .select('title, body, priority, type, created_at')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(20)

      const announcementRows = (announcements ?? []) as AnnouncementRow[]
      const urgent = announcementRows.filter((a) => a.priority === 'alta' || a.priority === 'critica')

      if (urgent.length > 0) {
        const lines = urgent.map((a) =>
          `- [${a.priority.toUpperCase()}] ${a.title}: ${a.body.slice(0, 120)}${a.body.length > 120 ? '...' : ''}`
        )
        sections.push(`AVISOS URGENTES:\n${lines.join('\n')}`)
      }

      sections.push(`AVISOS ACTIVOS: ${announcementRows.length} totales, ${urgent.length} urgentes`)
    }

    // 8. Proveedores (solo encargados)
    if (canSeeSuppliers) {
      const { data: suppliers } = await supabase
        .from('suppliers')
        .select('name, contact_name, phone, email, category, notes')
        .eq('is_active', true)
        .order('name', { ascending: true })

      const supplierRows = (suppliers ?? []) as SupplierRow[]

      if (supplierRows.length > 0) {
        const lines = supplierRows.map((s) =>
          `- ${s.name}${s.category ? ` (${s.category})` : ''}${s.contact_name ? ` | contacto: ${s.contact_name}` : ''}${s.phone ? ` | tel: ${s.phone}` : ''}${s.email ? ` | email: ${s.email}` : ''}${s.notes ? ` | nota: ${s.notes}` : ''}`
        )
        sections.push(`PROVEEDORES ACTIVOS:\n${lines.join('\n')}`)
      }
    }

    // 9. Recetas — full detail for cocina/chef/encargado/socio, menu description for all
    if (canSeeRecipesFull) {
      const { data: recipes } = await supabase
        .from('recipes')
        .select('name, category, yield_portions, preparation, notes, ingredients')
        .eq('is_active', true)
        .order('category')
        .order('name')

      if (recipes && recipes.length > 0) {
        const lines = recipes.map((r) => {
          const ings = Array.isArray(r.ingredients) ? (r.ingredients as Array<{ name: string; qty: string }>).map(i => `${i.name} ${i.qty}`).join(', ') : ''
          return `- **${r.name}** (${r.category}, rinde ${r.yield_portions}): ${ings}\n  Preparación: ${(r.preparation ?? '').slice(0, 200)}${r.notes ? `\n  Notas: ${r.notes}` : ''}`
        })
        sections.push(`RECETAS CON DETALLE (${recipes.length}):\n${lines.join('\n')}`)
      }
    } else if (canSeeRecipesMenu) {
      // Runners and baristas: see menu descriptions (what each dish IS, how it's served)
      const { data: recipes } = await supabase
        .from('recipes')
        .select('name, category, notes, preparation')
        .eq('is_active', true)
        .order('category')
        .order('name')

      if (recipes && recipes.length > 0) {
        const lines = recipes.map((r) => {
          // Short description without quantities
          const desc = (r.preparation ?? '').split('.').slice(0, 2).join('.') + '.'
          return `- **${r.name}** (${r.category}): ${desc}${r.notes ? ` — ${r.notes}` : ''}`
        })
        sections.push(`CARTA / MENÚ (${recipes.length} platos):\nEstos son los platos que vendemos. Usá esta info para informar al cliente qué contiene cada plato.\n${lines.join('\n')}`)
      }
    }

    // 10. Protocolo de atención — always available for runners and baristas
    if (['runner', 'barista', 'socio', 'encargado'].includes(role)) {
      sections.push(`PROTOCOLO DE ATENCIÓN — LA VIEJA ESCUELA:

**SALUDO Y BIENVENIDA:**
- Saludar siempre al cliente cuando entra: "¡Bienvenidos a La Vieja Escuela!"
- Presentarse: "Mi nombre es [tu nombre], voy a atenderlos hoy"
- Acompañar a la mesa si es posible

**SERVICIO EN MESA:**
- Servir SIEMPRE por el lado izquierdo del comensal
- Retirar por el lado derecho
- Las bebidas se sirven primero, antes que la comida
- El plato se presenta con el logo del plato mirando al comensal
- Usar la vajilla correspondiente a cada plato (no improvisar)
- Cubiertos van antes que llegue el plato

**VAJILLA:**
- Café cortado/espresso → pocillo
- Café con leche/cappuccino → taza 150ml
- Latte/especialidades → taza 200ml o vaso según corresponda
- Agua/jugos → vaso bombe
- Cerveza → vaso correspondiente al estilo
- Postres → plato de postre con cubierto correspondiente
- Platos principales → plato grande
- Entradas → plato chico

**DURANTE EL SERVICIO:**
- Estar presente en el salón, no desaparecer
- Pasar por las mesas periódicamente ("¿Todo bien? ¿Necesitan algo?")
- Si hay demora en cocina, avisar al cliente proactivamente: "Les comento que el plato tiene unos minutitos más de lo habitual, ya sale"
- NO esperar a que el cliente se queje por la demora
- Comunicar tiempos aproximados cuando toman el pedido si hay mucha cola en cocina

**DEMORAS:**
- Tiempo normal de salida: 15-20 minutos
- Si pasa de 25 minutos, avisar al cliente
- Si pasa de 30 minutos, hablar con cocina y ofrecer algo al cliente (agua, pan)
- SIEMPRE comunicar, nunca ignorar la espera

**CUENTA Y DESPEDIDA:**
- Preguntar si desean algo más antes de traer la cuenta
- Agradecer la visita: "¡Gracias por venir, los esperamos pronto!"
- Si hubo algún problema, disculparse y asegurar que se resuelve`)
    }

  } catch (err) {
    console.error('Error al recopilar contexto:', err)
    sections.push('NOTA: Hubo errores al obtener algunos datos del sistema.')
  }

  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// Respuesta basada en keywords (fallback sin IA)
// ---------------------------------------------------------------------------

function buildKeywordResponse(question: string, context: string): string {
  const q = question.toLowerCase()

  const getSection = (header: string): string => {
    const regex = new RegExp(`${header}[^]*?(?=\\n\\n|$)`, 'i')
    const match = context.match(regex)
    return match ? match[0] : ''
  }

  if (q.includes('trabaj') || q.includes('quien') || q.includes('equipo') || q.includes('hoy')) {
    const asistencia = getSection('ASISTENCIA HOY')
    const turnos = getSection('TURNOS HOY')
    return asistencia + (turnos ? '\n\n' + turnos : '')
  }

  if (q.includes('stock') || q.includes('rojo') || q.includes('critico') || q.includes('falt')) {
    return [getSection('STOCK CRÍTICO'), getSection('STOCK EN ATENCIÓN'), getSection('RESUMEN STOCK')].filter(Boolean).join('\n\n')
  }

  if (q.includes('barra') || q.includes('cafe') || q.includes('barista')) {
    return [getSection('BARRA'), getSection('PEDIDOS DE BARRA')].filter(Boolean).join('\n\n')
  }

  if (q.includes('pedir') || q.includes('comprar') || q.includes('pedido') || q.includes('producto')) {
    return [getSection('STOCK CRÍTICO'), getSection('BARRA — ITEMS BAJOS'), getSection('PEDIDOS DE BARRA')].filter(Boolean).join('\n\n') || 'No hay productos pendientes de pedido.'
  }

  if (q.includes('cocina') || q.includes('checklist') || q.includes('tarea')) {
    return [getSection('COCINA'), getSection('TAREAS PENDIENTES')].filter(Boolean).join('\n\n')
  }

  if (q.includes('aviso') || q.includes('urgent') || q.includes('notificacion') || q.includes('alerta')) {
    return [getSection('AVISOS URGENTES'), getSection('AVISOS ACTIVOS')].filter(Boolean).join('\n\n')
  }

  if (q.includes('proveedor') || q.includes('supplier')) {
    return getSection('PROVEEDORES ACTIVOS') || 'No hay proveedores registrados.'
  }

  if (q.includes('turno') || q.includes('horario') || q.includes('manana') || q.includes('mañana')) {
    return [getSection('TURNOS HOY'), getSection('TURNOS MAÑANA')].filter(Boolean).join('\n\n') || 'No hay turnos programados.'
  }

  if (q.includes('receta') || q.includes('plato') || q.includes('menu')) {
    return getSection('RECETAS') || 'No hay recetas cargadas.'
  }

  return `Acá tenés un resumen general:\n\n${context}`
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest

    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json({ error: 'El campo "message" es obligatorio.' }, { status: 400 })
    }

    const message = body.message.trim()
    if (message.length === 0) {
      return NextResponse.json({ error: 'El mensaje no puede estar vacío.' }, { status: 400 })
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres.` }, { status: 400 })
    }

    // Validar autenticación y rol
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, first_name')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'No se pudo obtener tu perfil.' }, { status: 403 })
    }

    const userRole = profile.role as string

    // Rate limiting
    if (isRateLimited(user.id)) {
      return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 })
    }

    // Recopilar contexto filtrado por rol
    const context = await gatherContext(supabase, userRole)

    // Construir mensajes con historial
    const conversationMessages: { role: 'user' | 'assistant'; content: string }[] = []

    // Incluir historial previo (máx 10 mensajes)
    if (body.history && Array.isArray(body.history)) {
      const recentHistory = body.history.slice(-10)
      for (const msg of recentHistory) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          conversationMessages.push({
            role: msg.role,
            content: msg.content,
          })
        }
      }
    }

    // Mensaje actual con contexto
    conversationMessages.push({
      role: 'user',
      content: `[CONTEXTO ACTUAL DEL SISTEMA — datos en tiempo real]\n\n${context}\n\n---\n\nPregunta de ${profile.first_name} (${userRole}): ${message}`,
    })

    // --- Intentar OpenRouter ---
    const openRouterKey = process.env.OPENROUTER_API_KEY

    if (openRouterKey) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://laviejaescuela.com',
            'X-Title': 'La Vieja Escuela - Sala de Profes',
          },
          body: JSON.stringify({
            model: 'anthropic/claude-sonnet-4',
            max_tokens: 1024,
            temperature: 0.3,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...conversationMessages,
            ],
          }),
        })

        if (response.ok) {
          const data = await response.json()
          const responseText = data.choices?.[0]?.message?.content ?? 'No pude generar una respuesta.'
          return NextResponse.json({ response: responseText })
        }

        console.error('Error en OpenRouter API:', response.status, await response.text())
      } catch (apiError) {
        console.error('Error al llamar a OpenRouter:', apiError)
      }
    }

    // --- Fallback Anthropic API ---
    const anthropicKey = process.env.ANTHROPIC_API_KEY

    if (anthropicKey) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: conversationMessages,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          const responseText = data.content?.[0]?.text ?? 'No pude generar una respuesta.'
          return NextResponse.json({ response: responseText })
        }

        console.error('Error en Anthropic API:', response.status, await response.text())
      } catch (apiError) {
        console.error('Error al llamar a Anthropic:', apiError)
      }
    }

    // --- Fallback keywords ---
    const fallbackResponse = buildKeywordResponse(message, context)
    return NextResponse.json({ response: fallbackResponse })
  } catch (error) {
    console.error('Error en chatbot API:', error)
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 })
  }
}
