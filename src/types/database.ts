export type AppRole = 'socio' | 'encargado' | 'chef' | 'barista' | 'runner' | 'cocina'
export type AnnouncementTypeValue = 'general' | 'urgente' | 'recordatorio' | 'operativo'
export type PriorityValue = 'baja' | 'media' | 'alta' | 'critica'
export type AlertTypeValue = 'low_stock' | 'upcoming_purchase' | 'critical'
export type KitchenServiceValue = 'desayuno_merienda' | 'almuerzo_cena'
export type KitchenLogStatusValue = 'borrador' | 'enviado'

// Kitchen Operations enums
export type KitchenShiftTypeValue = 'morning' | 'night'
export type KitchenShiftStatusValue = 'pending' | 'in_progress' | 'completed'
export type ChecklistTypeValue = 'opening' | 'production' | 'service' | 'closing'
export type ChecklistTimingValue = 'on_arrival' | 'pre_service' | 'during_service' | 'closing' | 'scheduled'
export type KitchenFamilyValue = 'equipment' | 'proteins' | 'vegetables' | 'pastry' | 'bread' | 'dairy' | 'cold_storage' | 'mise_en_place' | 'general'
export type ChecklistItemStatusValue = 'pending' | 'done' | 'skipped' | 'overdue'
export type MiseRecordStatusValue = 'pending' | 'in_progress' | 'done' | 'low' | 'missing'

// Bar enums
export type BarCategoryValue = 'lacteos' | 'cafe' | 'packaging' | 'suministros' | 'insumos_oyambre' | 'libreria' | 'general'
export type BarOrderUrgencyValue = 'normal' | 'alta' | 'urgente'
export type BarOrderStatusValue = 'pending' | 'ordered' | 'received' | 'cancelled'

// Kitchen order enums
export type KitchenOrderCategoryValue = 'verduleria' | 'fruteria' | 'carniceria' | 'fiambreria' | 'panaderia' | 'lacteos' | 'secos' | 'limpieza' | 'otros'
export type KitchenOrderUrgencyValue = 'normal' | 'alta' | 'urgente'
export type KitchenOrderStatusValue = 'pending' | 'ordered' | 'received' | 'cancelled'

// Legacy enum types (UI existente los usa, se van a eliminar al migrar cada página)
export type StockCategoryValue = 'bebidas' | 'lacteos' | 'carnes' | 'verduras' | 'frutas' | 'panaderia' | 'condimentos' | 'limpieza' | 'desechables' | 'otros'
export type RecipeCategoryValue = 'bebidas' | 'platos' | 'postres' | 'snacks'
export type MenuItemCategoryValue =
  | 'desayunos_meriendas'
  | 'entrepanes'
  | 'tostones'
  | 'sin_trigo'
  | 'panaderia_salada'
  | 'entradas'
  | 'ensaladas'
  | 'kids'
  | 'especialidades'
  | 'pizzas'
  | 'entre_panes'
  | 'bebidas'
  | 'postres'

// Tipo viejo de ingrediente JSONB (reemplazado por tabla recipe_ingredients)
export type LegacyRecipeIngredient = {
  name: string
  qty: string
  unit: string
}

