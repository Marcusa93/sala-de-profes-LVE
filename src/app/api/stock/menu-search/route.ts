import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

type MenuRow = {
  id: string
  name: string
  fudo_product_id: string | null
  is_active: boolean
}

type StockRow = {
  id: string
  name: string
  fudo_product_id: string | null
}

function normalize(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(value: string) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 1)
}

function tokenMatches(text: string, token: string) {
  if (text.includes(token)) return true
  if (token.endsWith('es') && text.includes(token.slice(0, -2))) return true
  if (token.endsWith('s') && text.includes(token.slice(0, -1))) return true
  return false
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const query = request.nextUrl.searchParams.get('q') ?? ''
    const queryTokens = tokens(query)
    if (queryTokens.length === 0) return NextResponse.json({ matches: [] })

    const admin = createAdminClient()
    const [menuRes, stockRes] = await Promise.all([
      admin
        .from('menu_items')
        .select('id, name, fudo_product_id, is_active')
        .eq('is_active', true)
        .order('name'),
      admin
        .from('stock_items')
        .select('id, name, fudo_product_id')
        .not('fudo_product_id', 'is', null),
    ])

    if (menuRes.error) throw menuRes.error
    if (stockRes.error) throw stockRes.error

    const stockByFudoId = new Map(
      ((stockRes.data ?? []) as StockRow[])
        .filter((item) => item.fudo_product_id)
        .map((item) => [item.fudo_product_id!, item]),
    )

    const matches = ((menuRes.data ?? []) as MenuRow[])
      .filter((item) => {
        const text = normalize(item.name)
        return queryTokens.every((token) => tokenMatches(text, token))
      })
      .slice(0, 8)
      .map((item) => {
        const linkedStock = item.fudo_product_id ? stockByFudoId.get(item.fudo_product_id) ?? null : null
        return {
          id: item.id,
          name: item.name,
          fudo_product_id: item.fudo_product_id,
          stock_item_id: linkedStock?.id ?? null,
          stock_item_name: linkedStock?.name ?? null,
          status: linkedStock ? 'linked_stock' : 'missing_stock',
        }
      })

    return NextResponse.json({ matches })
  } catch (error) {
    console.error('[GET /api/stock/menu-search]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
