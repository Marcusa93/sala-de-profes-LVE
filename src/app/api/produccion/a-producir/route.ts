import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { ROLES_A_PRODUCIR, calcularAProducir } from '@/lib/produccion/a-producir'

// ---------------------------------------------------------------------------
// GET /api/produccion/a-producir — «Qué producir» del encargado de producción:
// por cada producto de la lista, lo que falta en Santa Fe y en la 24 menos lo
// ya cargado sin confirmar. Ver lib/produccion/a-producir.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireRole(ROLES_A_PRODUCIR)
  if (auth.response) return auth.response
  return NextResponse.json(await calcularAProducir(createAdminClient()))
}
