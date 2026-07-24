import { fudoFetch } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// Fudo Expenses (módulo de GASTOS) — precio de compra REAL
// ---------------------------------------------------------------------------
// El módulo de gastos de Fudo es mucho más rico que la tabla local de
// recepciones (hoy vacía). Cada Expense agrupa pagos (payments) e items de
// gasto (expenseItems), y estos últimos referencian el ingredient comprado.
//
// Estructura JSON:API real (ya investigada, NO re-explorar):
//   - GET /v1alpha1/expenses?include=payments,provider,expenseItems.ingredient
//   - El objeto Expense NO tiene attributes; sólo relationships:
//       provider {data:{id}}, payments {data:[{id}]}, expenseItems {data:[{id}]}
//   - En `included` vienen:
//       Provider    { id, attributes:{ name } }
//       Payment     { id, attributes:{ amount:number, canceled:boolean, createdAt } }
//       ExpenseItem { id, relationships:{ ingredient:{ data:{id}|null } } }
//       Ingredient  { id, attributes:{ name } }
//   - Por gasto:
//       amount = Σ payments NO cancelados
//       date   = createdAt del primer payment no cancelado (los Expense no
//                tienen fecha propia)
//       ingredientNames = nombres de los ingredient no-null de sus expenseItems
//   - Descartar gastos sin ningún payment válido.
// ---------------------------------------------------------------------------

export type FudoExpense = {
  id: string
  provider: string | null
  date: string // ISO del primer payment no cancelado
  amount: number // Σ payments no cancelados
  ingredientNames: string[]
  itemCount: number // cantidad de expenseItems con ingredient
}

type JsonApiRes = {
  type: string
  id: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, { data: { id: string; type: string } | { id: string; type: string }[] | null }>
}

type ExpensesResponse = {
  data: JsonApiRes[]
  included?: JsonApiRes[]
}

// Cache en memoria de módulo (30 min), patrón de personal/consumo.
const CACHE_TTL_MS = 30 * 60 * 1000
let cache: { at: number; sinceISO: string | undefined; expenses: FudoExpense[] } | null = null

function relArray(rel: JsonApiRes['relationships'], key: string): { id: string; type: string }[] {
  const data = rel?.[key]?.data
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

function relOne(rel: JsonApiRes['relationships'], key: string): { id: string; type: string } | null {
  const data = rel?.[key]?.data
  if (!data || Array.isArray(data)) return null
  return data
}

/**
 * Trae los gastos del módulo de gastos de Fudo, ya normalizados.
 * @param sinceISO opcional — si se pasa, se descartan gastos con date < sinceISO.
 * Cache en memoria 30 min (por sinceISO). Si Fudo falla, lanza error claro.
 */
export async function fetchFudoExpenses(sinceISO?: string): Promise<FudoExpense[]> {
  if (cache && cache.sinceISO === sinceISO && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.expenses
  }

  const pageSize = 200
  const rawExpenses: JsonApiRes[] = []
  // included se va acumulando entre páginas (Provider/Payment/ExpenseItem/Ingredient)
  const providerName = new Map<string, string>()
  const payments = new Map<string, { amount: number; canceled: boolean; createdAt: string }>()
  const ingredientName = new Map<string, string>()
  const expenseItemIngredient = new Map<string, string | null>()

  try {
    for (let page = 1; page <= 20; page++) {
      const res = await fudoFetch<ExpensesResponse>(
        `/expenses?include=payments,provider,expenseItems.ingredient&page[size]=${pageSize}&page[number]=${page}`,
      )
      const data = Array.isArray(res.data) ? res.data : []
      rawExpenses.push(...data)

      for (const inc of res.included ?? []) {
        const attrs = inc.attributes ?? {}
        switch (inc.type) {
          case 'Provider':
            if (typeof attrs.name === 'string') providerName.set(inc.id, attrs.name)
            break
          case 'Payment':
            payments.set(inc.id, {
              amount: Number(attrs.amount ?? 0) || 0,
              canceled: Boolean(attrs.canceled),
              createdAt: String(attrs.createdAt ?? ''),
            })
            break
          case 'Ingredient':
            if (typeof attrs.name === 'string') ingredientName.set(inc.id, attrs.name)
            break
          case 'ExpenseItem':
            expenseItemIngredient.set(inc.id, relOne(inc.relationships, 'ingredient')?.id ?? null)
            break
        }
      }

      if (data.length < pageSize) break
    }
  } catch (err) {
    throw new Error(
      `No se pudieron leer los gastos de Fudo: ${err instanceof Error ? err.message : 'error desconocido'}`,
    )
  }

  const expenses: FudoExpense[] = []
  for (const exp of rawExpenses) {
    // Pagos no cancelados de este gasto
    const paymentRefs = relArray(exp.relationships, 'payments')
    const validPayments = paymentRefs
      .map((p) => payments.get(p.id))
      .filter((p): p is { amount: number; canceled: boolean; createdAt: string } => !!p && !p.canceled)

    if (validPayments.length === 0) continue // sin pago válido → descartar

    const amount = validPayments.reduce((s, p) => s + p.amount, 0)
    // Fecha = createdAt del primer pago no cancelado (orden por createdAt asc)
    const sortedByDate = [...validPayments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const date = sortedByDate[0]?.createdAt || ''
    if (!date) continue

    // Ingredientes: nombres de los ingredient no-null de sus expenseItems
    const itemRefs = relArray(exp.relationships, 'expenseItems')
    const names: string[] = []
    for (const it of itemRefs) {
      const ingId = expenseItemIngredient.get(it.id)
      if (!ingId) continue
      const name = ingredientName.get(ingId)
      if (name) names.push(name)
    }

    const providerId = relOne(exp.relationships, 'provider')?.id
    expenses.push({
      id: exp.id,
      provider: providerId ? providerName.get(providerId) ?? null : null,
      date,
      amount: Math.round(amount * 100) / 100,
      ingredientNames: names,
      itemCount: names.length,
    })
  }

  const filtered = sinceISO ? expenses.filter((e) => e.date >= sinceISO) : expenses
  filtered.sort((a, b) => b.date.localeCompare(a.date))

  cache = { at: Date.now(), sinceISO, expenses: filtered }
  return filtered
}
