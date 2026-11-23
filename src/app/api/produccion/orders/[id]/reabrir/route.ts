import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROLES_VALIDAN_PRODUCCION } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { sendPushToUser } from '@/lib/push/send'
import { notaDelCambio, puedeCambiarValidacion, type OrdenParaCambiar } from '@/lib/produccion/cambiar-validacion'

// ---------------------------------------------------------------------------
// POST /api/produccion/orders/[id]/reabrir   body: { motivo: string }
// ---------------------------------------------------------------------------
// Vuelve a abrir una producción rechazada por error: queda otra vez "para
// confirmar" y se confirma normal. Una rechazada nunca movió stock, así que
// no se toca la app ni Fudo. Reglas en lib/produccion/cambiar-validacion.
// ---------------------------------------------------------------------------

const MOTIVO_MIN = 3
const MOTIVO_MAX = 500

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
      return NextResponse.json({ error: 'Solo quien la rechazó, un encargado o un socio la puede volver a abrir' }, { status: 403 })
    }

    const { id: idStr } = await params
    const id = Number(idStr)
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await request.json().catch(() => ({})) as { motivo?: unknown }
    const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, MOTIVO_MAX) : ''
    if (motivo.length < MOTIVO_MIN) return NextResponse.json({ error: 'Escribí por qué la volvés a abrir' }, { status: 400 })

    const admin = createAdminClient()
    // '*' y no columnas sueltas: validacion_deshecha_at existe solo con la
    // migración 20261123 (sin ella, pedirla rompería la consulta)
    const { data: order, error: orderErr } = await admin
      .from('production_orders')
      .select('*')
      .eq('id', id)
      .single()
    if (orderErr || !order) return NextResponse.json({ error: 'Producción no encontrada' }, { status: 404 })

    const permiso = puedeCambiarValidacion(profile.role, user.id, order as OrdenParaCambiar)
    if (!permiso.ok) return NextResponse.json({ error: permiso.error }, { status: order.status === 'rejected' ? 403 : 409 })
    if (permiso.cambio !== 'reabrir') return NextResponse.json({ error: 'Esta producción no está rechazada' }, { status: 409 })

    // Por las dudas (igual que al rechazar): si tiene movimientos de stock sin
    // compensar no se reabre a ciegas. Los anteriores a «deshacer validación»
    // ya quedaron compensados.
    const deshecha = (order as { validacion_deshecha_at?: string | null }).validacion_deshecha_at ?? null
    let movs = admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('production_order_id', id)
    if (deshecha) movs = movs.gt('created_at', deshecha)
    const { count } = await movs
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: 'Esta producción tiene movimientos de stock: no se puede volver a abrir. Avisale a un socio.' }, { status: 409 })
    }

    const quien = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
    const ahora = new Date().toISOString()
    const { data: hecho, error: updErr } = await admin
      .from('production_orders')
      .update({
        status: 'pending_review',
        reviewed_by: null,
        reviewed_at: null,
        review_notes: notaDelCambio('reabrir', quien, motivo, order.review_notes),
        updated_at: ahora,
      })
      .eq('id', id)
      .eq('status', 'rejected')
      .select('id')
    if (updErr) throw updErr
    if (!hecho || hecho.length === 0) {
      return NextResponse.json({ error: 'La producción cambió mientras la abrías. Recargá y fijate.' }, { status: 409 })
    }

    logAudit(admin, {
      userId: user.id,
      userName: quien,
      action: 'reopen_production_order',
      module: 'produccion',
      entityType: 'production_order',
      entityId: String(id),
      description: `${quien ?? 'Alguien'}: volvió a abrir "${order.name}" (estaba rechazada) — ${motivo}`.slice(0, 1000),
      metadata: {
        motivo,
        rechazo_anterior: order.review_notes,
        rechazada_por: order.reviewed_by,
        rechazada_at: order.reviewed_at,
        cargada_por: order.chef_id,
      },
    })

    if (order.chef_id && order.chef_id !== user.id) {
      sendPushToUser(order.chef_id, {
        title: '↩️ Producción abierta de nuevo',
        body: `"${order.name}" ya no está rechazada: queda para confirmar. ${motivo}`,
        url: `/cocina/produccion/${id}`,
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      order_id: id,
      status: 'pending_review',
      message: 'Producción abierta de nuevo: queda para confirmar.',
    })
  } catch (err) {
    console.error('[POST /api/produccion/orders/[id]/reabrir]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
