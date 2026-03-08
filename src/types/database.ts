export type AppRole = 'encargado' | 'chef' | 'barista' | 'runner' | 'cocina'

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
          type: string
          priority: string
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
          type?: string
          priority?: string
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
          type?: string
          priority?: string
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
          id: string
          name: string
          category: string
          contact_name: string | null
          phone: string | null
          email: string | null
          notes: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          category: string
          contact_name?: string | null
          phone?: string | null
          email?: string | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          category?: string
          contact_name?: string | null
          phone?: string | null
          email?: string | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          id: string
          name: string
          category: string
          unit: string
          current_qty: number
          min_qty: number
          next_purchase_date: string | null
          supplier_id: string | null
          notes: string | null
          semaphore: 'green' | 'yellow' | 'red'
          last_ordered_at: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          category: string
          unit: string
          current_qty?: number
          min_qty?: number
          next_purchase_date?: string | null
          supplier_id?: string | null
          notes?: string | null
          semaphore?: 'green' | 'yellow' | 'red'
          last_ordered_at?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          category?: string
          unit?: string
          current_qty?: number
          min_qty?: number
          next_purchase_date?: string | null
          supplier_id?: string | null
          notes?: string | null
          semaphore?: 'green' | 'yellow' | 'red'
          last_ordered_at?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_alerts: {
        Row: {
          id: string
          stock_item_id: string
          alert_type: string
          priority: string
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
          alert_type: string
          priority?: string
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
          alert_type?: string
          priority?: string
          message?: string
          status?: 'active' | 'resolved' | 'snoozed'
          triggered_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
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
    }
    Enums: {
      app_role: AppRole
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience type aliases
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

export type AuditLog = Database['public']['Tables']['audit_log']['Row']
