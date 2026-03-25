import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import * as XLSX from 'xlsx'

// ---------------------------------------------------------------------------
// POST /api/shifts/upload — Upload Excel/CSV file with shifts
// ---------------------------------------------------------------------------
// Expected columns (flexible naming):
//   Nombre | Apellido | Fecha | Inicio | Fin | Rol
// Or:
//   Empleado | Fecha | Desde | Hasta | Puesto
// ---------------------------------------------------------------------------

const ROLE_MAP: Record<string, string> = {
  encargado: 'encargado',
  socio: 'socio',
  chef: 'chef',
  barista: 'barista',
  runner: 'runner',
  cocina: 'cocina',
  mozo: 'runner',
  camarero: 'runner',
  cocinero: 'cocina',
}

function normalizeTime(val: unknown): string | null {
  if (!val) return null
  const s = String(val).trim()

  // HH:MM format
  const timeMatch = s.match(/^(\d{1,2}):(\d{2})/)
  if (timeMatch) {
    return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
  }

  // Excel serial time (0.375 = 9:00)
  const num = Number(s)
  if (!isNaN(num) && num >= 0 && num < 1) {
    const totalMinutes = Math.round(num * 24 * 60)
    const hours = Math.floor(totalMinutes / 60)
    const mins = totalMinutes % 60
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
  }

  return null
}

function normalizeDate(val: unknown): string | null {
  if (!val) return null
  const s = String(val).trim()

  // yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // dd/MM/yyyy or dd-MM-yyyy
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }

  // Excel serial date
  const num = Number(s)
  if (!isNaN(num) && num > 40000 && num < 50000) {
    const date = new Date((num - 25569) * 86400 * 1000)
    return date.toISOString().slice(0, 10)
  }

  return null
}

function findColumn(headers: string[], ...candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex(h =>
      h.toLowerCase().replace(/[^a-záéíóúñ]/g, '').includes(candidate.toLowerCase().replace(/[^a-záéíóúñ]/g, ''))
    )
    if (idx >= 0) return idx
  }
  return -1
}

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Check role
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })

    if (rows.length < 2) {
      return NextResponse.json({ error: 'El archivo está vacío o no tiene datos' }, { status: 400 })
    }

    // Find headers
    const headers = (rows[0] as string[]).map(h => String(h ?? '').trim())
    const nameCol = findColumn(headers, 'nombre', 'empleado', 'persona')
    const lastNameCol = findColumn(headers, 'apellido')
    const dateCol = findColumn(headers, 'fecha', 'dia', 'día')
    const startCol = findColumn(headers, 'inicio', 'desde', 'entrada', 'hora inicio')
    const endCol = findColumn(headers, 'fin', 'hasta', 'salida', 'hora fin')
    const roleCol = findColumn(headers, 'rol', 'puesto', 'cargo', 'función')

    if (nameCol < 0 || dateCol < 0 || startCol < 0 || endCol < 0) {
      return NextResponse.json({
        error: `No se encontraron columnas necesarias. Se necesitan: Nombre, Fecha, Inicio, Fin. Columnas encontradas: ${headers.join(', ')}`,
      }, { status: 400 })
    }

    // Load all active employees for matching
    const { data: employees } = await admin
      .from('profiles')
      .select('id, first_name, last_name, role')
      .eq('is_active', true)

    if (!employees?.length) {
      return NextResponse.json({ error: 'No hay empleados activos' }, { status: 400 })
    }

    // Process rows
    const created: string[] = []
    const errors: string[] = []
    const skipped: string[] = []

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[]
      if (!row || row.length === 0) continue

      const nameVal = String(row[nameCol] ?? '').trim()
      if (!nameVal) continue

      const lastName = lastNameCol >= 0 ? String(row[lastNameCol] ?? '').trim() : ''
      const fullName = lastName ? `${nameVal} ${lastName}` : nameVal

      const date = normalizeDate(row[dateCol])
      const start = normalizeTime(row[startCol])
      const end = normalizeTime(row[endCol])
      const roleRaw = roleCol >= 0 ? String(row[roleCol] ?? '').trim().toLowerCase() : ''
      const role = ROLE_MAP[roleRaw] || ''

      if (!date) {
        errors.push(`Fila ${i + 1}: fecha inválida "${row[dateCol]}"`)
        continue
      }
      if (!start || !end) {
        errors.push(`Fila ${i + 1}: horario inválido "${row[startCol]}" - "${row[endCol]}"`)
        continue
      }

      // Match employee by name
      const nameLower = nameVal.toLowerCase()
      const lastLower = lastName.toLowerCase()
      const match = employees.find(e => {
        const fn = (e.first_name ?? '').toLowerCase()
        const ln = (e.last_name ?? '').toLowerCase()
        // Exact match
        if (fn === nameLower && (!lastLower || ln === lastLower)) return true
        // Full name contains
        if (`${fn} ${ln}`.includes(nameLower)) return true
        if (nameLower.includes(fn) && fn.length > 2) return true
        return false
      })

      if (!match) {
        errors.push(`Fila ${i + 1}: no se encontró empleado "${fullName}"`)
        continue
      }

      // Check for duplicate
      const { data: existing } = await admin
        .from('shifts')
        .select('id')
        .eq('user_id', match.id)
        .eq('shift_date', date)
        .eq('start_time', start)
        .limit(1)

      if (existing && existing.length > 0) {
        skipped.push(`${match.first_name} ${match.last_name} — ${date} ${start}`)
        continue
      }

      const { error: insertError } = await admin.from('shifts').insert({
        user_id: match.id,
        shift_date: date,
        start_time: start,
        end_time: end,
        shift_role: (role || match.role) as string,
        created_by: user.id,
      })

      if (insertError) {
        errors.push(`Fila ${i + 1}: ${insertError.message}`)
      } else {
        created.push(`${match.first_name} ${match.last_name} — ${date} ${start}-${end}`)
      }
    }

    return NextResponse.json({
      success: true,
      created: created.length,
      skipped: skipped.length,
      errors: errors.length,
      details: { created, skipped, errors },
    })
  } catch (error) {
    console.error('[/api/shifts/upload] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error procesando archivo' },
      { status: 500 },
    )
  }
}
