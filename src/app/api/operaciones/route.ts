import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sesionOperaciones } from '@/lib/operaciones/acceso'
import { cambiarPedido, guardarCaja, leerDatos, marcarTarea, nuevoPedido, seguimientoPedido, type Resultado } from '@/lib/operaciones/datos'
import { CAMBIOS_PEDIDO, PRIORIDADES } from '@/lib/operaciones/tipos'

// ---------------------------------------------------------------------------
// /api/operaciones — control interno del Jefe de Operaciones (Santa Fe)
//   GET               todo lo del control (tareas tildadas, caja, pedidos)
//   GET ?solo=acceso  { acceso: boolean } para mostrar o no el botón del menú
//   POST { accion: 'marcar', periodo, tarea, hecho }
//        { accion: 'caja', fecha, diferencia, motivo }
//        { accion: 'pedido_nuevo', que, pedido_por, delegado_a, vence, compromiso, prioridad? }
//        { accion: 'pedido', id, cambio, delegado_a?, compromiso?, prioridad? }
//        { accion: 'seguimiento', id, texto }
// Entran solo los de app_settings 'operaciones_acceso' (ver lib/operaciones/acceso).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const Accion = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('marcar'), periodo: z.string().regex(/^(d:\d{4}-\d{2}-\d{2}|s:\d{4}-W\d{2}|m:\d{4}-\d{2})$/), tarea: z.string().min(1).max(10), hecho: z.boolean() }),
  z.object({ accion: z.literal('caja'), fecha: FECHA, diferencia: z.number().min(-100_000_000).max(100_000_000).nullable(), motivo: z.string().max(300).nullable() }),
  z.object({
    accion: z.literal('pedido_nuevo'),
    que: z.string().trim().min(1).max(200),
    pedido_por: z.string().min(1).max(40),
    delegado_a: z.string().max(60).nullable(),
    vence: FECHA,
    compromiso: FECHA.nullable(),
    prioridad: z.enum(PRIORIDADES).default('media'),
  }),
  z.object({
    accion: z.literal('pedido'),
    id: z.uuid(),
    cambio: z.enum(CAMBIOS_PEDIDO),
    delegado_a: z.string().max(60).nullable().optional(),
    compromiso: FECHA.nullable().optional(),
    prioridad: z.enum(PRIORIDADES).optional(),
  }),
  z.object({ accion: z.literal('seguimiento'), id: z.uuid(), texto: z.string().trim().min(1).max(200) }),
])

export async function GET(request: NextRequest) {
  const soloAcceso = request.nextUrl.searchParams.get('solo') === 'acceso'
  const { sesion, response } = await sesionOperaciones()
  if (soloAcceso) return NextResponse.json({ acceso: !!sesion })
  if (response) return response
  try {
    return NextResponse.json(await leerDatos(sesion))
  } catch (err) {
    console.error('[operaciones] GET', err)
    return NextResponse.json({ error: 'No se pudo cargar el control interno' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { sesion, response } = await sesionOperaciones()
  if (response) return response
  const r = Accion.safeParse(await request.json().catch(() => null))
  if (!r.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const a = r.data

  let res: Resultado
  switch (a.accion) {
    case 'marcar': res = await marcarTarea(sesion, a.periodo, a.tarea, a.hecho); break
    case 'caja': res = await guardarCaja(sesion, a.fecha, a.diferencia, a.motivo); break
    case 'pedido_nuevo': res = await nuevoPedido(sesion, a); break
    case 'pedido': res = await cambiarPedido(sesion, a.id, { cambio: a.cambio, delegado_a: a.delegado_a, compromiso: a.compromiso, prioridad: a.prioridad }); break
    case 'seguimiento': res = await seguimientoPedido(sesion, a.id, a.texto); break
  }
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
