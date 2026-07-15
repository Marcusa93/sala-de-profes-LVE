import type { Supplier, StockItem } from '@/types/database'

export type { Supplier }

export type SupplierFormData = {
  name: string
  category: string
  contact_name: string
  phone: string
  email: string
  notes: string
}

export const EMPTY_FORM: SupplierFormData = {
  name: '',
  category: '',
  contact_name: '',
  phone: '',
  email: '',
  notes: '',
}

export type LowStockItem = Pick<StockItem, 'id' | 'name' | 'current_qty' | 'min_qty' | 'unit' | 'supplier_id' | 'category'>
