import { NextResponse } from 'next/server'
import { fudo } from '@/lib/fudoClient'

export async function GET() {
  try {
    // 1. Test auth
    const auth = await fudo.testConnection()
    if (!auth.ok) {
      return NextResponse.json({ step: 'auth', error: auth.error }, { status: 401 })
    }

    // 2. Try fetching categories
    let categories: unknown[] = []
    try {
      categories = await fudo.getCategories()
    } catch (err) {
      return NextResponse.json({
        step: 'categories',
        auth,
        error: err instanceof Error ? err.message : 'Unknown',
      }, { status: 500 })
    }

    // 3. Try fetching products (first page)
    let products: unknown[] = []
    try {
      products = await fudo.getProducts()
    } catch (err) {
      return NextResponse.json({
        step: 'products',
        auth,
        categories_count: categories.length,
        error: err instanceof Error ? err.message : 'Unknown',
      }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      auth,
      categories_count: categories.length,
      categories_sample: categories.slice(0, 3),
      products_count: products.length,
      products_sample: products.slice(0, 3),
    })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}
