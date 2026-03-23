/**
 * Script para crear usuarios de La Vieja Escuela en Supabase
 * Usa la Auth Admin API (REST, no necesita conexión directa a DB)
 *
 * Ejecutar: node scripts/create-users.mjs
 */

const SUPABASE_URL = 'https://tumbcpizdqlnuevplawr.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bWJjcGl6ZHFsbnVldnBsYXdyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjkxNjM3NCwiZXhwIjoyMDg4NDkyMzc0fQ.PHCuIljdGNWpfAmov5vccRcBDWy8W2W-tdkRlEwER6s'
const DEFAULT_PASSWORD = 'LVE2026test'

const USERS = [
  // Encargados
  { first_name: 'Ignacio',     last_name: 'Rodriguez', role: 'encargado', email: 'ignacio@laviejaescuela.com' },
  { first_name: 'Noelia',      last_name: 'Andrada',   role: 'encargado', email: 'noelia@laviejaescuela.com' },
  { first_name: 'Ricardo',     last_name: 'Marquez',   role: 'encargado', email: 'ricardo@laviejaescuela.com' },

  // Baristas
  { first_name: 'Ivoti',       last_name: 'Gonzalez',  role: 'barista', email: 'ivoti@laviejaescuela.com' },
  { first_name: 'Patricia',    last_name: 'Petriel',   role: 'barista', email: 'patricia@laviejaescuela.com' },

  // Runners
  { first_name: 'Juan Pablo',  last_name: 'Ledesma',   role: 'runner', email: 'juanpablo@laviejaescuela.com' },
  { first_name: 'Melina',      last_name: 'Coronel',   role: 'runner', email: 'melina@laviejaescuela.com' },
  { first_name: 'Aimé',        last_name: 'Nieto',     role: 'runner', email: 'aime@laviejaescuela.com' },
  { first_name: 'Agustin',     last_name: 'Bedran',    role: 'runner', email: 'agustin@laviejaescuela.com' },
  { first_name: 'Sebastian',   last_name: 'Ferro',     role: 'runner', email: 'sebastian@laviejaescuela.com' },
  { first_name: 'Fernanda',    last_name: 'Bonanno',   role: 'runner', email: 'fernanda@laviejaescuela.com' },

  // Chef
  { first_name: 'Facundo',     last_name: 'Yapura',    role: 'chef', email: 'facundo.yapura@laviejaescuela.com' },

  // Cocina (ayudantes)
  { first_name: 'Facundo',     last_name: 'Torres',    role: 'cocina', email: 'facundo.torres@laviejaescuela.com' },
  { first_name: 'Samuel',      last_name: 'Mendez',    role: 'cocina', email: 'samuel@laviejaescuela.com' },
  { first_name: 'Gaston',      last_name: 'Medina',    role: 'cocina', email: 'gaston@laviejaescuela.com' },

  // Bacha (asignada a cocina)
  { first_name: 'Marisol',     last_name: 'Soraire',   role: 'cocina', email: 'marisol@laviejaescuela.com' },
]

const headers = {
  'Content-Type': 'application/json',
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
}

async function createUser(user) {
  const tag = `${user.first_name} ${user.last_name} (${user.role})`

  try {
    // 1. Create auth user
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: user.email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
      }),
    })

    if (!authRes.ok) {
      const err = await authRes.json()
      if (err.msg?.includes('already been registered') || err.message?.includes('already been registered')) {
        console.log(`⏭️  ${tag} — ya existe (${user.email})`)
        return 'skipped'
      }
      console.error(`❌ ${tag} — Auth error:`, err.msg || err.message)
      return 'error'
    }

    const authData = await authRes.json()
    const userId = authData.id

    // 2. Create profile
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        ...headers,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        id: userId,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        is_active: true,
      }),
    })

    if (!profileRes.ok) {
      const err = await profileRes.text()
      console.error(`❌ ${tag} — Profile error:`, err)
      return 'error'
    }

    console.log(`✅ ${tag} — ${user.email}`)
    return 'created'

  } catch (err) {
    console.error(`❌ ${tag} — Network error:`, err.message)
    return 'error'
  }
}

async function main() {
  console.log('🏪 Creando usuarios de La Vieja Escuela...\n')

  let created = 0, skipped = 0, errors = 0

  for (const user of USERS) {
    const result = await createUser(user)
    if (result === 'created') created++
    else if (result === 'skipped') skipped++
    else errors++

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\n📊 Resultado: ${created} creados, ${skipped} ya existían, ${errors} errores`)
  console.log(`🔑 Password para todos: ${DEFAULT_PASSWORD}`)
}

main()
