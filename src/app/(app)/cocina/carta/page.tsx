'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { Plus, ChefHat, Package, Send, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { LoadingState } from '@/components/ui/LoadingState'
import { DateNavigator } from '@/components/kitchen/DateNavigator'
import { KitchenItemRow } from '@/components/kitchen/KitchenItemRow'
import { MenuChecklistSection } from '@/components/kitchen/MenuChecklistSection'
import { AddFromRecipeDialog } from '@/components/kitchen/AddFromRecipeDialog'
import { AddFromStockDialog } from '@/components/kitchen/AddFromStockDialog'
import {
  KITCHEN_SERVICES,
  KITCHEN_LOG_STATUSES,
  SERVICE_MENU_CATEGORIES,
} from '@/lib/constants'
import type {
  KitchenServiceValue,
  KitchenDailyItem,
  KitchenDailyLog,
  Recipe,
  StockItem,
  MenuItem,
  AnnouncementInsert,
} from '@/types/database'
import { logAuditClient } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOW_STOCK_THRESHOLD = 0.3 // 30% — items below this % of qty_needed trigger alert

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(): string {
  return crypto.randomUUID()
}

function emptyItem(): KitchenDailyItem {
  return {
    _id: uid(),
    name: '',
    qty_needed: 0,
    qty_current: 0,
    qty_sold: 0,
    qty_remaining: 0,
    unit: 'kg',
    recipe_id: null,
    stock_item_id: null,
    is_from_recipe: false,
    menu_item_id: null,
    is_from_menu: false,
  }
}

