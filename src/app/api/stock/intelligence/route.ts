import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStockSemaphore } from '@/lib/contracts/stock'
import { isManagerOrAbove } from '@/lib/roles'
import {
  deriveSector,
  getOverstockThreshold,
  getPromoTitle,
  guessCategoryForFinishedGood,
  guessShelfLifeDays,
  isFinishedGood,
  isPerishableCandidate,
  STOCK_SECTOR_META,
  type StockConfidence,
  type StockIntelligenceResponse,
  type StockPriority,
  type StockSector,
  type StockSectorAction,
  type StockSetupIssue,
} from '@/lib/stock/intelligence'
import type { StockCategoryValue } from '@/types/database'

type StockRow = {
  id: string
  name: string
  category: StockCategoryValue
  unit: string
  current_qty: number
  min_qty: number
  shelf_life_days: number | null
  notes: string | null
  updated_at: string
  fudo_product_id: string | null
  fudo_ingredient_id: string | null
}

type MenuRow = {
  id: string
  name: string
  category: string | null
  menu_category_id: number | null
  recipe_id: string | null
  fudo_product_id: string | null
  is_active: boolean
}

type MenuCategoryRow = {
  id: number
  name: string
}

function priorityWeight(priority: StockPriority) {
  if (priority === 'high') return 0
  if (priority === 'medium') return 1
  return 2
}

function createAction(input: Omit<StockSectorAction, 'id'>): StockSectorAction {
  return {
    id: `${input.kind}:${input.stock_item_id}:${input.sector}`,
    ...input,
  }
}

function createSetupIssue(input: Omit<StockSetupIssue, 'id'>): StockSetupIssue {
  return {
    id: `${input.type}:${input.stock_item_id}`,
    ...input,
  }
}

export const dynamic = 'force-dynamic'

