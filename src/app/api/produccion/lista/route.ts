import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { faltaConfigurar } from '@/lib/envios/conexion-24'
import { insumosEnviables } from '@/lib/envios/salientes'
import {
  ROLES_EDITAN_LISTA,
  ROLES_VEN_LISTA,
  editoresLista,
  guardarLista,
  leerEstado24,
  leerLista,
  mandarCatalogo24,
  stockDeLa24,
  type EntradaLista,
} from '@/lib/produccion/lista'

const NO_EDITA = (nombres: string[]) => NextResponse.json({ error: `La lista y los mínimos los cambian ${nombres.length ? nombres.join(' y ') : 'los socios designados'}` }, { status: 403 })

// ---------------------------------------------------------------------------
// /api/produccion/lista — lista de producción con mínimos (Santa Fe y la 24)
//   GET  (socio, encargado, chef, cocina)
//        ?insumos=1 también los insumos para agregar
//        ?con24=1   también el stock de la 24 de cada producto (GET a la 24)
//   PUT  (Marco y Joaquín) { productos: [{ stock_item_id, minimo_sf, va_a_la_24, minimo_24 }] }
//        guarda la lista entera y, si cambió la parte de la 24, se la manda
//   POST (Marco y Joaquín) { accion: 'mandar_24' } → vuelve a mandarle la lista a la 24
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = await requireRole(ROLES_VEN_LISTA)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const q = request.nextUrl.searchParams
  const con24 = q.get('con24') === '1' && !faltaConfigurar()

  const [lista, estado, candidatos, la24, editores] = await Promise.all([
    leerLista(admin),
    leerEstado24(admin),
    q.get('insumos') === '1' ? insumosEnviables(admin) : Promise.resolve(null),
    con24 ? stockDeLa24() : Promise.resolve(null),
    editoresLista(admin),
  ])
  return NextResponse.json({
    productos: lista.productos,
    falta_migracion: lista.falta_migracion,
    puede_editar: (ROLES_EDITAN_LISTA as readonly string[]).includes(auth.user.role) && editores.ids.includes(auth.user.id),
    editan: editores.nombres,
    estado_24: estado,
    la_24: la24,
    falta_configurar: faltaConfigurar(),
    ...(candidatos ? { candidatos } : {}),
  })
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(ROLES_EDITAN_LISTA)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const editores = await editoresLista(admin)
  if (!editores.ids.includes(auth.user.id)) return NO_EDITA(editores.nombres)
  const body = (await request.json().catch(() => null)) as { productos?: EntradaLista[] } | null
  if (!body || !Array.isArray(body.productos)) return NextResponse.json({ error: 'Falta la lista de productos' }, { status: 400 })
  const res = await guardarLista(admin, auth.user.id, body.productos.map((p) => ({
    stock_item_id: String(p?.stock_item_id ?? ''),
    minimo_sf: p?.minimo_sf == null ? null : Number(p.minimo_sf),
    va_a_la_24: Boolean(p?.va_a_la_24),
    minimo_24: p?.minimo_24 == null ? null : Number(p.minimo_24),
  })))
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json(res)
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(ROLES_EDITAN_LISTA)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const editores = await editoresLista(admin)
  if (!editores.ids.includes(auth.user.id)) return NO_EDITA(editores.nombres)
  const body = (await request.json().catch(() => null)) as { accion?: string } | null
  if (body?.accion !== 'mandar_24') return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
  const res = await mandarCatalogo24(admin, auth.user.id)
  if (!res.ok) return NextResponse.json({ error: res.error, reintenta: res.reintenta }, { status: res.reintenta ? 502 : 400 })
  return NextResponse.json(res)
}