/** Ensure items loaded from DB have a _id (backward compat with old records) */
function hydrateItems(raw: unknown): KitchenDailyItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => ({
    ...item,
    _id: item._id ?? uid(),
  }))
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CocinaPage() {
  const supabase = createClient()
  const { profile, loading: profileLoading } = useProfileContext()

  // Date & service
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [activeService, setActiveService] = useState<KitchenServiceValue>('desayuno_merienda')
  const dateStr = format(selectedDate, 'yyyy-MM-dd')

  // Data
  const [log, setLog] = useState<KitchenDailyLog | null>(null)
  const [items, setItems] = useState<KitchenDailyItem[]>([])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Aux data
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false)
  const [stockDialogOpen, setStockDialogOpen] = useState(false)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])

  // Race condition guard — increment on every fetch to ignore stale responses
  const fetchVersion = useRef(0)

  const canEdit = profile?.role === 'cocina' || profile?.role === 'chef'
  const isEditable = canEdit && log?.status !== 'enviado'
  const isAlmuerzoCena = activeService === 'almuerzo_cena'

  // ---------------------------------------------------------------------------
  // Derived: service menu items + stock map
  // ---------------------------------------------------------------------------

  /** Menu items filtered by the active service's categories */
  const serviceMenuItems = useMemo(() => {
    const cats = SERVICE_MENU_CATEGORIES[activeService]
    if (!cats) return []
    return menuItems.filter((m) => m.category && cats.includes(m.category))
  }, [menuItems, activeService])

  /** Stock lookup by normalized name for semaphore indicators */
  const stockMap = useMemo(() => {
    const map = new Map<string, StockItem>()
    for (const s of stockItems) {
      map.set(s.name.toLowerCase().trim(), s)
    }
    return map
  }, [stockItems])

  /** Items NOT from menu (custom, recipe, stock) */
  const customItems = useMemo(
    () => items.filter((i) => !i.is_from_menu),
    [items],
  )

  // ---------------------------------------------------------------------------
  // Fetch log for selected date + service (with stale-response guard)
  // ---------------------------------------------------------------------------

  const fetchLog = useCallback(async () => {
    if (!profile) return
    const version = ++fetchVersion.current
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('kitchen_daily_logs')
        .select('*')
        .eq('operative_date', dateStr)
        .eq('service', activeService)
        .maybeSingle()

      if (error) throw error

      // Ignore stale response if user already navigated away
      if (version !== fetchVersion.current) return

      setLog(data)
      setItems(hydrateItems(data?.items))
      setNotes(data?.notes ?? '')
    } catch (err) {
      if (version !== fetchVersion.current) return
      console.error('Error fetching kitchen log:', err)
      toast.error('Error al cargar el registro')
    } finally {
      if (version === fetchVersion.current) setLoading(false)
    }
  }, [profile, dateStr, activeService, supabase])

  useEffect(() => {
    fetchLog()
  }, [fetchLog])

  // ---------------------------------------------------------------------------
  // Fetch recipes, stock & menu items on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!profile) return
    async function loadAux() {
      // Fetch each resource independently so one failure doesn't block the rest
      const [recipesRes, stockRes, menuRes] = await Promise.all([
        supabase.from('recipes').select('*').eq('is_active', true).order('name'),
        supabase.from('stock_items').select('*').eq('is_active', true).order('name'),
        supabase.from('menu_items').select('*').eq('is_active', true).order('sort_order'),
      ])

      if (recipesRes.error) {
        console.warn('Recipes not available:', recipesRes.error.message)
      } else {
        setRecipes(recipesRes.data ?? [])
      }

      if (stockRes.error) {
        console.warn('Stock items not available:', stockRes.error.message)
        toast.warning('No se pudo cargar el stock')
      } else {
        setStockItems(stockRes.data ?? [])
      }

      if (menuRes.error) {
        console.error('Menu items not available:', menuRes.error.message)
        toast.error('No se pudo cargar la carta')
      } else {
        setMenuItems(menuRes.data ?? [])
      }
    }
    loadAux()
  }, [profile, supabase])

  // ---------------------------------------------------------------------------
  // Menu item toggle (checklist)
  // ---------------------------------------------------------------------------

  function handleToggleMenuItem(menuItem: MenuItem) {
    const existingIdx = items.findIndex((i) => i.menu_item_id === menuItem.id)

    if (existingIdx >= 0) {
      // Deactivate → remove with undo
      handleRemoveItem(existingIdx)
    } else {
      // Activate → add to items
      const stock = stockMap.get(menuItem.name.toLowerCase().trim())
      const newItem: KitchenDailyItem = {
        _id: uid(),
        name: menuItem.name,
        qty_needed: 0,
        qty_current: stock ? stock.current_qty : 0,
        qty_sold: 0,
        qty_remaining: stock ? stock.current_qty : 0,
        unit: 'unidad',
        recipe_id: null,
        stock_item_id: stock ? stock.id : null,
        is_from_recipe: false,
        menu_item_id: menuItem.id,
        is_from_menu: true,
      }
      setItems((prev) => [...prev, newItem])
    }
  }

  /** Update an active item by its _id (used by MenuChecklistSection) */
  function handleUpdateActiveItem(itemId: string, updates: Partial<KitchenDailyItem>) {
    setItems((prev) =>
      prev.map((item) => (item._id === itemId ? { ...item, ...updates } : item)),
    )
  }

  // ---------------------------------------------------------------------------
  // Custom item CRUD (recipe, stock, manual)
  // ---------------------------------------------------------------------------

  function handleAddItem() {
    setItems((prev) => [...prev, emptyItem()])
  }

  function handleAddFromRecipe(recipe: Recipe) {
    if (items.some((i) => i.recipe_id === recipe.id && i.is_from_recipe)) {
      toast.warning(`Ingredientes de "${recipe.name}" ya estan en la lista`)
      return
    }

    const validIngredients = recipe.ingredients.filter((ing) => ing.name && ing.unit)
    if (validIngredients.length === 0) {
      toast.error('La receta no tiene ingredientes validos')
      return
    }

    const newItems: KitchenDailyItem[] = validIngredients.map((ing) => ({
      _id: uid(),
      name: `${recipe.name} - ${ing.name}`,
      qty_needed: Number(ing.qty) || 0,
      qty_current: 0,
      qty_sold: 0,
      qty_remaining: 0,
      unit: ing.unit === 'a_gusto' ? 'unidad' : ing.unit,
      recipe_id: recipe.id,
      stock_item_id: null,
      is_from_recipe: true,
      menu_item_id: null,
      is_from_menu: false,
    }))
    setItems((prev) => [...prev, ...newItems])
    setRecipeDialogOpen(false)
    toast.success(`Ingredientes de "${recipe.name}" agregados`)
  }

  function handleAddFromStock(stockItem: StockItem) {
    if (items.some((i) => i.stock_item_id === stockItem.id)) {
      toast.warning(`"${stockItem.name}" ya esta en la lista`)
      return
    }

    const newItem: KitchenDailyItem = {
      _id: uid(),
      name: stockItem.name,
      qty_needed: 0,
      qty_current: stockItem.current_qty,
      qty_sold: 0,
      qty_remaining: stockItem.current_qty,
      unit: stockItem.unit,
      recipe_id: null,
      stock_item_id: stockItem.id,
      is_from_recipe: false,
      menu_item_id: null,
      is_from_menu: false,
    }
    setItems((prev) => [...prev, newItem])
    setStockDialogOpen(false)
    toast.success(`"${stockItem.name}" agregado con stock actual`)
  }

  function handleUpdateItem(index: number, updates: Partial<KitchenDailyItem>) {
    // Find the actual item index among custom items
    const customItem = customItems[index]
    if (!customItem) return
    setItems((prev) =>
      prev.map((item) => (item._id === customItem._id ? { ...item, ...updates } : item)),
    )
  }

  function handleRemoveItem(index: number) {
    const removed = items[index]
    if (!removed) return
    setItems((prev) => prev.filter((i) => i._id !== removed._id))
    toast.success(`"${removed.name || 'Item'}" eliminado`, {
      action: {
        label: 'Deshacer',
        onClick: () => {
          setItems((prev) => [...prev, removed])
        },
      },
    })
  }

  function handleRemoveCustomItem(customIndex: number) {
    const customItem = customItems[customIndex]
    if (!customItem) return
    const realIndex = items.findIndex((i) => i._id === customItem._id)
    if (realIndex >= 0) handleRemoveItem(realIndex)
  }

  // ---------------------------------------------------------------------------
  // Save (borrador) & Submit (enviado)
  // ---------------------------------------------------------------------------

  async function handleSave(submit: boolean) {
    if (!profile) return

    // Validate: at least one item with name
    const validItems = items.filter((i) => i.name.trim() !== '')
    if (validItems.length === 0) {
      toast.error('Selecciona al menos un item de la carta o agrega uno manualmente')
      return
    }

    setSaving(true)
    try {
      const payload = {
        operative_date: dateStr,
        service: activeService,
        items: validItems,
        notes: notes.trim() || null,
        status: submit ? ('enviado' as const) : ('borrador' as const),
        created_by: profile.id,
        submitted_at: submit ? new Date().toISOString() : null,
      }

      const { data, error } = await supabase
        .from('kitchen_daily_logs')
        .upsert(payload, { onConflict: 'operative_date,service' })
        .select()
        .single()

      if (error) throw error

      setLog(data)
      setItems(validItems)

      logAuditClient({
        action: 'update_carta',
        module: 'cocina',
        entityType: 'kitchen_shift_schedule',
        description: 'User actualizó carta/agenda de cocina',
      })

      if (submit) {
        await sendSubmitAnnouncement(validItems)
        toast.success('Registro enviado — notificacion creada para el encargado')
      } else {
        toast.success('Borrador guardado')
      }
    } catch (err) {
      console.error('Error saving kitchen log:', err)
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  /** Always create an announcement when submitting + flag stock issues */
  async function sendSubmitAnnouncement(validItems: KitchenDailyItem[]) {
    if (!profile) return

    const serviceName = KITCHEN_SERVICES[activeService].label
    const dateLabel = format(selectedDate, "d 'de' MMMM", { locale: es })

    // ── Build item list ──
    const menuItemNames = validItems.filter((i) => i.is_from_menu).map((i) => i.name)
    const customItemNames = validItems.filter((i) => !i.is_from_menu).map((i) => i.name)

    // ── Check stock issues ──
    const criticalItems: string[] = []
    const lowItems: string[] = []

    for (const item of validItems) {
      // Almuerzo/cena: check quantity tracking
      if (isAlmuerzoCena && item.qty_needed > 0) {
        if (item.qty_remaining <= 0) {
          criticalItems.push(`${item.name}: necesita ${item.qty_needed}${item.unit}, restante 0`)
        } else if (item.qty_remaining < item.qty_needed * LOW_STOCK_THRESHOLD) {
          lowItems.push(`${item.name}: ${item.qty_remaining}${item.unit} restante (necesita ${item.qty_needed})`)
        }
      }

      // Check linked stock levels
      if (item.stock_item_id) {
        const stockItem = stockItems.find((s) => s.id === item.stock_item_id)
        if (stockItem) {
          if (stockItem.current_qty <= 0) {
            if (!criticalItems.some((c) => c.startsWith(item.name))) {
              criticalItems.push(`${item.name}: stock en 0 ${stockItem.unit}`)
            }
          } else if (stockItem.current_qty <= stockItem.min_qty) {
            if (!lowItems.some((l) => l.startsWith(item.name))) {
              lowItems.push(`${item.name}: ${stockItem.current_qty}${stockItem.unit} (minimo ${stockItem.min_qty})`)
            }
          }
        }
      }
    }

    const hasStockIssues = criticalItems.length > 0 || lowItems.length > 0

    // ── Build announcement body ──
    const bodyParts: string[] = []

    // Items del dia
    bodyParts.push(`Items del dia (${validItems.length}):`)
    if (menuItemNames.length > 0) {
      bodyParts.push(menuItemNames.map((n) => `- ${n}`).join('\n'))
    }
    if (customItemNames.length > 0) {
      bodyParts.push(`\nItems adicionales:`)
      bodyParts.push(customItemNames.map((n) => `- ${n}`).join('\n'))
    }

    // Stock warnings (if any)
    if (hasStockIssues) {
      bodyParts.push('')
      if (criticalItems.length > 0) {
        bodyParts.push(`🔴 CRITICO:\n${criticalItems.map((i) => `- ${i}`).join('\n')}`)
      }
      if (lowItems.length > 0) {
        bodyParts.push(`🟡 Stock bajo:\n${lowItems.map((i) => `- ${i}`).join('\n')}`)
      }
      bodyParts.push('\nRevisar compras.')
    }

    if (notes.trim()) {
      bodyParts.push(`\nNotas: ${notes.trim()}`)
    }

    // ── Title & priority ──
    let title: string
    let priority: AnnouncementInsert['priority']

    if (criticalItems.length > 0) {
      title = `🔴 Cocina: Alerta critica — ${serviceName} ${dateLabel}`
      priority = 'critica'
    } else if (lowItems.length > 0) {
      title = `🟡 Cocina: Stock bajo — ${serviceName} ${dateLabel}`
      priority = 'alta'
    } else {
      title = `🍽️ Cocina: ${serviceName} — ${dateLabel}`
      priority = 'baja'
    }

    const announcement: AnnouncementInsert = {
      title,
      body: bodyParts.join('\n'),
      type: 'operativo',
      priority,
      author_id: profile.id,
      scope: 'role',
      target_role: 'encargado',
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    }

    const { error } = await supabase.from('announcements').insert(announcement)
    if (error) {
      console.error('Error creating announcement:', error)
      toast.warning('Registro enviado, pero la notificacion no pudo crearse')
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (profileLoading) return <LoadingState message="Cargando..." />

  if (!profile || !['cocina', 'chef', 'encargado'].includes(profile.role)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-[#a39e97]">No tienes acceso a esta seccion</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-32">
      {/* Header */}
      <div>
        <h1 className="font-display text-lg font-bold text-[#3d2c24]">
          Cocina Diaria
        </h1>
        <p className="text-xs text-[#a39e97]">
          Carta del dia, control de stock y alertas
        </p>
      </div>

      {/* Date navigator */}
      <DateNavigator
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
      />

      {/* Service tabs */}
      <div className="flex gap-2">
        {(
          Object.entries(KITCHEN_SERVICES) as [
            KitchenServiceValue,
            (typeof KITCHEN_SERVICES)[KitchenServiceValue],
          ][]
        ).map(([key, config]) => (
          <button
            key={key}
            onClick={() => setActiveService(key)}
            className={`flex-1 rounded-xl px-3 py-2.5 text-center text-xs font-semibold transition-all ${
              activeService === key
                ? 'text-white shadow-sm'
                : 'bg-secondary text-[#a39e97] hover:text-[#3d2c24]'
            }`}
            style={
              activeService === key
                ? { backgroundColor: config.color }
                : undefined
            }
          >
            {config.icon} {config.label}
          </button>
        ))}
      </div>

      {/* Status badge */}
      {log && (
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
            style={{
              backgroundColor: KITCHEN_LOG_STATUSES[log.status].bg,
              color: KITCHEN_LOG_STATUSES[log.status].color,
            }}
          >
            {KITCHEN_LOG_STATUSES[log.status].label}
          </span>
          {log.submitted_at && (
            <span className="text-[10px] text-[#a39e97]">
              Enviado{' '}
              {format(new Date(log.submitted_at), "d MMM HH:mm", { locale: es })}
            </span>
          )}
          {items.length > 0 && (
            <span className="text-[10px] text-[#a39e97]">
              · {items.length} item{items.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && <LoadingState message="Cargando registro..." />}

      {/* Main content */}
      {!loading && (
        <>
          {/* ─── SECTION 1: Carta del servicio (checklist) ─── */}
          {serviceMenuItems.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wide text-[#a39e97]">
                  Carta — {KITCHEN_SERVICES[activeService].label}
                </h2>
                {items.filter((i) => i.is_from_menu).length > 0 && (
                  <span className="rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[10px] font-semibold text-[#006d5a]">
                    {items.filter((i) => i.is_from_menu).length} seleccionados
                  </span>
                )}
              </div>

              <MenuChecklistSection
                menuItems={serviceMenuItems}
                activeItems={items}
                stockMap={stockMap}
                isAlmuerzoCena={isAlmuerzoCena}
                canEdit={isEditable}
                onToggle={handleToggleMenuItem}
                onUpdateActiveItem={handleUpdateActiveItem}
              />
            </div>
          )}

          {/* ─── SECTION 2: Custom items (receta, stock, manual) ─── */}
          {customItems.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#a39e97]">
                Items adicionales
              </h2>
              <div className="space-y-2">
                {customItems.map((item, index) => (
                  <KitchenItemRow
                    key={item._id}
                    item={item}
                    index={index}
                    isAlmuerzoCena={isAlmuerzoCena}
                    canEdit={isEditable}
                    onUpdate={handleUpdateItem}
                    onRemove={handleRemoveCustomItem}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ─── Action buttons ─── */}
          {isEditable && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleAddItem}
                className="flex items-center gap-1.5 rounded-xl border border-dashed border-[#ebe6df] px-3 py-2 text-xs font-medium text-[#a39e97] transition-all hover:border-[#006d5a]/40 hover:bg-[#e8f5f1]/40 hover:text-[#006d5a]"
              >
                <Plus className="size-3.5" />
                Agregar item
              </button>
              <button
                onClick={() => setRecipeDialogOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-dashed border-[#ebe6df] px-3 py-2 text-xs font-medium text-[#a39e97] transition-all hover:border-[#d4943a]/40 hover:bg-[#fdf6ec]/60 hover:text-[#d4943a]"
              >
                <ChefHat className="size-3.5" />
                Desde receta
              </button>
              <button
                onClick={() => setStockDialogOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-dashed border-[#ebe6df] px-3 py-2 text-xs font-medium text-[#a39e97] transition-all hover:border-[#006d5a]/40 hover:bg-[#e8f5f1]/40 hover:text-[#006d5a]"
              >
                <Package className="size-3.5" />
                Desde stock
              </button>
            </div>
          )}

          {/* ─── Notes ─── */}
          {isEditable ? (
            <div>
              <label className="section-label mb-1.5 block">Notas</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas adicionales del dia..."
                rows={2}
                className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none placeholder:text-[#c4bfb8] focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]/20"
              />
            </div>
          ) : notes ? (
            <div>
              <span className="section-label mb-1 block">Notas</span>
              <p className="whitespace-pre-wrap text-sm text-[#3d2c24]">
                {notes}
              </p>
            </div>
          ) : null}

          {/* ─── Save / Submit bar ─── */}
          {isEditable && items.length > 0 && (
            <div className="fixed bottom-16 left-0 right-0 z-30 border-t border-[#ebe6df] bg-[#fefcf9]/95 px-4 py-3 backdrop-blur-sm">
              <div className="mx-auto flex max-w-2xl gap-2">
                <button
                  onClick={() => handleSave(false)}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#ebe6df] bg-[#fefcf9] py-2.5 text-sm font-semibold text-[#3d2c24] transition-all hover:bg-secondary disabled:opacity-50"
                >
                  <Save className="size-4" />
                  Guardar borrador
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] disabled:opacity-50"
                >
                  <Send className="size-4" />
                  Enviar
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Dialogs */}
      <AddFromRecipeDialog
        open={recipeDialogOpen}
        onOpenChange={setRecipeDialogOpen}
        recipes={recipes}
        onSelect={handleAddFromRecipe}
      />
      <AddFromStockDialog
        open={stockDialogOpen}
        onOpenChange={setStockDialogOpen}
        stockItems={stockItems}
        onSelect={handleAddFromStock}
      />
    </div>
  )
}
