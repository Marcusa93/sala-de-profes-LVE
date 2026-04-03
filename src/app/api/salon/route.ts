import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// GET /api/salon — Open tables from Fudo with delay semaphore
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    // Auth with Fudo
    const authRes = await fetch('https://auth.fu.do/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: process.env.FUDO_LOGIN,
        password: process.env.FUDO_PASSWORD,
      }),
    })
    if (!authRes.ok) throw new Error('Fudo auth failed')
    const { token } = await authRes.json()

    // Get open sales with table
    const res = await fetch(
      'https://api.fu.do/v1alpha1/sales?include=table&sort=-createdAt&page[size]=50',
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    )
    if (!res.ok) throw new Error(`Fudo API: ${res.status}`)
    const data = await res.json()

    // Build table map
    const tableMap = new Map<string, { number: number; name?: string }>()
    for (const inc of (data.included ?? [])) {
      if (inc.type === 'Table') {
        tableMap.set(inc.id, { number: inc.attributes.number, name: inc.attributes.name })
      }
    }

    const now = new Date()

    // Filter to open sales only (today, Argentina time)
    const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

    const tables = ((data.data ?? []) as Array<{
      id: string
      attributes: { saleState: string; saleType: string; total: number; createdAt: string; people: number | null }
      relationships: { table?: { data?: { id: string } } }
    }>)
      .filter(sale => {
        if (sale.attributes.saleState === 'CLOSED') return false
        const argDate = new Date(sale.attributes.createdAt).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
        return argDate === today
      })
      .map(sale => {
        const tableRef = sale.relationships?.table?.data
        const table = tableRef ? tableMap.get(tableRef.id) : null
        const created = new Date(sale.attributes.createdAt)
        const minutes = Math.round((now.getTime() - created.getTime()) / 60000)

        let semaphore: 'green' | 'yellow' | 'red' | 'critical'
        if (minutes > 35) semaphore = 'critical'
        else if (minutes > 25) semaphore = 'red'
        else if (minutes > 15) semaphore = 'yellow'
        else semaphore = 'green'

        return {
          saleId: sale.id,
          tableNumber: table?.number ?? null,
          tableName: table?.name ?? null,
          saleType: sale.attributes.saleType,
          state: sale.attributes.saleState,
          total: sale.attributes.total,
          people: sale.attributes.people,
          createdAt: sale.attributes.createdAt,
          minutes,
          semaphore,
        }
      })
      .sort((a, b) => b.minutes - a.minutes) // Most delayed first

    const counts = {
      total: tables.length,
      green: tables.filter(t => t.semaphore === 'green').length,
      yellow: tables.filter(t => t.semaphore === 'yellow').length,
      red: tables.filter(t => t.semaphore === 'red').length,
      critical: tables.filter(t => t.semaphore === 'critical').length,
    }

    return NextResponse.json({
      tables,
      counts,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('[/api/salon]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
