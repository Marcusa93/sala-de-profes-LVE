import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cruceTolva } from '@/lib/tolva/cruce'

// ---------------------------------------------------------------------------
// GET /api/tolva/cruce?dias=14
// ---------------------------------------------------------------------------
// Para cada turno con registro de tolva: el café usado según la tolva y el
// que piden las ventas de café del mismo turno (gramos de cada receta).
// El cálculo está en lib/tolva/cruce (lo usa también el control interno).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export type CruceRow = {
  log_date: string
  shift: 'TM' | 'TT'
  consumo_real_gr: number | null
  cafes_vendidos: number
  consumo_esperado_gr: number
  diferencia_gr: number | null
  /** El consumo da negativo: cargaron café y no lo anotaron */
  falta_agregado: boolean
}

export type CruceResponse = {
  rows: CruceRow[]
  gr_por_cafe: number
  sin_vinculo?: boolean
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dias = Math.min(30, Math.max(1, Number(request.nextUrl.searchParams.get('dias') ?? 14) || 14))
  try {
    const c = await cruceTolva(supabase, dias)
    const rows: CruceRow[] = c.turnos
      .filter((t) => t.estado !== 'sin_registro')
      .map((t) => ({
        log_date: t.fecha,
        shift: t.turno,
        consumo_real_gr: t.real,
        cafes_vendidos: t.cafes,
        consumo_esperado_gr: t.esperado,
        diferencia_gr: t.diferencia,
        falta_agregado: t.estado === 'falta_agregado',
      }))
    return NextResponse.json({ rows, gr_por_cafe: c.gr_por_cafe, sin_vinculo: c.productos === 0 } satisfies CruceResponse)
  } catch (err) {
    console.error('[tolva/cruce]', err)
    return NextResponse.json({ error: 'No se pudo cruzar con las ventas' }, { status: 500 })
  }
}
