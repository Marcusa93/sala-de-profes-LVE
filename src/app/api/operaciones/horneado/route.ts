import { NextResponse } from 'next/server'
import { sesionOperaciones } from '@/lib/operaciones/acceso'
import { controlHorneado } from '@/lib/horneado/datos'

// ---------------------------------------------------------------------------
// /api/operaciones/horneado — control de horneado para el control interno
// ---------------------------------------------------------------------------
// Últimos 14 días hasta ayer: horneadas, vendidas en Fudo (sueltas, en el
// Clásico y PedidosYa), personal, sobrantes, budín de pan, tiradas y lo que
// no tiene explicación. Solo socios y Joaquín (lib/operaciones/acceso).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const { sesion, response } = await sesionOperaciones()
  if (response) return response
  try {
    return NextResponse.json(await controlHorneado(sesion.admin, 14))
  } catch (err) {
    console.error('[operaciones] horneado', err)
    return NextResponse.json({ error: 'No se pudo armar el control de horneado' }, { status: 500 })
  }
}
