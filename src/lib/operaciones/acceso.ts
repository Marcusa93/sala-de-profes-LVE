import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Quién entra al control interno de operaciones
// ---------------------------------------------------------------------------
// Solo los socios y Joaquín (pedido del 23/11). Va por persona y no por rol:
// así un socio nuevo o un encargado con permisos de más no entran solos.
// Se cambia sin tocar código con app_settings 'operaciones_acceso' =
//   { "user_ids": [...], "editores": [...], "inicio": "YYYY-MM-DD" }
// user_ids: entran y ven todo (y pueden anotar pedidos).
// editores: además tildan tareas, cargan la caja y mueven los pedidos.
// ---------------------------------------------------------------------------

const MARCO = 'b8f689ca-85ae-4120-8a02-521e378e8585'
const JOAQUIN = '66c1aab8-5f89-434e-8a38-0e8abdbd4848'

const POR_DEFECTO = { ids: [MARCO, JOAQUIN], editores: [JOAQUIN], inicio: '2026-11-23' }

export type Acceso = { ids: string[]; editores: string[]; inicio: string }

const lista = (v: unknown): string[] | null => (Array.isArray(v) && v.length ? v.map(String) : null)

export async function leerAcceso(admin: SupabaseClient): Promise<Acceso> {
  const { data } = await admin.from('app_settings').select('value').eq('key', 'operaciones_acceso').maybeSingle()
  const v = ((data as { value: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>
  const editores = lista(v.editores) ?? POR_DEFECTO.editores
  // Quien carga siempre entra, aunque no esté en user_ids
  const ids = [...new Set([...(lista(v.user_ids) ?? POR_DEFECTO.ids), ...editores])]
  const inicio = typeof v.inicio === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.inicio) ? v.inicio : POR_DEFECTO.inicio
  return { ids, editores, inicio }
}

export type Sesion = {
  userId: string
  nombre: string
  puedeEditar: boolean
  inicio: string
  admin: SupabaseClient
}

/** Usuario logueado, activo y en la lista. Si no, la respuesta de error lista para devolver. */
export async function sesionOperaciones(): Promise<{ sesion: Sesion; response?: undefined } | { sesion?: undefined; response: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }

  const admin = createAdminClient() as unknown as SupabaseClient
  const [acceso, { data: perfil }] = await Promise.all([
    leerAcceso(admin),
    admin.from('profiles').select('first_name, last_name, is_active').eq('id', user.id).maybeSingle(),
  ])
  const p = perfil as { first_name: string | null; last_name: string | null; is_active: boolean } | null
  if (!p?.is_active || !acceso.ids.includes(user.id)) {
    return { response: NextResponse.json({ error: 'El control interno lo ven solo los socios y el Jefe de Operaciones' }, { status: 403 }) }
  }
  return {
    sesion: {
      userId: user.id,
      nombre: [p.first_name, p.last_name].filter(Boolean).join(' '),
      puedeEditar: acceso.editores.includes(user.id),
      inicio: acceso.inicio,
      admin,
    },
  }
}
