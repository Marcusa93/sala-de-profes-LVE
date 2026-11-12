import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/supabase/require-role'
import { probarConexion } from '@/lib/envios/salientes'

// ---------------------------------------------------------------------------
// POST /api/envios/salientes/prueba — prueba la conexión con la 24 (socio y
// encargado). Manda un envío de prueba con "avisar": false, lo consulta y lo
// anula. No guarda nada en Santa Fe ni toca el stock.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response
  return NextResponse.json(await probarConexion())
}
