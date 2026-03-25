import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import * as XLSX from 'xlsx'
import { startOfWeek, addDays, format } from 'date-fns'

// ---------------------------------------------------------------------------
// POST /api/shifts/upload — Upload Excel/CSV file with shifts
// ---------------------------------------------------------------------------
// Supports TWO formats:
//
// FORMAT A — Weekly grid (LVE style):
//   RUNNERS  | Lunes       | Martes      | ... | Domingo
//   Sebastian| 15:30 A 00  | 14:00 A 00  | ... | 15:30 A 00
//   BARISTAS
//   Patricia | 07 A 16     | 07 A 16     | ... | 16:30 A 00
//
// FORMAT B — Row per shift:
//   Nombre | Fecha | Inicio | Fin | Rol
// ---------------------------------------------------------------------------

const ROLE_MAP: Record<string, string> = {
  runners: 'runner',
  runner: 'runner',
  baristas: 'barista',
  barista: 'barista',
  cocina: 'cocina',
  cocinero: 'cocina',
  bacha: 'cocina',
  bachero: 'cocina',
  encargado: 'encargado',
  encargados: 'encargado',
  chef: 'chef',
  socio: 'socio',
  socios: 'socio',
  mozo: 'runner',
  mozos: 'runner',
}

const DAY_NAMES = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']

// Parse "07 A 16", "15:30 A 00", "08 A 14", "16:30 A 01"
function parseTimeRange(val: string): { start: string; end: string } | null {
  if (!val) return null
  const s = val.trim().toUpperCase()
  if (s === 'DESCANSO' || s === 'FRANCO' || s === 'LIBRE' || s === '-' || s === 'X') return null

  // Match: "HH:MM A HH:MM" or "HH A HH" or combinations
  const match = s.match(/^(\d{1,2}(?::\d{2})?)\s*A\s*(\d{1,2}(?::\d{2})?)$/)
  if (!match) return null

  const normalize = (t: string): string => {
    if (t.includes(':')) {
      const [h, m] = t.split(':')
      return `${h.padStart(2, '0')}:${m}`
    }
    return `${t.padStart(2, '0')}:00`
  }

  return { start: normalize(match[1]), end: normalize(match[2]) }
}

// Detect if this is a weekly grid format
function isWeeklyGrid(headers: string[]): boolean {
  const lower = headers.map(h => String(h ?? '').toLowerCase().replace(/[^a-záéíóúñ]/g, ''))
  const dayCount = DAY_NAMES.filter(d => lower.some(h => h.includes(d))).length
  return dayCount >= 5 // At least 5 day columns found
}

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const weekStartParam = formData.get('weekStart') as string | null // yyyy-MM-dd

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })

    if (rows.length < 2) {
      return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 })
    }

    // Load employees
    const { data: employees } = await admin
      .from('profiles')
      .select('id, first_name, last_name, role')
      .eq('is_active', true)

    if (!employees?.length) {
      return NextResponse.json({ error: 'No hay empleados activos' }, { status: 400 })
    }

    const headers = (rows[0] as string[]).map(h => String(h ?? '').trim())

    if (isWeeklyGrid(headers)) {
      return processWeeklyGrid(rows, headers, employees, user.id, weekStartParam, admin)
    } else {
      return processRowPerShift(rows, headers, employees, user.id, admin)
    }
  } catch (error) {
    console.error('[/api/shifts/upload] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error procesando archivo' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// FORMAT A — Weekly grid
// ---------------------------------------------------------------------------
async function processWeeklyGrid(
  rows: unknown[][],
  headers: string[],
  employees: { id: string; first_name: string; last_name: string; role: string }[],
  createdBy: string,
  weekStartParam: string | null,
  admin: ReturnType<typeof createAdminClient>,
) {
  // Determine which columns map to which days
  const dayColumns: { dayIndex: number; colIndex: number }[] = []
  const headersLower = headers.map(h => h.toLowerCase().replace(/[áà]/g, 'a').replace(/[éè]/g, 'e').replace(/[íì]/g, 'i').replace(/[óò]/g, 'o').replace(/[úù]/g, 'u'))

  for (let ci = 1; ci < headers.length; ci++) {
    const h = headersLower[ci]
    const dayIdx = DAY_NAMES.findIndex(d => h.includes(d))
    if (dayIdx >= 0) {
      dayColumns.push({ dayIndex: dayIdx, colIndex: ci })
    }
  }

  if (dayColumns.length === 0) {
    return NextResponse.json({ error: 'No se encontraron columnas de días (Lunes-Domingo)' }, { status: 400 })
  }

  // Week start: use param, or default to current week's Monday
  const weekMonday = weekStartParam
    ? new Date(weekStartParam + 'T12:00:00')
    : startOfWeek(new Date(), { weekStartsOn: 1 })

  const created: string[] = []
  const errors: string[] = []
  const skipped: string[] = []
  let currentRole = ''

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.length === 0) continue

    const firstCell = String(row[0] ?? '').trim()
    if (!firstCell) continue

    // Check if this is a section header (RUNNERS, BARISTAS, COCINA, etc.)
    const roleKey = firstCell.toLowerCase().replace(/[^a-záéíóúñ]/g, '')
    if (ROLE_MAP[roleKey] && (!row[1] || String(row[1] ?? '').trim() === '')) {
      currentRole = ROLE_MAP[roleKey]
      continue
    }

    // This is an employee row
    const nameLower = firstCell.toLowerCase()
    const match = employees.find(e => {
      const fn = (e.first_name ?? '').toLowerCase()
      const ln = (e.last_name ?? '').toLowerCase()
      if (fn === nameLower) return true
      if (nameLower.includes(fn) && fn.length > 2) return true
      if (`${fn} ${ln}`.includes(nameLower)) return true
      return false
    })

    if (!match) {
      errors.push(`Fila ${i + 1}: no se encontró empleado "${firstCell}"`)
      continue
    }

    const shiftRole = currentRole || match.role

    // Process each day column
    for (const { dayIndex, colIndex } of dayColumns) {
      const cellValue = String(row[colIndex] ?? '').trim()
      if (!cellValue) continue

      const timeRange = parseTimeRange(cellValue)
      if (!timeRange) continue // Descanso or invalid

      const date = format(addDays(weekMonday, dayIndex), 'yyyy-MM-dd')

      // Check duplicate
      const { data: existing } = await admin
        .from('shifts')
        .select('id')
        .eq('user_id', match.id)
        .eq('shift_date', date)
        .eq('start_time', timeRange.start)
        .limit(1)

      if (existing && existing.length > 0) {
        skipped.push(`${match.first_name} ${match.last_name} — ${date}`)
        continue
      }

      const { error: insertError } = await admin.from('shifts').insert({
        user_id: match.id,
        shift_date: date,
        start_time: timeRange.start,
        end_time: timeRange.end,
        shift_role: shiftRole,
        created_by: createdBy,
      })

      if (insertError) {
        errors.push(`${match.first_name} ${date}: ${insertError.message}`)
      } else {
        created.push(`${match.first_name} ${match.last_name} — ${date} ${timeRange.start}-${timeRange.end}`)
      }
    }
  }

  return NextResponse.json({
    success: true,
    format: 'weekly_grid',
    weekStart: format(weekMonday, 'yyyy-MM-dd'),
    created: created.length,
    skipped: skipped.length,
    errors: errors.length,
    details: { created, skipped, errors },
  })
}

