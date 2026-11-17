import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { isManagerOrAbove } from '@/lib/roles'
import { insumosEnviables } from '@/lib/envios/salientes'
import { ROLES_PARTE, cerrarParte, guardarParte, leerParte, ultimosPartes, type EntradaParte } from '@/lib/produccion/parte'

// ---------------------------------------------------------------------------
// /api/produccion/parte — parte de cierre del encargado de producción
//   GET  → mi parte de esta noche (?fecha=YYYY-MM-DD para otra), los insumos
//          para elegir crudos y productos, y (socios/encargados) los últimos
//          partes de todos
//   PUT  { fecha?, entrada?, salida?, nota?, tareas } → guarda el borrador
//   POST { accion: 'cerrar', id } → cierra: rendimientos, producciones a
//        confirmar y aviso si algo dio bajo
// Ver lib/produccion/parte y parte-calculo.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const auth = await requireRole(ROLES_PARTE)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const fecha = request.nextUrl.searchParams.get('fecha')
  const manager = isManagerOrAbove(auth.user.role)
  const [{ parte, falta_migracion }, insumos, historial] = await Promise.all([
    leerParte(admin, auth.user.id, fecha && FECHA.test(fecha) ? fecha : undefined),
    insumosEnviables(admin),
    manager ? ultimosPartes(admin).catch(() => []) : Promise.resolve(null),
  ])
  return NextResponse.json({ parte, falta_migracion, insumos, historial })
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(ROLES_PARTE)
  if (auth.response) return auth.response
  const body = (await request.json().catch(() => null)) as EntradaParte | null
  if (!body) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  const res = await guardarParte(createAdminClient(), auth.user.id, body)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json(res)
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(ROLES_PARTE)
  if (auth.response) return auth.response
  const body = (await request.json().catch(() => null)) as { accion?: string; id?: string } | null
  if (body?.accion !== 'cerrar' || !body.id) return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
  const admin = createAdminClient()
  const { data: perfil } = await admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle()
  const nombre = perfil ? [perfil.first_name, perfil.last_name].filter(Boolean).join(' ') || null : null
  const res = await cerrarParte(admin, { id: auth.user.id, nombre }, body.id)
  if (!res.ok) return NextResponse.json({ error: res.error, errores: res.errores ?? [] }, { status: res.status })
  return NextResponse.json(res)
}
