import { NextResponse } from 'next/server'
import { sesionOperaciones } from '@/lib/operaciones/acceso'
import { cruceTolva } from '@/lib/tolva/cruce'

// ---------------------------------------------------------------------------
// /api/operaciones/cafe — tolva contra café vendido, para el control interno
// ---------------------------------------------------------------------------
// Últimos 14 días, turno por turno: lo que usó la tolva (inicio + agregado −
// final) contra lo que piden las ventas de Fudo según las recetas. Solo
// socios y Joaquín (lib/operaciones/acceso).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const { sesion, response } = await sesionOperaciones()
  if (response) return response
  try {
    return NextResponse.json(await cruceTolva(sesion.admin, 14))
  } catch (err) {
    console.error('[operaciones] cafe', err)
    return NextResponse.json({ error: 'No se pudo cruzar la tolva con las ventas' }, { status: 500 })
  }
}
