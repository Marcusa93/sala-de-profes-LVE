import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { agregarRegistro, borrarRegistro, horneadoDeHoy } from '@/lib/horneado/datos'

// ---------------------------------------------------------------------------
// /api/horneado — tandas de medialunas, bollitos y tortillas (Santa Fe)
//   GET   lo cargado hoy y cuántas conviene hornear hoy
//   POST  { accion: 'agregar', pieza, tipo, cantidad, nota?, ayer? }
//         (ayer: true con tipo 'sobrante' = lo que quedó al cierre de ayer, si no se contó)
//         { accion: 'borrar', id }
// «Se tiraron» y «Al budín» se descuentan del insumo en Fudo como merma; al
// borrarlas, vuelven (lib/horneado/datos).
// Carga cualquiera del equipo (quien hornea); el control lo ven socios y
// Joaquín en /api/operaciones/horneado.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const Accion = z.discriminatedUnion('accion', [
  z.object({
    accion: z.literal('agregar'),
    pieza: z.enum(['medialuna', 'bollito', 'tortilla']),
    tipo: z.enum(['tanda', 'sobrante', 'budin', 'tirado']),
    cantidad: z.number().int().min(0).max(500),
    nota: z.string().max(200).nullable().optional(),
    /** Solo para «sobrante»: lo que quedó al cierre de ayer, cargado hoy */
    ayer: z.boolean().optional(),
  }),
  z.object({ accion: z.literal('borrar'), id: z.uuid() }),
])

async function usuario(): Promise<{ id: string; role: string; admin: SupabaseClient } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as unknown as SupabaseClient
  const { data } = await admin.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle()
  const p = data as { role: string; is_active: boolean } | null
  return p?.is_active ? { id: user.id, role: p.role, admin } : null
}

export async function GET() {
  const u = await usuario()
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const datos = await horneadoDeHoy(u.admin)
    const ids = [...new Set(datos.registros.map((r) => r.created_by).filter((x): x is string => !!x))]
    const nombres: Record<string, string> = {}
    if (ids.length) {
      const { data } = await u.admin.from('profiles').select('id, first_name').in('id', ids)
      for (const p of (data ?? []) as { id: string; first_name: string | null }[]) nombres[p.id] = p.first_name ?? ''
    }
    return NextResponse.json({ ...datos, nombres, yo: u.id, gestion: u.role === 'socio' || u.role === 'encargado' })
  } catch (err) {
    console.error('[horneado] GET', err)
    return NextResponse.json({ error: 'No se pudo cargar el horneado' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const u = await usuario()
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const r = Accion.safeParse(await request.json().catch(() => null))
  if (!r.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const a = r.data
  if (a.accion === 'agregar' && a.tipo !== 'sobrante' && a.cantidad === 0) {
    return NextResponse.json({ error: 'Poné cuántas' }, { status: 400 })
  }
  if (a.accion === 'agregar' && a.ayer && a.tipo !== 'sobrante') {
    return NextResponse.json({ error: 'De ayer solo se carga lo que sobró' }, { status: 400 })
  }
  const res = a.accion === 'agregar'
    ? await agregarRegistro(u.admin, u.id, { pieza: a.pieza, tipo: a.tipo, cantidad: a.cantidad, nota: a.nota ?? null, deAyer: a.ayer })
    : await borrarRegistro(u.admin, u, a.id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, ...(res.aviso ? { aviso: res.aviso } : {}) })
}
