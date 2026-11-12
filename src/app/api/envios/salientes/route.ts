import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import {
  ROLES_ENVIOS,
  crearEnvio,
  consultarEnCamino,
  faltaConfigurar,
  insumosEnviables,
  listarEnvios,
  resumenEnvios,
  type ItemPedido,
} from '@/lib/envios/salientes'

// ---------------------------------------------------------------------------
// /api/envios/salientes — «Enviar a la 24» (cocina, chef, encargado, socio)
//   GET  → envíos de los últimos 30 días
//          ?insumos=1   también los insumos para el buscador
//          ?consultar=1 antes le pregunta a la 24 por los que están en camino
//          ?resumen=1   solo cuántos hay en camino / pendientes (para Hoy)
//   POST { items: [{ stock_item_id, cantidad }], nota } → crea y manda
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = await requireRole(ROLES_ENVIOS)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const q = request.nextUrl.searchParams

  if (q.get('resumen') === '1') return NextResponse.json(await resumenEnvios(admin))

  if (q.get('consultar') === '1') await consultarEnCamino(admin, { hastaMs: 15_000, limite: 10 })

  const [envios, insumos] = await Promise.all([
    listarEnvios(admin),
    q.get('insumos') === '1' ? insumosEnviables(admin) : Promise.resolve(null),
  ])
  return NextResponse.json({ envios, ...(insumos ? { insumos } : {}), falta_configurar: faltaConfigurar() })
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(ROLES_ENVIOS)
  if (auth.response) return auth.response
  const body = (await request.json().catch(() => null)) as { items?: ItemPedido[]; nota?: string | null } | null
  if (!body) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })

  const res = await crearEnvio(createAdminClient(), {
    userId: auth.user.id,
    items: Array.isArray(body.items) ? body.items : [],
    nota: typeof body.nota === 'string' ? body.nota : null,
  })
  if (!res.ok) return NextResponse.json({ error: res.error, id: res.id ?? null, estado: res.estado ?? null }, { status: res.status })
  return NextResponse.json(res, { status: res.estado === 'en_camino' ? 201 : 202 })
}
