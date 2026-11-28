import { NextResponse } from 'next/server'
import { sesionOperaciones } from '@/lib/operaciones/acceso'
import { cruceTolva } from '@/lib/tolva/cruce'
import { mermaCafe } from '@/lib/tolva/merma'

// ---------------------------------------------------------------------------
// /api/operaciones/cafe — tolva contra café vendido, para el control interno
// ---------------------------------------------------------------------------
// Últimos 14 días, turno por turno: lo que usó la tolva (inicio + agregado −
// final) contra lo que piden las ventas de Fudo según las recetas. Y la merma
// por día y semana de pesaje a pesaje, con el descarte (lib/tolva/merma, últimos
// 28 días). Solo socios y Joaquín (lib/operaciones/acceso).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const { sesion, response } = await sesionOperaciones()
  if (response) return response
  try {
    const [cruce, merma] = await Promise.all([
      cruceTolva(sesion.admin, 14),
      mermaCafe(sesion.admin, 28).catch((err) => { console.error('[operaciones] merma de café', err); return null }),
    ])
    return NextResponse.json({ ...cruce, merma })
  } catch (err) {
    console.error('[operaciones] cafe', err)
    return NextResponse.json({ error: 'No se pudo cruzar la tolva con las ventas' }, { status: 500 })
  }
}
