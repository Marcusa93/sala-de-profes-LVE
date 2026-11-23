import { NextResponse } from 'next/server'
import { sesionOperaciones } from '@/lib/operaciones/acceso'
import { ventasPorDia } from '@/lib/fudo/ventas-diarias'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { sumar } from '@/lib/operaciones/fechas'
import type { VentasOperaciones } from '@/lib/operaciones/tipos'

// ---------------------------------------------------------------------------
// /api/operaciones/ventas — ventas de Santa Fe de ayer y las 4 semanas antes
// ---------------------------------------------------------------------------
// Sale de la copia de Fudo (ventas_diarias), la misma que usa Ventas: lo que
// falta se trae de Fudo. Va aparte del resto para que la pantalla no espere a
// Fudo.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const { sesion, response } = await sesionOperaciones()
  if (response) return response
  const ayer = fechaOperativa(new Date(Date.now() - 86_400_000))
  try {
    const dias = await ventasPorDia(sesion.admin, sumar(ayer, -28), ayer)
    const body: VentasOperaciones = { ayer, dias: dias.map((d) => ({ fecha: d.fecha, total: d.total, tickets: d.tickets })), error: null }
    return NextResponse.json(body)
  } catch (err) {
    console.error('[operaciones] ventas', err)
    const body: VentasOperaciones = { ayer, dias: [], error: 'Fudo no respondió. Probá de nuevo en un rato.' }
    return NextResponse.json(body)
  }
}
