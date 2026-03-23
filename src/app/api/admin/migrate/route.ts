import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Temporary endpoint to run DDL migrations via the Management API
// Uses Supabase service role to execute SQL directly
// DELETE THIS FILE after migrations are done

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(request: NextRequest) {
  try {
    const { sql, description } = await request.json()

    if (!sql) {
      return NextResponse.json({ error: 'SQL required' }, { status: 400 })
    }

    // Execute SQL via the Supabase Management API (pg-meta)
    // This endpoint allows raw SQL execution with the service role key
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({}),
    })

    // Alternative approach: Use pg-meta endpoint for raw SQL
    // Supabase exposes pg-meta at /pg/query
    const pgResponse = await fetch(`${SUPABASE_URL}/pg/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    })

    if (!pgResponse.ok) {
      const body = await pgResponse.text()
      return NextResponse.json({
        error: `pg-meta failed (${pgResponse.status})`,
        body,
        description,
      }, { status: 500 })
    }

    const result = await pgResponse.json()
    return NextResponse.json({ success: true, description, result })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown',
    }, { status: 500 })
  }
}
