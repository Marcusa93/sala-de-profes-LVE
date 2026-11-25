import { NextResponse } from 'next/server'
import { sesionOperaciones } from '@/lib/operaciones/acceso'
import { cruceLeche } from '@/lib/leche/cruce'

// ---------------------------------------------------------------------------
// /api/operaciones/leche — leche contra cafés con leche, para el control interno
// ---------------------------------------------------------------------------
// Últimos 14 días, de un conteo de leche al siguiente: lo que había + lo que
// entró − lo que quedó, contra lo que piden las ventas de Fudo según las
// recetas. Solo socios y Joaquín (lib/operaciones/acceso).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const { sesion, response } = await sesionOperaciones()
  if (response) return response
  try {
    return NextResponse.json(await cruceLeche(sesion.admin, 14))
  } catch (err) {
    console.error('[operaciones] leche', err)
    return NextResponse.json({ error: 'No se pudo cruzar la leche con las ventas' }, { status: 500 })
  }
}