export type KitchenDailyItem = {
  _id: string
  name: string
  qty_needed: number
  qty_current: number
  qty_sold: number
  qty_remaining: number
  unit: string
  recipe_id: string | number | null
  stock_item_id: string | number | null
  is_from_recipe: boolean
  menu_item_id: string | number | null
  is_from_menu: boolean
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          first_name: string
          last_name: string
          role: AppRole
          avatar_url: string | null
          phone: string | null
          is_active: boolean
          settings: Record<string, unknown>
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          first_name: string
          last_name: string
          role?: AppRole
          avatar_url?: string | null
          phone?: string | null
          is_active?: boolean
          settings?: Record<string, unknown>
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          first_name?: string
          last_name?: string
          role?: AppRole
          avatar_url?: string | null
          phone?: string | null
          is_active?: boolean
          settings?: Record<string, unknown>
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      attendance_logs: {
        Row: {
          id: string
          user_id: string
          operative_date: string
          clock_in_at: string
          clock_out_at: string | null
          status: 'open' | 'closed' | 'missing_checkout'
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          operative_date?: string
          clock_in_at?: string
          clock_out_at?: string | null
          status?: 'open' | 'closed' | 'missing_checkout'
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          operative_date?: string
          clock_in_at?: string
          clock_out_at?: string | null
          status?: 'open' | 'closed' | 'missing_checkout'
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          id: string
          user_id: string
          shift_date: string
          start_time: string
          end_time: string
          shift_role: AppRole
          color: string
          emoji: string
          notes: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          shift_date: string
          start_time: string
          end_time: string
          shift_role: AppRole
          color?: string
          emoji?: string
          notes?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          shift_date?: string
          start_time?: string
          end_time?: string
          shift_role?: AppRole
          color?: string
          emoji?: string
          notes?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          id: string
          author_id: string
          type: AnnouncementTypeValue
          priority: PriorityValue
          title: string
          body: string
          scope: 'all' | 'role' | 'user'
          target_role: AppRole | null
          target_user_id: string | null
          publish_at: string
          expires_at: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          author_id: string
          type?: AnnouncementTypeValue
          priority?: PriorityValue
          title: string
          body: string
          scope?: 'all' | 'role' | 'user'
          target_role?: AppRole | null
          target_user_id?: string | null
          publish_at?: string
          expires_at?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          author_id?: string
          type?: AnnouncementTypeValue
          priority?: PriorityValue
          title?: string
          body?: string
          scope?: 'all' | 'role' | 'user'
          target_role?: AppRole | null
          target_user_id?: string | null
          publish_at?: string
          expires_at?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      announcement_reads: {
        Row: {
          id: string
          announcement_id: string
          user_id: string
          read_at: string
        }
        Insert: {
          id?: string
          announcement_id: string
          user_id: string
          read_at?: string
        }
        Update: {
          id?: string
          announcement_id?: string
          user_id?: string
          read_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          id: number
          name: string
          contact_name: string | null
          phone: string | null
          email: string | null
          notes: string | null
          created_at: string
          updated_at: string
          category: string
          is_active: boolean
          fudo_provider_id: string | null
        }
        Insert: {
          id?: number
          name: string
          contact_name?: string | null
          phone?: string | null
          email?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          category?: string
          is_active?: boolean
          fudo_provider_id?: string | null
        }
        Update: {
          id?: number
          name?: string
          contact_name?: string | null
          phone?: string | null
          email?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          category?: string
          is_active?: boolean
          fudo_provider_id?: string | null
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          id: number
          name: string
          unit: string
          min_level: number
          current_qty: number
          cost_per_unit: number | null
          shelf_life_days: number | null
          supplier_id: number | null
          fudo_product_id: string | null
          fudo_ingredient_id: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          min_qty: number
          category: StockCategoryValue
          semaphore: 'green' | 'yellow' | 'red'
          notes: string | null
          next_purchase_date: string | null
          last_ordered_at: string | null
        }
        Insert: {
          id?: number
          name: string
          unit: string
          min_level?: number
          current_qty?: number
          cost_per_unit?: number | null
          shelf_life_days?: number | null
          supplier_id?: number | null
          fudo_product_id?: string | null
          fudo_ingredient_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          min_qty?: number
          category?: StockCategoryValue
          notes?: string | null
        }
        Update: {
          id?: number
          name?: string
          unit?: string
          min_level?: number
          current_qty?: number
          cost_per_unit?: number | null
          shelf_life_days?: number | null
          supplier_id?: number | null
          fudo_product_id?: string | null
          fudo_ingredient_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          min_qty?: number
          category?: StockCategoryValue
          notes?: string | null
          last_ordered_at?: string | null
        }
        Relationships: []
      }
      stock_alerts: {
        Row: {
          id: string
          stock_item_id: string
          alert_type: AlertTypeValue
          priority: PriorityValue
          message: string
          status: 'active' | 'resolved' | 'snoozed'
          triggered_at: string
          resolved_at: string | null
          resolved_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          stock_item_id: string
          alert_type: AlertTypeValue
          priority?: PriorityValue
          message: string
          status?: 'active' | 'resolved' | 'snoozed'
          triggered_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          stock_item_id?: string
          alert_type?: AlertTypeValue
          priority?: PriorityValue
          message?: string
          status?: 'active' | 'resolved' | 'snoozed'
          triggered_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      recipes: {
        Row: {
          id: number
          name: string
          description: string | null
          portion_yield: number
          is_active: boolean
          created_at: string
          updated_at: string
          category: RecipeCategoryValue
          ingredients: LegacyRecipeIngredient[]
          preparation: string
          notes: string | null
          created_by: string
        }
        Insert: {
          id?: number
          name: string
          description?: string | null
          portion_yield?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          category?: RecipeCategoryValue
          ingredients?: LegacyRecipeIngredient[]
          preparation?: string
          notes?: string | null
          created_by?: string
        }
        Update: {
          id?: number
          name?: string
          description?: string | null
          portion_yield?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          category?: RecipeCategoryValue
          ingredients?: LegacyRecipeIngredient[]
          preparation?: string
          notes?: string | null
          created_by?: string
        }
        Relationships: []
      }
      recipe_ingredients: {
        Row: {
          id: number
          recipe_id: number
          stock_item_id: number
          qty_per_portion: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          recipe_id: number
          stock_item_id: number
          qty_per_portion: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          recipe_id?: number
          stock_item_id?: number
          qty_per_portion?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      menu_categories: {
        Row: {
          id: number
          name: string
          fudo_category_id: string | null
          sort_order: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          name: string
          fudo_category_id?: string | null
          sort_order?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          name?: string
          fudo_category_id?: string | null
          sort_order?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          id: number
          name: string
          description: string | null
          menu_category_id: number | null
          fudo_product_id: string | null
          recipe_id: number | null
          sale_price: number | null
          is_active: boolean
          created_at: string
          updated_at: string
          category: MenuItemCategoryValue
          subcategory: string | null
          requires_preparation: boolean
          track_stock: boolean
          sort_order: number
        }
        Insert: {
          id?: number
          name: string
          description?: string | null
          menu_category_id?: number | null
          fudo_product_id?: string | null
          recipe_id?: number | null
          sale_price?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          category?: MenuItemCategoryValue
          subcategory?: string | null
          requires_preparation?: boolean
          track_stock?: boolean
          sort_order?: number
        }
        Update: {
          id?: number
          name?: string
          description?: string | null
          menu_category_id?: number | null
          fudo_product_id?: string | null
          recipe_id?: number | null
          sale_price?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          category?: MenuItemCategoryValue
          subcategory?: string | null
          requires_preparation?: boolean
          track_stock?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      fudo_sales: {
        Row: {
          id: number
          fudo_ticket_id: string
          fudo_product_id: string
          quantity: number
          sold_at: string
          raw_payload: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: number
          fudo_ticket_id: string
          fudo_product_id: string
          quantity: number
          sold_at: string
          raw_payload?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: number
          fudo_ticket_id?: string
          fudo_product_id?: string
          quantity?: number
          sold_at?: string
          raw_payload?: Record<string, unknown> | null
          created_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          id: number
          stock_item_id: number
          change: number
          reason: string
          reference_type: string | null
          reference_id: string | null
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: number
          stock_item_id: number
          change: number
          reason: string
          reference_type?: string | null
          reference_id?: string | null
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: number
          stock_item_id?: number
          change?: number
          reason?: string
          reference_type?: string | null
          reference_id?: string | null
          created_at?: string
          created_by?: string | null
        }
        Relationships: []
      }
      kitchen_daily_logs: {
        Row: {
          id: string
          operative_date: string
          service: KitchenServiceValue
          items: KitchenDailyItem[]
          notes: string | null
          status: KitchenLogStatusValue
          created_by: string
          submitted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          operative_date: string
          service: KitchenServiceValue
          items?: KitchenDailyItem[]
          notes?: string | null
          status?: KitchenLogStatusValue
          created_by: string
          submitted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          operative_date?: string
          service?: KitchenServiceValue
          items?: KitchenDailyItem[]
          notes?: string | null
          status?: KitchenLogStatusValue
          created_by?: string
          submitted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: number
          table_name: string
          action: string
          user_id: string | null
          old_data: Record<string, unknown> | null
          new_data: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          table_name: string
          action: string
          user_id?: string | null
          old_data?: Record<string, unknown> | null
          new_data?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          table_name?: string
          action?: string
          user_id?: string | null
          old_data?: Record<string, unknown> | null
          new_data?: Record<string, unknown> | null
          created_at?: string
        }
        Relationships: []
      }
      // -----------------------------------------------------------------
      // Kitchen Operations tables
      // -----------------------------------------------------------------
      kitchen_shifts: {
        Row: {
          id: number
          date: string
          shift_type: KitchenShiftTypeValue
          status: KitchenShiftStatusValue
          opened_by: string | null
          closed_by: string | null
          handover_note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          date: string
          shift_type: KitchenShiftTypeValue
          status?: KitchenShiftStatusValue
          opened_by?: string | null
          closed_by?: string | null
          handover_note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          date?: string
          shift_type?: KitchenShiftTypeValue
          status?: KitchenShiftStatusValue
          opened_by?: string | null
          closed_by?: string | null
          handover_note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      checklist_templates: {
        Row: {
          id: number
          title: string
          description: string | null
          type: ChecklistTypeValue
          shift: KitchenShiftTypeValue | 'both'
          timing: ChecklistTimingValue
          scheduled_time: string | null
          family: KitchenFamilyValue
          is_critical: boolean
          sort_order: number
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          title: string
          description?: string | null
          type: ChecklistTypeValue
          shift: KitchenShiftTypeValue | 'both'
          timing: ChecklistTimingValue
          scheduled_time?: string | null
          family?: KitchenFamilyValue
          is_critical?: boolean
          sort_order?: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          title?: string
          description?: string | null
          type?: ChecklistTypeValue
          shift?: KitchenShiftTypeValue | 'both'
          timing?: ChecklistTimingValue
          scheduled_time?: string | null
          family?: KitchenFamilyValue
          is_critical?: boolean
          sort_order?: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      checklist_items: {
        Row: {
          id: number
          kitchen_shift_id: number
          template_id: number | null
          title: string
          type: ChecklistTypeValue
          timing: ChecklistTimingValue
          scheduled_time: string | null
          family: KitchenFamilyValue
          is_critical: boolean
          sort_order: number
          status: ChecklistItemStatusValue
          completed_by: string | null
          completed_at: string | null
          note: string | null
          is_alert_sent: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          kitchen_shift_id: number
          template_id?: number | null
          title: string
          type: ChecklistTypeValue
          timing: ChecklistTimingValue
          scheduled_time?: string | null
          family?: KitchenFamilyValue
          is_critical?: boolean
          sort_order?: number
          status?: ChecklistItemStatusValue
          completed_by?: string | null
          completed_at?: string | null
          note?: string | null
          is_alert_sent?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          kitchen_shift_id?: number
          template_id?: number | null
          title?: string
          type?: ChecklistTypeValue
          timing?: ChecklistTimingValue
          scheduled_time?: string | null
          family?: KitchenFamilyValue
          is_critical?: boolean
          sort_order?: number
          status?: ChecklistItemStatusValue
          completed_by?: string | null
          completed_at?: string | null
          note?: string | null
          is_alert_sent?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      mise_en_place_items: {
        Row: {
          id: number
          name: string
          family: KitchenFamilyValue
          unit: string
          target_quantity: number
          alert_threshold: number
          shift: KitchenShiftTypeValue | 'both'
          recipe_id: number | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          name: string
          family?: KitchenFamilyValue
          unit?: string
          target_quantity?: number
          alert_threshold?: number
          shift: KitchenShiftTypeValue | 'both'
          recipe_id?: number | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          name?: string
          family?: KitchenFamilyValue
          unit?: string
          target_quantity?: number
          alert_threshold?: number
          shift?: KitchenShiftTypeValue | 'both'
          recipe_id?: number | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      mise_en_place_records: {
        Row: {
          id: number
          kitchen_shift_id: number
          mise_en_place_item_id: number
          status: MiseRecordStatusValue
          quantity_produced: number | null
          produced_by: string | null
          note: string | null
          left_for_next_shift: boolean
          quantity_left_for_next_shift: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          kitchen_shift_id: number
          mise_en_place_item_id: number
          status?: MiseRecordStatusValue
          quantity_produced?: number | null
          produced_by?: string | null
          note?: string | null
          left_for_next_shift?: boolean
          quantity_left_for_next_shift?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          kitchen_shift_id?: number
          mise_en_place_item_id?: number
          status?: MiseRecordStatusValue
          quantity_produced?: number | null
          produced_by?: string | null
          note?: string | null
          left_for_next_shift?: boolean
          quantity_left_for_next_shift?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      // -----------------------------------------------------------------
      // Bar operations tables
      // -----------------------------------------------------------------
      bar_stock_items: {
        Row: {
          id: number
          name: string
          category: BarCategoryValue
          unit: string
          current_qty: number
          current_detail: string | null
          min_level: number
          is_urgent: boolean
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          name: string
          category?: BarCategoryValue
          unit?: string
          current_qty?: number
          current_detail?: string | null
          min_level?: number
          is_urgent?: boolean
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          name?: string
          category?: BarCategoryValue
          unit?: string
          current_qty?: number
          current_detail?: string | null
          min_level?: number
          is_urgent?: boolean
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      bar_orders: {
        Row: {
          id: number
          bar_stock_item_id: number | null
          product_name: string
          category: string
          quantity: string
          urgency: BarOrderUrgencyValue
          status: BarOrderStatusValue
          note: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          bar_stock_item_id?: number | null
          product_name: string
          category?: string
          quantity: string
          urgency?: BarOrderUrgencyValue
          status?: BarOrderStatusValue
          note?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          bar_stock_item_id?: number | null
          product_name?: string
          category?: string
          quantity?: string
          urgency?: BarOrderUrgencyValue
          status?: BarOrderStatusValue
          note?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      kitchen_orders: {
        Row: {
          id: number
          product_name: string
          category: KitchenOrderCategoryValue
          quantity: string
          urgency: KitchenOrderUrgencyValue
          status: KitchenOrderStatusValue
          note: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          product_name: string
          category?: KitchenOrderCategoryValue
          quantity: string
          urgency?: KitchenOrderUrgencyValue
          status?: KitchenOrderStatusValue
          note?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          product_name?: string
          category?: KitchenOrderCategoryValue
          quantity?: string
          urgency?: KitchenOrderUrgencyValue
          status?: KitchenOrderStatusValue
          note?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clock_in: {
        Args: { p_notes?: string }
        Returns: Record<string, unknown>
      }
      clock_out: {
        Args: { p_notes?: string }
        Returns: Record<string, unknown>
      }
      get_my_announcements: {
        Args: Record<string, never>
        Returns: Database['public']['Tables']['announcements']['Row'][]
      }
      get_weekly_schedule: {
        Args: { p_start_date: string }
        Returns: {
          shift_id: string
          user_id: string
          first_name: string
          last_name: string
          shift_date: string
          start_time: string
          end_time: string
          shift_role: AppRole
          color: string
          emoji: string
          notes: string | null
        }[]
      }
      update_stock_qty: {
        Args: { p_item_id: string; p_new_qty: number }
        Returns: Record<string, unknown>
      }
      resolve_alert: {
        Args: { p_alert_id: string }
        Returns: Record<string, unknown>
      }
      register_stock_movement: {
        Args: {
          p_stock_item_id: number
          p_change: number
          p_reason: string
          p_reference_type: string | null
          p_reference_id: string | null
        }
        Returns: {
          movement_id: number
          stock_item_id: number
          change: number
          new_qty: number
          reason: string
        }
      }
      produce_recipe: {
        Args: {
          p_recipe_id: number
          p_portions: number
          p_reference_id: string | null
        }
        Returns: Record<string, unknown>
      }
      deduct_stock_on_sale: {
        Args: {
          p_sale_id: number
        }
        Returns: Record<string, unknown>
      }
    }
    Enums: {
      app_role: AppRole
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience type aliases
// ---------------------------------------------------------------------------
export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

export type AttendanceLog = Database['public']['Tables']['attendance_logs']['Row']
export type AttendanceLogInsert = Database['public']['Tables']['attendance_logs']['Insert']
export type AttendanceLogUpdate = Database['public']['Tables']['attendance_logs']['Update']

export type Shift = Database['public']['Tables']['shifts']['Row']
export type ShiftInsert = Database['public']['Tables']['shifts']['Insert']
export type ShiftUpdate = Database['public']['Tables']['shifts']['Update']

export type Announcement = Database['public']['Tables']['announcements']['Row']
export type AnnouncementInsert = Database['public']['Tables']['announcements']['Insert']
export type AnnouncementUpdate = Database['public']['Tables']['announcements']['Update']

export type AnnouncementRead = Database['public']['Tables']['announcement_reads']['Row']

export type Supplier = Database['public']['Tables']['suppliers']['Row']
export type SupplierInsert = Database['public']['Tables']['suppliers']['Insert']
export type SupplierUpdate = Database['public']['Tables']['suppliers']['Update']

export type StockItem = Database['public']['Tables']['stock_items']['Row']
export type StockItemInsert = Database['public']['Tables']['stock_items']['Insert']
export type StockItemUpdate = Database['public']['Tables']['stock_items']['Update']

export type StockAlert = Database['public']['Tables']['stock_alerts']['Row']
export type StockAlertInsert = Database['public']['Tables']['stock_alerts']['Insert']
export type StockAlertUpdate = Database['public']['Tables']['stock_alerts']['Update']

export type Recipe = Database['public']['Tables']['recipes']['Row']
export type RecipeInsert = Database['public']['Tables']['recipes']['Insert']
export type RecipeUpdate = Database['public']['Tables']['recipes']['Update']

export type RecipeIngredient = Database['public']['Tables']['recipe_ingredients']['Row']
export type RecipeIngredientInsert = Database['public']['Tables']['recipe_ingredients']['Insert']
export type RecipeIngredientUpdate = Database['public']['Tables']['recipe_ingredients']['Update']

export type MenuCategory = Database['public']['Tables']['menu_categories']['Row']
export type MenuCategoryInsert = Database['public']['Tables']['menu_categories']['Insert']
export type MenuCategoryUpdate = Database['public']['Tables']['menu_categories']['Update']

export type MenuItem = Database['public']['Tables']['menu_items']['Row']
export type MenuItemInsert = Database['public']['Tables']['menu_items']['Insert']
export type MenuItemUpdate = Database['public']['Tables']['menu_items']['Update']

export type FudoSale = Database['public']['Tables']['fudo_sales']['Row']
export type FudoSaleInsert = Database['public']['Tables']['fudo_sales']['Insert']

export type StockMovement = Database['public']['Tables']['stock_movements']['Row']
export type StockMovementInsert = Database['public']['Tables']['stock_movements']['Insert']

export type RecipeCost = {
  recipe_id: number
  recipe_name: string
  portion_yield: number
  cost_per_portion: number
  cost_per_batch: number
}

export type KitchenDailyLog = Database['public']['Tables']['kitchen_daily_logs']['Row']
export type KitchenDailyLogInsert = Database['public']['Tables']['kitchen_daily_logs']['Insert']
export type KitchenDailyLogUpdate = Database['public']['Tables']['kitchen_daily_logs']['Update']

export type AuditLog = Database['public']['Tables']['audit_log']['Row']

// Kitchen Operations type aliases
export type KitchenShift = Database['public']['Tables']['kitchen_shifts']['Row']
export type KitchenShiftInsert = Database['public']['Tables']['kitchen_shifts']['Insert']
export type KitchenShiftUpdate = Database['public']['Tables']['kitchen_shifts']['Update']

export type ChecklistTemplate = Database['public']['Tables']['checklist_templates']['Row']
export type ChecklistTemplateInsert = Database['public']['Tables']['checklist_templates']['Insert']
export type ChecklistTemplateUpdate = Database['public']['Tables']['checklist_templates']['Update']

export type ChecklistItem = Database['public']['Tables']['checklist_items']['Row']
export type ChecklistItemInsert = Database['public']['Tables']['checklist_items']['Insert']
export type ChecklistItemUpdate = Database['public']['Tables']['checklist_items']['Update']

export type MiseEnPlaceItem = Database['public']['Tables']['mise_en_place_items']['Row']
export type MiseEnPlaceItemInsert = Database['public']['Tables']['mise_en_place_items']['Insert']
export type MiseEnPlaceItemUpdate = Database['public']['Tables']['mise_en_place_items']['Update']

export type MiseEnPlaceRecord = Database['public']['Tables']['mise_en_place_records']['Row']
export type MiseEnPlaceRecordInsert = Database['public']['Tables']['mise_en_place_records']['Insert']
export type MiseEnPlaceRecordUpdate = Database['public']['Tables']['mise_en_place_records']['Update']

// Bar operations type aliases
export type BarStockItem = Database['public']['Tables']['bar_stock_items']['Row']
export type BarStockItemInsert = Database['public']['Tables']['bar_stock_items']['Insert']
export type BarStockItemUpdate = Database['public']['Tables']['bar_stock_items']['Update']

export type BarOrder = Database['public']['Tables']['bar_orders']['Row']
export type BarOrderInsert = Database['public']['Tables']['bar_orders']['Insert']
export type BarOrderUpdate = Database['public']['Tables']['bar_orders']['Update']

// Kitchen order type aliases
export type KitchenOrder = Database['public']['Tables']['kitchen_orders']['Row']
export type KitchenOrderInsert = Database['public']['Tables']['kitchen_orders']['Insert']
export type KitchenOrderUpdate = Database['public']['Tables']['kitchen_orders']['Update']
