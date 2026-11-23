import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROLES_VALIDAN_PRODUCCION } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { sendPushToUser } from '@/lib/push/send'
import { notaDelCambio, puedeCambiarValidacion, type OrdenParaCambiar } from '@/lib/produccion/cambiar-validacion'

// ---------------------------------------------------------------------------
// POST /api/produccion/orders/[id]/deshacer   body: { motivo: string }
// ---------------------------------------------------------------------------
// Deshace la validación de una producción confirmada por error: los insumos
// vuelven al stock y lo producido sale, en la app (revert_production_order,
// migración 20261123) y en Fudo. La producción vuelve a "para confirmar" para
// corregirla con «Falta algo» y confirmarla, o rechazarla.
// Lo que se contó después de confirmarla no se toca (el conteo ya dejó el
// número real). Reglas en lib/produccion/cambiar-validacion.
// ---------------------------------------------------------------------------

const MOTIVO_MIN = 3
const MOTIVO_MAX = 500

type Mov = { stock_item_id: string; change: number; movement_id?: string | null }
type Resultado = {
  success: boolean
  error?: string
  code?: string
  movements?: Mov[]
  no_tocados?: { stock_item_id: string; nombre: string }[]
  negativos?: { stock_item_id: string; nombre: string; unidad: string; cantidad: number }[]
  costo?: string
  lotes_borrados?: number
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()
    if (!profile || !(ROLES_VALIDAN_PRODUCCION as readonly string[]).includes(profile.role)) {
      return NextResponse.json({ error: 'Solo quien la validó, un encargado o un socio la puede cambiar' }, { status: 403 })
    }

    const { id: idStr } = await params
    const id = Number(idStr)
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await request.json().catch(() => ({})) as { motivo?: unknown }
    const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, MOTIVO_MAX) : ''
    if (motivo.length < MOTIVO_MIN) return NextResponse.json({ error: 'Escribí por qué la deshacés' }, { status: 400 })

    const admin = createAdminClient()
    const { data: order, error: orderErr } = await admin
      .from('production_orders')
      .select('id, name, status, chef_id, reviewed_by, reviewed_at, completed_at')
      .eq('id', id)
      .single()
    if (orderErr || !order) return NextResponse.json({ error: 'Producción no encontrada' }, { status: 404 })

    const permiso = puedeCambiarValidacion(profile.role, user.id, order as OrdenParaCambiar)
    if (!permiso.ok) return NextResponse.json({ error: permiso.error }, { status: order.status === 'completed' ? 403 : 409 })
    if (permiso.cambio !== 'deshacer') return NextResponse.json({ error: 'Esta producción no está confirmada' }, { status: 409 })

    // Igual que al confirmar: sin Fudo no se toca nada (si no, quedaría
    // deshecha en la app y no en Fudo)
    const { fudo } = await import('@/lib/fudoClient')
    const conexion = await fudo.testConnection()
    if (!conexion.ok) {
      return NextResponse.json({ error: `Fudo no responde (${conexion.error}). No se deshizo nada: probá en un rato.` }, { status: 502 })
    }

    const quien = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
    const { data, error } = await admin.rpc('revert_production_order', {
      p_order_id: id,
      p_user_id: user.id,
      p_nota: notaDelCambio('deshacer', quien, motivo),
    })
    if (error?.code === 'PGRST202') {
      return NextResponse.json({ error: 'Todavía no se puede deshacer: falta actualizar la base (migración 20261123).' }, { status: 409 })
    }
    if (error) throw error

    const r = data as Resultado
    if (!r?.success) {
      return NextResponse.json({ error: r?.error ?? 'No se pudo deshacer la validación' }, { status: r?.code === 'no_confirmada' ? 409 : 400 })
    }

    // Fudo: la misma vuelta atrás (los insumos suben, lo producido baja)
    const avisos: string[] = []
    const movimientos = r.movements ?? []
    let fudoSummary: { synced: number; errors: string[]; encolados: string[] } | null = null
    if (movimientos.length > 0) {
      try {
        const { syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
        fudoSummary = await syncProductionToFudo(admin, movimientos, user.id)
        if (fudoSummary.encolados.length > 0) avisos.push(`En Fudo queda pendiente (se reintenta solo): ${fudoSummary.encolados.map((e) => e.split(':')[0]).join(', ')}`)
        if (fudoSummary.errors.length > 0) avisos.push(`No se pudo actualizar en Fudo: ${fudoSummary.errors.join('; ')}`)
      } catch (err) {
        avisos.push(`Fudo no se actualizó (${err instanceof Error ? err.message : 'error'}): la app se vuelve a alinear con Fudo en la próxima lectura.`)
      }
    }

    const noTocados = (r.no_tocados ?? []).map((n) => n.nombre)
    const negativos = r.negativos ?? []
    if (noTocados.length > 0) avisos.push(`No se tocó ${noTocados.join(', ')}: se contó después de confirmar, así que el conteo ya tiene el número real.`)
    if (negativos.length > 0) avisos.push(`Quedó en negativo: ${negativos.map((n) => n.nombre).join(', ')} (ya se había usado o mandado). Se acomoda con el próximo conteo.`)

    logAudit(admin, {
      userId: user.id,
      userName: quien,
      action: 'revert_production_order',
      module: 'produccion',
      entityType: 'production_order',
      entityId: String(id),
      description: `${quien ?? 'Alguien'}: deshizo la validación de "${order.name}" — ${motivo}${noTocados.length ? ` · no se tocó (contado después): ${noTocados.join(', ')}` : ''}${negativos.length ? ` · quedó en negativo: ${negativos.map((n) => n.nombre).join(', ')}` : ''}`.slice(0, 1000),
      metadata: {
        motivo,
        validada_at: order.completed_at,
        validada_por: order.reviewed_by,
        cargada_por: order.chef_id,
        movements: movimientos,
        no_tocados: r.no_tocados,
        negativos,
        costo: r.costo,
        lotes_borrados: r.lotes_borrados,
        fudo_synced: fudoSummary ? fudoSummary.errors.length === 0 && fudoSummary.encolados.length === 0 : movimientos.length === 0,
      },
    })

    if (order.chef_id && order.chef_id !== user.id) {
      sendPushToUser(order.chef_id, {
        title: '↩️ Producción para revisar de nuevo',
        body: `Se deshizo la validación de "${order.name}": ${motivo}`,
        url: `/cocina/produccion/${id}`,
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      order_id: id,
      status: 'pending_review',
      message: 'Validación deshecha: el stock volvió y la producción quedó para confirmar de nuevo.',
      warnings: avisos,
      no_tocados: noTocados,
      negativos,
      fudo: fudoSummary,
    })
  } catch (err) {
    console.error('[POST /api/produccion/orders/[id]/deshacer]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