export async function GET() {
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

    const admin = createAdminClient()

    const [stockRes, menuRes, menuCategoriesRes] = await Promise.all([
      admin
        .from('stock_items')
        .select('id, name, category, unit, current_qty, min_qty, shelf_life_days, notes, updated_at, fudo_product_id, fudo_ingredient_id')
        .eq('is_active', true)
        .order('name'),
      admin
        .from('menu_items')
        .select('id, name, category, menu_category_id, recipe_id, fudo_product_id, is_active')
        .eq('is_active', true)
        .not('fudo_product_id', 'is', null),
      admin
        .from('menu_categories')
        .select('id, name'),
    ])

    if (stockRes.error) throw stockRes.error
    if (menuRes.error) throw menuRes.error
    if (menuCategoriesRes.error) throw menuCategoriesRes.error

    const stockItems = (stockRes.data ?? []) as unknown as StockRow[]
    const menuItems = (menuRes.data ?? []) as unknown as MenuRow[]
    const menuCategories = (menuCategoriesRes.data ?? []) as MenuCategoryRow[]

    const menuCategoryById = new Map(menuCategories.map((item) => [item.id, item.name]))
    const activeMenuByFudoId = new Map(
      menuItems
        .filter((item) => item.fudo_product_id)
        .map((item) => [item.fudo_product_id!, item]),
    )

    const sectorActions: Record<StockSector, StockSectorAction[]> = {
      salon: [],
      bar: [],
      cocina: [],
      compras: [],
    }
    const setupIssues: StockSetupIssue[] = []

    let finishedGoods = 0
    let finishedGoodsWithShelfLife = 0
    let perishableMissingShelfLife = 0
    let lowStockItems = 0
    let overstockFinishedGoods = 0

    for (const item of stockItems) {
      const menuMatch = item.fudo_product_id
        ? activeMenuByFudoId.get(item.fudo_product_id) ?? null
        : null
      const menuCategoryName = menuMatch?.menu_category_id
        ? menuCategoryById.get(menuMatch.menu_category_id) ?? null
        : null

      const primarySector = deriveSector({
        category: item.category,
        unit: item.unit,
        fudo_product_id: item.fudo_product_id,
        menuCategoryName,
      })

      const finishedGood = isFinishedGood(item)
      const perishableCandidate = isPerishableCandidate(item)
      const overstockThreshold = getOverstockThreshold(item)
      const isOverstock = item.current_qty >= overstockThreshold && item.current_qty > 0
      const semaphore = getStockSemaphore(item.current_qty ?? 0, item.min_qty ?? 0)
      const suggestedShelfLife = guessShelfLifeDays(item.category, menuCategoryName)
      const suggestedCategory = finishedGood ? guessCategoryForFinishedGood(menuCategoryName) : null

      if (finishedGood) {
        finishedGoods++
        if (item.shelf_life_days != null) finishedGoodsWithShelfLife++
        if (isOverstock) overstockFinishedGoods++
      }

      if (perishableCandidate && item.current_qty > 0 && item.shelf_life_days == null) {
        perishableMissingShelfLife++
        setupIssues.push(createSetupIssue({
          stock_item_id: item.id,
          stock_item_name: item.name,
          severity: finishedGood && isOverstock ? 'high' : 'medium',
          type: 'missing_shelf_life',
          title: finishedGood && isOverstock
            ? `No puedo sugerir promo de ${item.name}`
            : `Definir vida útil de ${item.name}`,
          detail: finishedGood && isOverstock
            ? `Hay ${item.current_qty} ${item.unit} en stock. Sin vida útil cargada no puedo disparar una promo automática con criterio.`
            : `Tiene ${item.current_qty} ${item.unit}. Cargá vida útil para que el radar sepa cuándo empujarlo, frenarlo o priorizarlo.`,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (finishedGood && !menuMatch) {
        setupIssues.push(createSetupIssue({
          stock_item_id: item.id,
          stock_item_name: item.name,
          severity: 'medium',
          type: 'missing_menu_mapping',
          title: `Falta vínculo comercial para ${item.name}`,
          detail: 'El stock terminado existe, pero no encuentro un item activo de carta para convertirlo en acción de salón o bar.',
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (
        finishedGood
        && suggestedCategory
        && item.category !== suggestedCategory
      ) {
        setupIssues.push(createSetupIssue({
          stock_item_id: item.id,
          stock_item_name: item.name,
          severity: 'medium',
          type: 'category_review',
          title: `Revisar categoría de ${item.name}`,
          detail: `Está categorizado como ${item.category}, pero para operar por sector conviene llevarlo a ${suggestedCategory}.`,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (semaphore === 'red') {
        lowStockItems++
        sectorActions.compras.push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: 'compras',
          priority: item.current_qty <= 0 ? 'high' : 'medium',
          confidence: 'high',
          kind: 'replenish',
          title: `Reponer ${item.name}`,
          detail: `Tiene ${item.current_qty} ${item.unit} y el mínimo operativo es ${item.min_qty}.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))
      }

      if (!isOverstock) continue

      const shortShelfLife = item.shelf_life_days != null && item.shelf_life_days <= 7
      const veryHighQty = item.current_qty >= Math.max(overstockThreshold + 4, item.min_qty * 4)
      const confidence: StockConfidence = item.shelf_life_days != null ? 'high' : 'low'

      if (finishedGood && shortShelfLife) {
        sectorActions[primarySector].push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: primarySector,
          priority: veryHighQty ? 'high' : 'medium',
          confidence,
          kind: primarySector === 'bar' ? 'push' : 'promo',
          title: getPromoTitle(menuMatch?.name ?? item.name, primarySector),
          detail: `Hay ${item.current_qty} ${item.unit} en stock y la vida útil configurada es de ${item.shelf_life_days} días.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))

        sectorActions.compras.push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: 'compras',
          priority: veryHighQty ? 'high' : 'medium',
          confidence,
          kind: 'freeze_purchase',
          title: `No reponer ${item.name} por ahora`,
          detail: `Antes de comprar más, bajá las ${item.current_qty} ${item.unit} ya cargadas en stock.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))
        continue
      }

      if (!finishedGood && shortShelfLife) {
        const targetSector: StockSector = primarySector === 'compras' ? 'cocina' : primarySector
        sectorActions[targetSector].push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: targetSector,
          priority: veryHighQty ? 'high' : 'medium',
          confidence,
          kind: 'use_first',
          title: `Usar primero ${item.name}`,
          detail: `Hay ${item.current_qty} ${item.unit} y una vida útil corta de ${item.shelf_life_days} días.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))
        continue
      }

      if (finishedGood && item.shelf_life_days != null) {
        sectorActions[primarySector].push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: primarySector,
          priority: veryHighQty ? 'medium' : 'low',
          confidence,
          kind: primarySector === 'bar' ? 'push' : 'promo',
          title: `Mover ${menuMatch?.name ?? item.name}`,
          detail: `Hay ${item.current_qty} ${item.unit}. No es urgente por vida útil, pero ya está por encima del stock objetivo.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))
      }
    }

    const sectors = (Object.keys(STOCK_SECTOR_META) as StockSector[]).map((sector) => {
      const actions = sectorActions[sector]
        .sort((a, b) => {
          const priorityDiff = priorityWeight(a.priority) - priorityWeight(b.priority)
          if (priorityDiff !== 0) return priorityDiff
          return b.current_qty - a.current_qty
        })
        .slice(0, 6)

      return {
        sector,
        label: STOCK_SECTOR_META[sector].label,
        icon: STOCK_SECTOR_META[sector].icon,
        counts: {
          high: actions.filter((item) => item.priority === 'high').length,
          medium: actions.filter((item) => item.priority === 'medium').length,
          low: actions.filter((item) => item.priority === 'low').length,
        },
        actions,
      }
    })

    const response: StockIntelligenceResponse = {
      summary: {
        active_items: stockItems.length,
        finished_goods: finishedGoods,
        finished_goods_with_shelf_life: finishedGoodsWithShelfLife,
        perishable_missing_shelf_life: perishableMissingShelfLife,
        low_stock_items: lowStockItems,
        overstock_finished_goods: overstockFinishedGoods,
        setup_issues: setupIssues.length,
      },
      sectors,
      setup_issues: setupIssues
        .sort((a, b) => {
          const severityDiff = priorityWeight(a.severity) - priorityWeight(b.severity)
          if (severityDiff !== 0) return severityDiff
          return b.current_qty - a.current_qty
        })
        .slice(0, 12),
      generated_at: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[GET /api/stock/intelligence]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
