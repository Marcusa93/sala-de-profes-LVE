// Script temporal para ejecutar migrations via pg
import pg from 'pg'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const connectionString = 'postgresql://postgres.tumbcpizdqlnuevplawr:SalaDeProfe2026!@aws-0-us-west-2.pooler.supabase.com:5432/postgres'

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function run() {
  try {
    console.log('🔌 Conectando a Supabase...')
    await client.connect()
    console.log('✅ Conectado\n')

    // 1) Fudo integration schema
    const migrationFile = process.argv[2]
    if (!migrationFile) {
      console.log('Uso: node scripts/run-migration.mjs <path-to-sql-file>')
      process.exit(1)
    }

    const sql = readFileSync(resolve(migrationFile), 'utf-8')
    console.log(`📄 Ejecutando: ${migrationFile}`)
    console.log(`   (${sql.length} caracteres)\n`)

    const result = await client.query(sql)
    const rows = Array.isArray(result) ? result.flatMap(r => r.rows ?? []) : (result.rows ?? [])
    if (rows.length) console.log(JSON.stringify(rows, null, 1))
    console.log('✅ Migración ejecutada correctamente\n')

    if (process.argv[3] === "--no-tables") return
    // Verify tables
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    console.log('📋 Tablas en public:')
    rows.forEach(r => console.log(`   - ${r.table_name}`))

  } catch (err) {
    console.error('❌ Error:', err.message)
    if (err.detail) console.error('   Detail:', err.detail)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
