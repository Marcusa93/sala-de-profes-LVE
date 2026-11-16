import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { insumosEnviables } from '@/lib/envios/salientes'
import { ROLES_LO_DE_HOY, datosLoDeHoy } from '@/lib/produccion/lo-de-hoy'

// ---------------------------------------------------------------------------
// GET /api/produccion/lo-de-hoy — «Lo de hoy» de la jefa de cocina
//   (socio, encargado, chef). ?insumos=1 también todos los insumos activos,
//   para cargar merma de algo que no está en la lista.
// Las acciones usan las rutas de siempre:
//   confirmar  → PATCH /api/produccion/orders/<id> (corregir lo que salió) y
//                POST  /api/produccion/orders/<id>/complete
//   no está    → POST  /api/produccion/orders/<id>/reject
//   conteo     → POST  /api/stock/conteo-diario
//   merma      → POST  /api/stock/waste
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireRole(ROLES_LO_DE_HOY)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const [datos, insumos] = await Promise.all([
    datosLoDeHoy(admin, auth.user),
    request.nextUrl.searchParams.get('insumos') === '1' ? insumosEnviables(admin) : Promise.resolve(null),
  ])
  return NextResponse.json({ ...datos, ...(insumos ? { insumos } : {}) })
}
