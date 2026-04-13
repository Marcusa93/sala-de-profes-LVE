export type AppRole = 'socio' | 'encargado' | 'chef' | 'barista' | 'runner' | 'cocina' | 'bacha'
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

// Attendance Anti-Fraud enums (needed inside Database type)
export type ClockEventType = 'clock_in' | 'clock_out'
export type AnomalyType = 'wifi_mismatch' | 'gps_out_of_range' | 'unknown_device' | 'rapid_succession' | 'unusual_hour'
export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'
export type CorrectionType = 'add_missing' | 'change_time' | 'remove_event'
export type CorrectionStatus = 'pending' | 'approved' | 'rejected'
export type AnomalyFlag = { type: AnomalyType; [key: string]: unknown }

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
          // Security fields
          photo_url: string | null
          clock_in_photo_url: string | null
          clock_out_photo_url: string | null
          geo_lat: number | null
          geo_lng: number | null
          geo_accuracy: number | null
          geo_verified: boolean
          geo_distance_m: number | null
          wifi_ssid: string | null
          wifi_verified: boolean
          device_id: string | null
          device_info: Record<string, unknown> | null
          ip_address: string | null
          is_suspicious: boolean
          suspicious_reasons: string[] | null
          clock_out_type: string | null
          edited_by: string | null
          edited_reason: string | null
          original_clock_out: string | null
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
          photo_url?: string | null
          clock_in_photo_url?: string | null
          clock_out_photo_url?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_accuracy?: number | null
          geo_verified?: boolean
          wifi_ssid?: string | null
          wifi_verified?: boolean
          device_id?: string | null
          device_info?: Record<string, unknown> | null
          ip_address?: string | null
          is_suspicious?: boolean
          suspicious_reasons?: string[] | null
        }
        Update: {
          id?: string
          user_id?: string
          operative_date?: string
          clock_in_at?: string
          clock_out_at?: string | null
          status?: 'open' | 'closed' | 'missing_checkout'
          notes?: string | null
          photo_url?: string | null
          clock_in_photo_url?: string | null
          clock_out_photo_url?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_accuracy?: number | null
          geo_verified?: boolean
          wifi_ssid?: string | null
          wifi_verified?: boolean
          device_id?: string | null
          device_info?: Record<string, unknown> | null
          ip_address?: string | null
          is_suspicious?: boolean
          suspicious_reasons?: string[] | null
          clock_out_type?: string | null
          edited_by?: string | null
          edited_reason?: string | null
          original_clock_out?: string | null
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
          stock_item_id: number
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
          stock_item_id: number
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
          stock_item_id?: number
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
          slug: string | null
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
          slug?: string | null
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
          slug?: string | null
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
          ingredient_unit: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          recipe_id: number
          stock_item_id: number
          qty_per_portion: number
          ingredient_unit?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          recipe_id?: number
          stock_item_id?: number
          qty_per_portion?: number
          ingredient_unit?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      recipe_ingredient_pending_links: {
        Row: {
          id: number
          recipe_id: number | null
          recipe_name: string
          recipe_slug: string
          ingredient_name: string
          normalized_name: string
          cantidad: number | null
          unidad: string | null
          match_confidence: 'ambiguo' | 'sin_match'
          match_score: number
          suggested_stock_item_id: number | null
          suggested_stock_item_name: string | null
          match_reasons: string[]
          status: 'pending' | 'approved' | 'rejected' | 'manual'
          resolved_stock_item_id: number | null
          resolved_qty_per_portion: number | null
          resolved_unit: string | null
          resolved_by: string | null
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          recipe_id?: number | null
          recipe_name: string
          recipe_slug: string
          ingredient_name: string
          normalized_name: string
          cantidad?: number | null
          unidad?: string | null
          match_confidence: 'ambiguo' | 'sin_match'
          match_score?: number
          suggested_stock_item_id?: number | null
          suggested_stock_item_name?: string | null
          match_reasons?: string[]
          status?: 'pending' | 'approved' | 'rejected' | 'manual'
          resolved_stock_item_id?: number | null
          resolved_qty_per_portion?: number | null
          resolved_unit?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          recipe_id?: number | null
          recipe_name?: string
          recipe_slug?: string
          ingredient_name?: string
          normalized_name?: string
          cantidad?: number | null
          unidad?: string | null
          match_confidence?: 'ambiguo' | 'sin_match'
          match_score?: number
          suggested_stock_item_id?: number | null
          suggested_stock_item_name?: string | null
          match_reasons?: string[]
          status?: 'pending' | 'approved' | 'rejected' | 'manual'
          resolved_stock_item_id?: number | null
          resolved_qty_per_portion?: number | null
          resolved_unit?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
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
          supplier_id: number | null
          requested_by: string | null
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
          supplier_id?: number | null
          requested_by?: string | null
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
          supplier_id?: number | null
          requested_by?: string | null
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
          supplier_id: number | null
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
          supplier_id?: number | null
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
          supplier_id?: number | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      production_templates: {
        Row: {
          id: number
          name: string
          description: string | null
          input_stock_item_id: number | null
          input_unit: string
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          name: string
          description?: string | null
          input_stock_item_id?: number | null
          input_unit?: string
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          name?: string
          description?: string | null
          input_stock_item_id?: number | null
          input_unit?: string
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      production_template_outputs: {
        Row: {
          id: number
          template_id: number
          stock_item_id: number | null
          output_name: string
          theoretical_yield_pct: number
          output_unit: string
          is_waste: boolean
          sort_order: number
          notes: string | null
        }
        Insert: {
          id?: number
          template_id: number
          stock_item_id?: number | null
          output_name: string
          theoretical_yield_pct: number
          output_unit: string
          is_waste?: boolean
          sort_order?: number
          notes?: string | null
        }
        Update: {
          id?: number
          template_id?: number
          stock_item_id?: number | null
          output_name?: string
          theoretical_yield_pct?: number
          output_unit?: string
          is_waste?: boolean
          sort_order?: number
          notes?: string | null
        }
        Relationships: []
      }
      production_orders: {
        Row: {
          id: number
          name: string
          parent_order_id: number | null
          template_id: number | null
          status: 'draft' | 'in_progress' | 'completed' | 'cancelled'
          chef_id: string | null
          notes: string | null
          started_at: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          name: string
          parent_order_id?: number | null
          template_id?: number | null
          status?: 'draft' | 'in_progress' | 'completed' | 'cancelled'
          chef_id?: string | null
          notes?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          name?: string
          parent_order_id?: number | null
          template_id?: number | null
          status?: 'draft' | 'in_progress' | 'completed' | 'cancelled'
          chef_id?: string | null
          notes?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      production_inputs: {
        Row: {
          id: number
          production_order_id: number
          stock_item_id: number
          qty_used: number
          unit: string
          cost_per_unit: number | null
          stock_movement_id: number | null
          created_at: string
        }
        Insert: {
          id?: number
          production_order_id: number
          stock_item_id: number
          qty_used: number
          unit: string
          cost_per_unit?: number | null
          stock_movement_id?: number | null
          created_at?: string
        }
        Update: {
          id?: number
          production_order_id?: number
          stock_item_id?: number
          qty_used?: number
          unit?: string
          cost_per_unit?: number | null
          stock_movement_id?: number | null
      attendance_audit: {
        Row: {
          id: string
          log_id: string
          editor_id: string
          action: string
          reason: string
          old_value: Record<string, unknown> | null
          new_value: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          log_id: string
          editor_id: string
          action: string
          reason: string
          old_value?: Record<string, unknown> | null
          new_value?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: string
          log_id?: string
          editor_id?: string
          action?: string
          reason?: string
          old_value?: Record<string, unknown> | null
          new_value?: Record<string, unknown> | null
          created_at?: string
        }
        Relationships: []
      }
      // -----------------------------------------------------------------------
      // Attendance Anti-Fraud System tables
      // -----------------------------------------------------------------------
      clock_events: {
        Row: {
          id: string
          employee_id: string
          event_type: 'clock_in' | 'clock_out'
          timestamp: string
          wifi_bssid: string | null
          wifi_ssid: string | null
          gps_lat: number | null
          gps_lng: number | null
          gps_accuracy: number | null
          selfie_url: string | null
          device_fingerprint: string | null
          user_agent: string | null
          ip_address: string | null
          verified: boolean
          anomaly_flags: AnomalyFlag[]
          created_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          event_type: 'clock_in' | 'clock_out'
          timestamp?: string
          wifi_bssid?: string | null
          wifi_ssid?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          gps_accuracy?: number | null
          selfie_url?: string | null
          device_fingerprint?: string | null
          user_agent?: string | null
          ip_address?: string | null
          verified?: boolean
          anomaly_flags?: AnomalyFlag[]
          created_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          event_type?: 'clock_in' | 'clock_out'
          timestamp?: string
          wifi_bssid?: string | null
          wifi_ssid?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          gps_accuracy?: number | null
          selfie_url?: string | null
          device_fingerprint?: string | null
          user_agent?: string | null
          ip_address?: string | null
          verified?: boolean
          anomaly_flags?: AnomalyFlag[]
          created_at?: string
        }
        Relationships: []
      }
      device_registrations: {
        Row: {
          id: string
          employee_id: string
          device_fingerprint: string
          user_agent: string | null
          device_name: string | null
          registered_at: string
          is_active: boolean
          approved_by: string | null
          approved_at: string | null
        }
        Insert: {
          id?: string
          employee_id: string
          device_fingerprint: string
          user_agent?: string | null
          device_name?: string | null
          registered_at?: string
          is_active?: boolean
          approved_by?: string | null
          approved_at?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          device_fingerprint?: string
          user_agent?: string | null
          device_name?: string | null
          registered_at?: string
          is_active?: boolean
          approved_by?: string | null
          approved_at?: string | null
        }
        Relationships: []
      }
      attendance_anomalies: {
        Row: {
          id: string
          clock_event_id: string
          employee_id: string
          anomaly_type: AnomalyType
          severity: AnomalySeverity
          details: Record<string, unknown>
          resolved: boolean
          resolved_by: string | null
          resolved_at: string | null
          resolution_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          clock_event_id: string
          employee_id: string
          anomaly_type: AnomalyType
          severity: AnomalySeverity
          details?: Record<string, unknown>
          resolved?: boolean
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          clock_event_id?: string
          employee_id?: string
          anomaly_type?: AnomalyType
          severity?: AnomalySeverity
          details?: Record<string, unknown>
          resolved?: boolean
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      attendance_corrections: {
        Row: {
          id: string
          employee_id: string
          original_event_id: string | null
          correction_type: CorrectionType
          old_value: Record<string, unknown> | null
          new_value: Record<string, unknown>
          reason: string
          requested_by: string
          approved_by: string | null
          approved_at: string | null
          status: CorrectionStatus
          rejection_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          original_event_id?: string | null
          correction_type: CorrectionType
          old_value?: Record<string, unknown> | null
          new_value: Record<string, unknown>
          reason: string
          requested_by: string
          approved_by?: string | null
          approved_at?: string | null
          status?: CorrectionStatus
          rejection_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          original_event_id?: string | null
          correction_type?: CorrectionType
          old_value?: Record<string, unknown> | null
          new_value?: Record<string, unknown>
          reason?: string
          requested_by?: string
          approved_by?: string | null
          approved_at?: string | null
          status?: CorrectionStatus
          rejection_reason?: string | null
          created_at?: string
        }
        Relationships: []
      }
      production_outputs: {
        Row: {
          id: number
          production_order_id: number
          stock_item_id: number | null
          output_name: string
          qty_produced: number
          theoretical_qty: number | null
          unit: string
          is_waste: boolean
          notes: string | null
          stock_movement_id: number | null
          created_at: string
        }
        Insert: {
          id?: number
          production_order_id: number
          stock_item_id?: number | null
          output_name: string
          qty_produced: number
          theoretical_qty?: number | null
          unit: string
          is_waste?: boolean
          notes?: string | null
          stock_movement_id?: number | null
          created_at?: string
        }
        Update: {
          id?: number
          production_order_id?: number
          stock_item_id?: number | null
          output_name?: string
          qty_produced?: number
          theoretical_qty?: number | null
          unit?: string
          is_waste?: boolean
          notes?: string | null
          stock_movement_id?: number | null
          created_at?: string
      wifi_access_points: {
        Row: {
          id: string
          name: string
          bssid: string | null
          ssid: string | null
          location_description: string | null
          is_active: boolean
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          name: string
          bssid?: string | null
          ssid?: string | null
          location_description?: string | null
          is_active?: boolean
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          bssid?: string | null
          ssid?: string | null
          location_description?: string | null
          is_active?: boolean
          created_at?: string
          created_by?: string | null
        }
        Relationships: []
      }
      attendance_config: {
        Row: {
          key: string
          value: Record<string, unknown>
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          value: Record<string, unknown>
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          key?: string
          value?: Record<string, unknown>
          updated_at?: string
          updated_by?: string | null
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
      stock_availability: {
        Args: {
          p_recipe_id: number
        }
        Returns: Record<string, unknown>
      }
      stock_duration: {
        Args: {
          p_stock_item_id: number
          p_days_lookback?: number
        }
        Returns: Record<string, unknown>
      }
      recipes_at_risk: {
        Args: {
          p_min_portions_threshold?: number
        }
        Returns: {
          recipe_id: number
          recipe_name: string
          available_portions: number
          limiting_ingredient: string | null
          limiting_item_id: number | null
          status: string
        }[]
      }
      complete_production_order: {
        Args: { p_order_id: number; p_user_id: string }
        Returns: Record<string, unknown>
      }
      production_dashboard: {
        Args: { p_days?: number }
        Returns: Record<string, unknown>
      clock_in_secure: {
        Args: {
          p_photo_url?: string | null
          p_geo_lat?: number | null
          p_geo_lng?: number | null
          p_geo_accuracy?: number | null
          p_wifi_ssid?: string | null
          p_device_id?: string | null
          p_device_info?: Record<string, unknown> | null
          p_ip_address?: string | null
          p_notes?: string | null
        }
        Returns: Record<string, unknown>
      }
      clock_out_secure: {
        Args: {
          p_photo_url?: string | null
          p_geo_lat?: number | null
          p_geo_lng?: number | null
          p_geo_accuracy?: number | null
          p_wifi_ssid?: string | null
          p_device_id?: string | null
          p_device_info?: Record<string, unknown> | null
          p_ip_address?: string | null
          p_notes?: string | null
        }
        Returns: Record<string, unknown>
      }
      get_suspicious_attendance: {
        Args: {
          p_from_date?: string
          p_to_date?: string
        }
        Returns: {
          log_id: string
          user_id: string
          first_name: string
          last_name: string
          role: string
          operative_date: string
          clock_in_at: string
          clock_out_at: string | null
          hours_worked: number | null
          suspicious_reasons: string[]
          geo_verified: boolean
          geo_distance_m: number | null
          wifi_verified: boolean
          wifi_ssid: string | null
          clock_in_photo_url: string | null
          clock_out_photo_url: string | null
          device_id: string | null
          status: string
        }[]
      }
      calculate_employee_hours: {
        Args: {
          p_employee_id: string
          p_from: string
          p_to: string
        }
        Returns: {
          total_hours: number
          normal_hours: number
          nocturnal_hours: number
          extra_hours: number
          days_worked: number
        }[]
      }
      attendance_dashboard: {
        Args: {
          p_from: string
          p_to: string
        }
        Returns: {
          employee_id: string
          first_name: string
          last_name: string
          role: string
          is_currently_in: boolean
          last_event_time: string | null
          days_worked: number
          total_hours: number
          open_anomalies: number
        }[]
      }
      get_current_attendance_status: {
        Args: { p_employee_id: string }
        Returns: {
          status: string
          last_event_id: string | null
          last_event_type: string | null
          last_event_time: string | null
        }[]
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

export type RecipeIngredientPendingLink = Database['public']['Tables']['recipe_ingredient_pending_links']['Row']
export type RecipeIngredientPendingLinkInsert = Database['public']['Tables']['recipe_ingredient_pending_links']['Insert']
export type RecipeIngredientPendingLinkUpdate = Database['public']['Tables']['recipe_ingredient_pending_links']['Update']

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

// ---------------------------------------------------------------------------
// RPC return types (stock availability + duration calculations)
// ---------------------------------------------------------------------------

export type StockAvailabilityIngredient = {
  stock_item_id: number
  name: string
  current_qty: number
  qty_per_portion: number
  unit: string
  available_portions: number
  is_limiting: boolean
}

export type StockAvailabilityResult = {
  success: boolean
  recipe_id: number
  recipe_name: string
  available_portions: number
  limiting_ingredient: string | null
  limiting_ingredient_id: number | null
  ingredients_count: number
  ingredients: StockAvailabilityIngredient[]
  warning?: string
  error?: string
}

export type StockDurationResult = {
  success: boolean
  stock_item_id: number
  name: string
  current_qty: number
  unit: string
  days_lookback: number
  total_consumed: number
  daily_avg_consumption: number
  days_remaining: number | null
  semaphore: 'critico' | 'bajo' | 'atención' | 'ok' | 'sin_historial'
  note: string | null
  error?: string
}

export type RecipeAtRisk = {
  recipe_id: number
  recipe_name: string
  available_portions: number
  limiting_ingredient: string | null
  limiting_item_id: number | null
  status: 'sin_stock' | 'bajo' | 'ok'
}

export type RecipeStockStatus = {
  recipe_id: number
  recipe_name: string
  recipe_slug: string | null
  portion_yield: number
  cost_per_portion: number
  cost_per_batch: number
  linked_ingredients_count: number
  out_of_stock_count: number
  critical_stock_count: number
}

// ---------------------------------------------------------------------------
// Production system types
// ---------------------------------------------------------------------------

export type ProductionTemplate = Database['public']['Tables']['production_templates']['Row']
export type ProductionTemplateInsert = Database['public']['Tables']['production_templates']['Insert']
export type ProductionTemplateUpdate = Database['public']['Tables']['production_templates']['Update']

export type ProductionTemplateOutput = Database['public']['Tables']['production_template_outputs']['Row']
export type ProductionTemplateOutputInsert = Database['public']['Tables']['production_template_outputs']['Insert']
export type ProductionTemplateOutputUpdate = Database['public']['Tables']['production_template_outputs']['Update']

export type ProductionOrder = Database['public']['Tables']['production_orders']['Row']
export type ProductionOrderInsert = Database['public']['Tables']['production_orders']['Insert']
export type ProductionOrderUpdate = Database['public']['Tables']['production_orders']['Update']

export type ProductionInput = Database['public']['Tables']['production_inputs']['Row']
export type ProductionInputInsert = Database['public']['Tables']['production_inputs']['Insert']
export type ProductionInputUpdate = Database['public']['Tables']['production_inputs']['Update']

export type ProductionOutput = Database['public']['Tables']['production_outputs']['Row']
export type ProductionOutputInsert = Database['public']['Tables']['production_outputs']['Insert']
export type ProductionOutputUpdate = Database['public']['Tables']['production_outputs']['Update']

export type ProductionOrderStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled'

// Full order with nested inputs + outputs (returned by GET /api/produccion/orders/[id])
export type ProductionOrderDetail = ProductionOrder & {
  chef_name: string | null
  template_name: string | null
  inputs: (ProductionInput & { stock_item_name: string; stock_item_unit: string })[]
  outputs: (ProductionOutput & { stock_item_name: string | null })[]
  child_orders: Pick<ProductionOrder, 'id' | 'name' | 'status' | 'completed_at'>[]
  summary: {
    total_input_qty: number
    total_output_qty: number
    total_waste_qty: number
    efficiency_pct: number | null
  }
}

// Dashboard RPC result
export type ProductionDashboard = {
  period_days: number
  total_completed: number
  total_input_kg: number | null
  total_waste_kg: number | null
  avg_efficiency_pct: number | null
  pending_orders: number
  by_chef: {
    chef_id: string | null
    chef_name: string
    total_orders: number
    avg_efficiency: number | null
    total_waste: number
  }[]
  daily: {
    day: string
    orders: number
    avg_efficiency: number | null
  }[]
}

// Summary row from v_production_summary view
export type ProductionSummaryRow = {
  id: number
  name: string
  status: ProductionOrderStatus
  parent_order_id: number | null
  template_id: number | null
  chef_id: string | null
  notes: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  chef_name: string | null
  chef_role: string | null
  template_name: string | null
  total_input_qty: number
  total_output_qty: number
  total_waste_qty: number
  efficiency_pct: number | null
  child_orders_count: number
// Attendance Anti-Fraud System types
// ---------------------------------------------------------------------------

export type AttendanceStatus = 'clocked_in' | 'clocked_out' | 'no_record'

export type ClockEvent = {
  id: string
  employee_id: string
  event_type: ClockEventType
  timestamp: string
  wifi_bssid: string | null
  wifi_ssid: string | null
  gps_lat: number | null
  gps_lng: number | null
  gps_accuracy: number | null
  selfie_url: string | null
  device_fingerprint: string | null
  user_agent: string | null
  ip_address: string | null
  verified: boolean
  anomaly_flags: AnomalyFlag[]
  created_at: string
}

export type DeviceRegistration = {
  id: string
  employee_id: string
  device_fingerprint: string
  user_agent: string | null
  device_name: string | null
  registered_at: string
  is_active: boolean
  approved_by: string | null
  approved_at: string | null
}

export type AttendanceAnomaly = {
  id: string
  clock_event_id: string
  employee_id: string
  anomaly_type: AnomalyType
  severity: AnomalySeverity
  details: Record<string, unknown>
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  resolution_notes: string | null
  created_at: string
}

export type AttendanceCorrection = {
  id: string
  employee_id: string
  original_event_id: string | null
  correction_type: CorrectionType
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown>
  reason: string
  requested_by: string
  approved_by: string | null
  approved_at: string | null
  status: CorrectionStatus
  rejection_reason: string | null
  created_at: string
}

export type WifiAccessPoint = {
  id: string
  name: string
  bssid: string | null
  ssid: string | null
  location_description: string | null
  is_active: boolean
  created_at: string
  created_by: string | null
}

export type AttendanceConfig = {
  key: string
  value: Record<string, unknown>
  updated_at: string
  updated_by: string | null
}

export type EmployeeHours = {
  total_hours: number
  normal_hours: number
  nocturnal_hours: number
  extra_hours: number
  days_worked: number
}

export type AttendanceDashboardRow = {
  employee_id: string
  first_name: string
  last_name: string
  role: string
  is_currently_in: boolean
  last_event_time: string | null
  days_worked: number
  total_hours: number
  open_anomalies: number
}

// ---------------------------------------------------------------------------
// Stock Reconciliation
// ---------------------------------------------------------------------------

export type StockReconciliationRow = {
  stock_item_id: string
  name: string
  unit: string
  opening_qty: number
  received: number
  prod_in: number
  prod_out: number
  sales: number
  waste: number
  manual_adj: number
  expected_closing: number
  actual_closing: number
  variance: number
}

export type MenuItemReconciliationRow = {
  menu_item_id: string
  menu_item_name: string
  recipe_id: string
  recipe_name: string | null
  qty_produced: number
  qty_sold: number
  expected_remaining: number
}
