import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatRequest = {
  message: string
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
  profiles: { first_name: string; last_name: string } | null
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSemaphore(
  currentQty: number,
  minQty: number,
): 'green' | 'yellow' | 'red' {
  if (currentQty <= 0) return 'red'
  if (currentQty <= minQty) return 'red'
  if (currentQty <= minQty * 1.5) return 'yellow'
  return 'green'
}

// ---------------------------------------------------------------------------
// Recopilar contexto de datos
// ---------------------------------------------------------------------------

async function gatherContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const tomorrowStr = format(
    new Date(today.getTime() + 86400000),
    'yyyy-MM-dd',
  )

  const sections: string[] = []

  try {
    // 1. Asistencia de hoy
    const { data: attendance } = await supabase
      .from('attendance_logs')
      .select(
        'clock_in_at, clock_out_at, profiles!attendance_logs_user_id_fkey(first_name, last_name, role)',
      )
      .eq('operative_date', todayStr)

    const attendanceRows = (attendance ?? []) as unknown as AttendanceRow[]

    if (attendanceRows.length > 0) {
      const lines = attendanceRows.map((a) => {
        const name = a.profiles ? `${a.profiles.first_name} ${a.profiles.last_name}` : 'Desconocido'
        const role = a.profiles?.role ?? '?'
        const checkIn = a.clock_in_at?.slice(0, 5) ?? '?'
        const checkOut = a.clock_out_at ? a.clock_out_at.slice(0, 5) : 'aun en turno'
        return `- ${name} (${role}): ingreso ${checkIn}, egreso ${checkOut}`
      })
      sections.push(
        `ASISTENCIA HOY (${format(today, "EEEE d 'de' MMMM", { locale: es })}):\n${lines.join('\n')}`,
      )
    } else {
      sections.push('ASISTENCIA HOY: Nadie ha marcado ingreso hoy.')
    }

    // 2. Egresos sin marcar
    const sinEgreso = attendanceRows.filter(
      (a) => a.clock_in_at && !a.clock_out_at,
    )
    if (sinEgreso.length > 0) {
      const lines = sinEgreso.map(
        (a) =>
          `- ${a.profiles ? `${a.profiles.first_name} ${a.profiles.last_name}` : 'Desconocido'} (ingreso: ${a.clock_in_at?.slice(0, 5)})`,
      )
      sections.push(`EGRESOS SIN MARCAR:\n${lines.join('\n')}`)
    } else {
      sections.push('EGRESOS SIN MARCAR: Todos los ingresos tienen egreso marcado, o nadie ha ingresado.')
    }

    // 3. Turnos de hoy y manana
    const { data: shifts } = await supabase
      .from('shifts')
      .select('shift_date, start_time, end_time, profiles!shifts_user_id_fkey(first_name, last_name)')
      .in('shift_date', [todayStr, tomorrowStr])
      .order('shift_date', { ascending: true })
      .order('start_time', { ascending: true })

    const shiftRows = (shifts ?? []) as unknown as ShiftRow[]

    if (shiftRows.length > 0) {
      const todayShifts = shiftRows.filter((s) => s.shift_date === todayStr)
      const tomorrowShifts = shiftRows.filter((s) => s.shift_date === tomorrowStr)

      if (todayShifts.length > 0) {
        const lines = todayShifts.map(
          (s) =>
            `- ${s.profiles ? `${s.profiles.first_name} ${s.profiles.last_name}` : 'Desconocido'}: ${s.start_time.slice(0, 5)} - ${s.end_time.slice(0, 5)}`,
        )
        sections.push(`TURNOS HOY:\n${lines.join('\n')}`)
      } else {
        sections.push('TURNOS HOY: No hay turnos programados para hoy.')
      }

      if (tomorrowShifts.length > 0) {
        const lines = tomorrowShifts.map(
          (s) =>
            `- ${s.profiles ? `${s.profiles.first_name} ${s.profiles.last_name}` : 'Desconocido'}: ${s.start_time.slice(0, 5)} - ${s.end_time.slice(0, 5)}`,
        )
        sections.push(`TURNOS MANANA:\n${lines.join('\n')}`)
      }
    } else {
      sections.push('TURNOS: No hay turnos programados para hoy ni manana.')
    }

    // 4. Stock
    const { data: stockItems } = await supabase
      .from('stock_items')
      .select('id, name, category, unit, current_qty, min_qty, supplier_id, suppliers(name)')
      .eq('is_active', true)
      .order('name', { ascending: true })

    const stockRows = (stockItems ?? []) as unknown as StockItemRow[]

    const redItems = stockRows.filter(
      (item) => getSemaphore(item.current_qty, item.min_qty) === 'red',
    )
    const yellowItems = stockRows.filter(
      (item) => getSemaphore(item.current_qty, item.min_qty) === 'yellow',
    )

    if (redItems.length > 0) {
      const lines = redItems.map(
        (item) =>
          `- ${item.name}: ${item.current_qty} ${item.unit} (minimo: ${item.min_qty})${item.suppliers?.name ? ` [proveedor: ${item.suppliers.name}]` : ''}`,
      )
      sections.push(`STOCK CRITICO (ROJO):\n${lines.join('\n')}`)
    } else {
      sections.push('STOCK CRITICO (ROJO): No hay items en estado critico.')
    }

    if (yellowItems.length > 0) {
      const lines = yellowItems.map(
        (item) =>
          `- ${item.name}: ${item.current_qty} ${item.unit} (minimo: ${item.min_qty})`,
      )
      sections.push(`STOCK EN ATENCION (AMARILLO):\n${lines.join('\n')}`)
    }

    // Productos para pedir (rojo + amarillo)
    const toPurchase = [...redItems, ...yellowItems]
    if (toPurchase.length > 0) {
      const lines = toPurchase.map(
        (item) =>
          `- ${item.name} (${item.current_qty}/${item.min_qty} ${item.unit})${item.suppliers?.name ? ` -> proveedor: ${item.suppliers.name}` : ''}`,
      )
      sections.push(`PRODUCTOS QUE HAY QUE PEDIR:\n${lines.join('\n')}`)
    } else {
      sections.push('PRODUCTOS QUE HAY QUE PEDIR: No hay productos pendientes de pedido.')
    }

    sections.push(`RESUMEN STOCK: ${stockRows.length} items totales, ${redItems.length} criticos, ${yellowItems.length} en atencion, ${stockRows.length - redItems.length - yellowItems.length} normales.`)

    // 5. Avisos urgentes y activos
    const { data: announcements } = await supabase
      .from('announcements')
      .select('title, body, priority, type, created_at')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(20)

    const announcementRows = (announcements ?? []) as AnnouncementRow[]

    const urgent = announcementRows.filter(
      (a) => a.priority === 'high' || a.priority === 'critical',
    )

    if (urgent.length > 0) {
      const lines = urgent.map(
        (a) =>
          `- [${a.priority.toUpperCase()}] ${a.title}: ${a.body.slice(0, 100)}${a.body.length > 100 ? '...' : ''}`,
      )
      sections.push(`AVISOS URGENTES:\n${lines.join('\n')}`)
    } else {
      sections.push('AVISOS URGENTES: No hay avisos urgentes activos.')
    }

    if (announcementRows.length > 0) {
      sections.push(`AVISOS ACTIVOS TOTALES: ${announcementRows.length}`)
    }

    // 6. Proveedores
    const { data: suppliers } = await supabase
      .from('suppliers')
      .select('name, contact_name, phone, email')
      .eq('is_active', true)
      .order('name', { ascending: true })

    const supplierRows = (suppliers ?? []) as SupplierRow[]

    if (supplierRows.length > 0) {
      const lines = supplierRows.map(
        (s) =>
          `- ${s.name}${s.contact_name ? ` (contacto: ${s.contact_name})` : ''}${s.phone ? ` tel: ${s.phone}` : ''}${s.email ? ` email: ${s.email}` : ''}`,
      )
      sections.push(`PROVEEDORES ACTIVOS:\n${lines.join('\n')}`)
    }
  } catch (err) {
    console.error('Error al recopilar contexto:', err)
    sections.push('NOTA: Hubo errores al obtener algunos datos.')
  }

  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// Respuesta basada en keywords (fallback sin IA)
// ---------------------------------------------------------------------------

function buildKeywordResponse(question: string, context: string): string {
  const q = question.toLowerCase()

  // Extraer secciones del contexto
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
    const rojo = getSection('STOCK CRITICO')
    const amarillo = getSection('STOCK EN ATENCION')
    const resumen = getSection('RESUMEN STOCK')
    return [rojo, amarillo, resumen].filter(Boolean).join('\n\n')
  }

  if (q.includes('pedir') || q.includes('comprar') || q.includes('pedido') || q.includes('producto')) {
    const toPurchase = getSection('PRODUCTOS QUE HAY QUE PEDIR')
    return toPurchase || 'No hay productos pendientes de pedido.'
  }

  if (q.includes('egreso') || q.includes('salida') || q.includes('sin marcar')) {
    const egresos = getSection('EGRESOS SIN MARCAR')
    return egresos || 'No hay datos de egresos.'
  }

  if (q.includes('aviso') || q.includes('urgent') || q.includes('notificacion') || q.includes('alerta')) {
    const urgentes = getSection('AVISOS URGENTES')
    const total = getSection('AVISOS ACTIVOS TOTALES')
    return [urgentes, total].filter(Boolean).join('\n\n')
  }

  if (q.includes('proveedor') || q.includes('supplier')) {
    const proveedores = getSection('PROVEEDORES ACTIVOS')
    return proveedores || 'No hay proveedores registrados.'
  }

  if (q.includes('turno') || q.includes('horario') || q.includes('manana')) {
    const hoy = getSection('TURNOS HOY')
    const manana = getSection('TURNOS MANANA')
    return [hoy, manana].filter(Boolean).join('\n\n') || 'No hay turnos programados.'
  }

  // Respuesta generica
  return `Aqui tienes un resumen general:\n\n${context}`
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest

    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json(
        { error: 'El campo "message" es obligatorio.' },
        { status: 400 },
      )
    }

    const message = body.message.trim()
    if (message.length === 0) {
      return NextResponse.json(
        { error: 'El mensaje no puede estar vacio.' },
        { status: 400 },
      )
    }

    // Validar autenticacion y rol
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'No autenticado.' },
        { status: 401 },
      )
    }

    // Verificar rol de encargado
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile || profile.role !== 'encargado') {
      return NextResponse.json(
        { error: 'No tienes permisos para acceder al chatbot.' },
        { status: 403 },
      )
    }

    // Recopilar contexto de datos
    const context = await gatherContext(supabase)

    // Intentar usar Claude API
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY

    if (anthropicApiKey) {
      try {
        const claudeResponse = await fetch(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicApiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1024,
              system:
                'Sos el asistente interno de La Vieja Escuela, una cafeteria. Solo respondes con datos reales de la aplicacion que te proporciono en el contexto. No inventes informacion. Responde de forma concisa, clara y en espanol. Si no tenes datos para responder, decilo. Usa emojis con moderacion para hacer la respuesta mas visual.',
              messages: [
                {
                  role: 'user',
                  content: `Contexto actual del sistema:\n\n${context}\n\n---\n\nPregunta del encargado: ${message}`,
                },
              ],
            }),
          },
        )

        if (claudeResponse.ok) {
          const claudeData = await claudeResponse.json()
          const responseText =
            claudeData.content?.[0]?.text ?? 'No pude generar una respuesta.'

          return NextResponse.json({ response: responseText })
        }

        // Si falla la API de Claude, usar fallback
        console.error(
          'Error en Claude API:',
          claudeResponse.status,
          await claudeResponse.text(),
        )
      } catch (claudeError) {
        console.error('Error al llamar a Claude API:', claudeError)
      }
    }

    // Fallback: respuesta basada en keywords
    const fallbackResponse = buildKeywordResponse(message, context)
    return NextResponse.json({ response: fallbackResponse })
  } catch (error) {
    console.error('Error en chatbot API:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor.' },
      { status: 500 },
    )
  }
}
