import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// POST /api/admin/update-roles
// ---------------------------------------------------------------------------
// Actualiza roles de usuarios en bulk a partir de su email.
// Solo accesible por encargados.
//
// Body: {
//   updates: Array<{ email: string, role: AppRole }>
// }
//
// Response: {
//   results: Array<{ email: string, success: boolean, error?: string }>
// }
// ---------------------------------------------------------------------------

const VALID_ROLES: AppRole[] = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner']

export async function POST(request: NextRequest) {
  try {
    // 1) Verificar que el caller es encargado
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!callerProfile || callerProfile.role !== 'encargado' && callerProfile.role !== 'socio') {
      return NextResponse.json(
        { error: 'Solo socios y encargados pueden actualizar roles' },
        { status: 403 },
      )
    }

    // 2) Parsear y validar body
    const body = await request.json().catch(() => null)

    if (!body || !Array.isArray(body.updates) || body.updates.length === 0) {
      return NextResponse.json(
        { error: 'Body inválido. Se espera: { updates: [{ email, role }] }' },
        { status: 400 },
      )
    }

    const updates = body.updates as Array<{ email?: string; role?: string }>

    // 3) Procesar cada actualización con admin client
    const adminClient = createAdminClient()

    // Obtener todos los usuarios de auth para buscar por email
    // Supabase listUsers pagina de a 1000 por defecto
    const { data: authList, error: listError } = await adminClient.auth.admin.listUsers({
      perPage: 1000,
    })

    if (listError) {
      console.error('[update-roles] Error listing users:', listError)
      return NextResponse.json(
        { error: 'Error al obtener lista de usuarios' },
        { status: 500 },
      )
    }

    const usersByEmail = new Map(
      authList.users.map((u) => [u.email?.toLowerCase(), u.id]),
    )

    const results: Array<{ email: string; success: boolean; error?: string }> = []

    for (const entry of updates) {
      const { email, role } = entry

      // Validar campos
      if (!email || !role) {
        results.push({ email: email || '(vacío)', success: false, error: 'Faltan email o role' })
        continue
      }

      if (!VALID_ROLES.includes(role as AppRole)) {
        results.push({
          email,
          success: false,
          error: `Rol inválido. Debe ser uno de: ${VALID_ROLES.join(', ')}`,
        })
        continue
      }

      // Buscar usuario por email
      const userId = usersByEmail.get(email.toLowerCase())

      if (!userId) {
        results.push({ email, success: false, error: 'Usuario no encontrado' })
        continue
      }

      // Actualizar rol en profiles
      const { error: updateError } = await adminClient
        .from('profiles')
        .update({ role: role as AppRole })
        .eq('id', userId)

      if (updateError) {
        console.error(`[update-roles] Error updating ${email}:`, updateError)
        results.push({ email, success: false, error: updateError.message })
        continue
      }

      results.push({ email, success: true })
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('[update-roles] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 },
    )
  }
}
