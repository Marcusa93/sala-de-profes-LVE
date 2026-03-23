/**
 * Actualiza los profiles de los usuarios ya creados con nombres y roles correctos
 * Ejecutar: node scripts/update-profiles.mjs
 */

const SUPABASE_URL = 'https://tumbcpizdqlnuevplawr.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bWJjcGl6ZHFsbnVldnBsYXdyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjkxNjM3NCwiZXhwIjoyMDg4NDkyMzc0fQ.PHCuIljdGNWpfAmov5vccRcBDWy8W2W-tdkRlEwER6s'

const headers = {
  'Content-Type': 'application/json',
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
}

const USERS = [
  { first_name: 'Ignacio',     last_name: 'Rodriguez', role: 'encargado', email: 'ignacio@laviejaescuela.com' },
  { first_name: 'Noelia',      last_name: 'Andrada',   role: 'encargado', email: 'noelia@laviejaescuela.com' },
  { first_name: 'Ricardo',     last_name: 'Marquez',   role: 'encargado', email: 'ricardo@laviejaescuela.com' },
  { first_name: 'Ivoti',       last_name: 'Gonzalez',  role: 'barista', email: 'ivoti@laviejaescuela.com' },
  { first_name: 'Patricia',    last_name: 'Petriel',   role: 'barista', email: 'patricia@laviejaescuela.com' },
  { first_name: 'Juan Pablo',  last_name: 'Ledesma',   role: 'runner', email: 'juanpablo@laviejaescuela.com' },
  { first_name: 'Melina',      last_name: 'Coronel',   role: 'runner', email: 'melina@laviejaescuela.com' },
  { first_name: 'Aimé',        last_name: 'Nieto',     role: 'runner', email: 'aime@laviejaescuela.com' },
  { first_name: 'Agustin',     last_name: 'Bedran',    role: 'runner', email: 'agustin@laviejaescuela.com' },
  { first_name: 'Sebastian',   last_name: 'Ferro',     role: 'runner', email: 'sebastian@laviejaescuela.com' },
  { first_name: 'Fernanda',    last_name: 'Bonanno',   role: 'runner', email: 'fernanda@laviejaescuela.com' },
  { first_name: 'Facundo',     last_name: 'Yapura',    role: 'chef', email: 'facundo.yapura@laviejaescuela.com' },
  { first_name: 'Facundo',     last_name: 'Torres',    role: 'cocina', email: 'facundo.torres@laviejaescuela.com' },
  { first_name: 'Samuel',      last_name: 'Mendez',    role: 'cocina', email: 'samuel@laviejaescuela.com' },
  { first_name: 'Gaston',      last_name: 'Medina',    role: 'cocina', email: 'gaston@laviejaescuela.com' },
  { first_name: 'Marisol',     last_name: 'Soraire',   role: 'cocina', email: 'marisol@laviejaescuela.com' },
]

async function getAuthUserId(email) {
  // List users and find by email
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=50`, {
    headers,
  })
  if (!res.ok) return null
  const data = await res.json()
  const user = data.users?.find(u => u.email === email)
  return user?.id ?? null
}

async function main() {
  console.log('🔄 Obteniendo lista de usuarios auth...\n')

  // Get all auth users at once
  let allAuthUsers = []
  let page = 1
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=50`, { headers })
    if (!res.ok) { console.error('Error fetching users'); break }
    const data = await res.json()
    if (!data.users || data.users.length === 0) break
    allAuthUsers.push(...data.users)
    if (data.users.length < 50) break
    page++
  }

  console.log(`📋 ${allAuthUsers.length} usuarios auth encontrados\n`)

  let updated = 0, notFound = 0, errors = 0

  for (const user of USERS) {
    const tag = `${user.first_name} ${user.last_name} (${user.role})`
    const authUser = allAuthUsers.find(u => u.email === user.email)

    if (!authUser) {
      console.log(`⚠️  ${tag} — no encontrado con email ${user.email}`)
      notFound++
      continue
    }

    // Update profile via REST API (PATCH with service role bypasses RLS)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${authUser.id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        is_active: true,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`❌ ${tag} — error:`, err)
      errors++
    } else {
      console.log(`✅ ${tag} — ${user.email} (id: ${authUser.id.slice(0,8)}...)`)
      updated++
    }

    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n📊 Resultado: ${updated} actualizados, ${notFound} no encontrados, ${errors} errores`)
}

main()