// ---------------------------------------------------------------------------
// FORMAT B — Row per shift
// ---------------------------------------------------------------------------
async function processRowPerShift(
  rows: unknown[][],
  headers: string[],
  employees: { id: string; first_name: string; last_name: string; role: string }[],
  createdBy: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  function findCol(...candidates: string[]): number {
    for (const c of candidates) {
      const idx = headers.findIndex(h =>
        h.toLowerCase().replace(/[^a-záéíóúñ]/g, '').includes(c.toLowerCase().replace(/[^a-záéíóúñ]/g, ''))
      )
      if (idx >= 0) return idx
    }
    return -1
  }

  const nameCol = findCol('nombre', 'empleado', 'persona')
  const dateCol = findCol('fecha', 'dia', 'día')
  const startCol = findCol('inicio', 'desde', 'entrada')
  const endCol = findCol('fin', 'hasta', 'salida')
  const roleCol = findCol('rol', 'puesto', 'cargo')

  if (nameCol < 0 || dateCol < 0 || startCol < 0 || endCol < 0) {
    return NextResponse.json({
      error: `No se encontraron columnas necesarias. Se necesitan: Nombre, Fecha, Inicio, Fin. Columnas encontradas: ${headers.join(', ')}`,
    }, { status: 400 })
  }

  const created: string[] = []
  const errors: string[] = []
  const skipped: string[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.length === 0) continue

    const nameVal = String(row[nameCol] ?? '').trim()
    if (!nameVal) continue

    const dateRaw = String(row[dateCol] ?? '').trim()
    const startRaw = String(row[startCol] ?? '').trim()
    const endRaw = String(row[endCol] ?? '').trim()

    // Parse date
    let date: string | null = null
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      date = dateRaw
    } else {
      const dmy = dateRaw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
      if (dmy) date = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
    }

    if (!date) {
      errors.push(`Fila ${i + 1}: fecha inválida "${dateRaw}"`)
      continue
    }

    // Parse times
    const normalizeTime = (t: string): string | null => {
      const m = t.match(/^(\d{1,2}):(\d{2})/)
      if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
      const num = Number(t)
      if (!isNaN(num) && num >= 0 && num < 1) {
        const mins = Math.round(num * 24 * 60)
        return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
      }
      return null
    }

    const start = normalizeTime(startRaw)
    const end = normalizeTime(endRaw)
    if (!start || !end) {
      errors.push(`Fila ${i + 1}: horario inválido`)
      continue
    }

    const nameLower = nameVal.toLowerCase()
    const match = employees.find(e => {
      const fn = (e.first_name ?? '').toLowerCase()
      const ln = (e.last_name ?? '').toLowerCase()
      if (fn === nameLower) return true
      if (`${fn} ${ln}`.includes(nameLower)) return true
      if (nameLower.includes(fn) && fn.length > 2) return true
      return false
    })

    if (!match) {
      errors.push(`Fila ${i + 1}: no se encontró "${nameVal}"`)
      continue
    }

    const roleRaw = roleCol >= 0 ? String(row[roleCol] ?? '').trim().toLowerCase() : ''
    const role = ROLE_MAP[roleRaw] || match.role

    const { data: existing } = await admin
      .from('shifts')
      .select('id')
      .eq('user_id', match.id)
      .eq('shift_date', date)
      .eq('start_time', start)
      .limit(1)

    if (existing && existing.length > 0) {
      skipped.push(`${match.first_name} — ${date} ${start}`)
      continue
    }

    const { error: insertError } = await admin.from('shifts').insert({
      user_id: match.id,
      shift_date: date,
      start_time: start,
      end_time: end,
      shift_role: role,
      created_by: createdBy,
    })

    if (insertError) {
      errors.push(`Fila ${i + 1}: ${insertError.message}`)
    } else {
      created.push(`${match.first_name} ${match.last_name} — ${date} ${start}-${end}`)
    }
  }

  return NextResponse.json({
    success: true,
    format: 'row_per_shift',
    created: created.length,
    skipped: skipped.length,
    errors: errors.length,
    details: { created, skipped, errors },
  })
}
