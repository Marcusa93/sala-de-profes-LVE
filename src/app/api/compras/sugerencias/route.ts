import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { generarSugerenciasCompra, type SugerenciasPayload } from '@/lib/compras/sugerencias'

// ---------------------------------------------------------------------------
// GET /api/compras/sugerencias — "qué pedir hoy", un solo motor.
// Ver src/lib/compras/sugerencias.ts. Cache 5 min (?fresh=1 la saltea).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 5 * 60 * 1000
let cached: { at: number; payload: SugerenciasPayload } | null = null

export async function GET(request: Request) {
  try {
    const auth = await requireRole(['socio', 'encargado', 'chef', 'cocina'])
    if (auth.response) return auth.response

    const fresh = new URL(request.url).searchParams.get('fresh') === '1'
    if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload)
    }

    const admin = createAdminClient()
    const payload = await generarSugerenciasCompra(admin)
    cached = { at: Date.now(), payload }
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/compras/sugerencias]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
