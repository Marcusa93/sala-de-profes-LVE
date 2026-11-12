import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { ROLES_ENVIOS, anularEnvio, consultarEnvio, mandarEnvio } from '@/lib/envios/salientes'

// ---------------------------------------------------------------------------
// POST /api/envios/salientes/<id>  { accion }
//   anular     → solo antes de que llegue: la 24 lo borra de "en camino" y
//                el stock vuelve acá. Si la 24 ya lo recibió (409), no se puede.
//   reintentar → vuelve a mandar uno que quedó pendiente (la 24 no respondía)
//   consultar  → le pregunta a la 24 si ya llegó
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(ROLES_ENVIOS)
  if (auth.response) return auth.response
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { accion?: string } | null
  const admin = createAdminClient()

  if (body?.accion === 'anular') {
    const res = await anularEnvio(admin, id, auth.user.id)
    if (!res.ok) return NextResponse.json({ error: res.error, estado: res.estado ?? null }, { status: res.status })
    return NextResponse.json(res)
  }
  if (body?.accion === 'reintentar') {
    const res = await mandarEnvio(admin, id)
    if (!res.ok) return NextResponse.json({ error: res.error, estado: res.estado ?? null }, { status: res.status })
    return NextResponse.json(res)
  }
  if (body?.accion === 'consultar') {
    const res = await consultarEnvio(admin, id)
    if (!res.respondio) return NextResponse.json({ error: 'La 24 no respondió: probá de nuevo en un rato' }, { status: 502 })
    return NextResponse.json(res)
  }
  return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
}
