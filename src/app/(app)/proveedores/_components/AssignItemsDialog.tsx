'use client'

import { Search, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { getSemaphore } from '@/components/stock/StockSemaphoreBadge'
import type { Supplier, LowStockItem } from './types'

type Props = {
  open: boolean
  onClose: (open: boolean) => void
  supplier: Supplier | null
  items: LowStockItem[]
  selectedItems: Set<number>
  onToggle: (id: number) => void
  onSelectAllCategory: (category: string) => void
  onSave: () => void
  assigning: boolean
  filter: string
  onFilter: (f: string) => void
}

export function AssignItemsDialog({ open, onClose, supplier, items, selectedItems, onToggle, onSelectAllCategory, onSave, assigning, filter, onFilter }: Props) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[80vh] flex-col rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg text-[#3d2c24]">Vincular productos</DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            Selecciona los productos que provee{' '}
            <span className="font-medium text-[#3d2c24]">{supplier?.name}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
          <Input
            placeholder="Buscar producto..."
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            className="h-9 rounded-xl border-[#ebe6df] bg-[#faf8f5] pl-9 text-xs text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
          />
        </div>

        {/* Category quick-select */}
        <div className="flex flex-wrap gap-1.5">
          {[...new Set(items.map((i) => i.category))].map((cat) => {
            const catItems = items.filter((i) => i.category === cat)
            const allSelected = catItems.every((i) => selectedItems.has(i.id))
            return (
              <button
                key={cat}
                onClick={() => onSelectAllCategory(cat ?? 'otros')}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all ${
                  allSelected ? 'bg-[#006d5a] text-white' : 'bg-[#f0f7f5] text-[#006d5a] hover:bg-[#e0efe9]'
                }`}
              >
                {cat ?? 'otros'} ({catItems.length})
              </button>
            )
          })}
        </div>

        <div className="-mx-1 max-h-[40vh] flex-1 space-y-0.5 overflow-y-auto px-1">
          {items.map((item) => {
            const isSelected = selectedItems.has(item.id)
            const sem = getSemaphore(item.current_qty, item.min_qty)
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all ${
                  isSelected ? 'bg-[#f0f7f5] ring-1 ring-[#006d5a]/20' : 'hover:bg-[#faf8f5]'
                }`}
              >
                <div className={`flex size-4 shrink-0 items-center justify-center rounded border transition-all ${
                  isSelected ? 'border-[#006d5a] bg-[#006d5a]' : 'border-[#ebe6df]'
                }`}>
                  {isSelected && (
                    <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[#3d2c24]">{item.name}</p>
                  <p className="text-[10px] text-[#a39e97]">{item.category}</p>
                </div>
                {sem !== 'green' && (
                  <div className={`size-1.5 shrink-0 rounded-full ${sem === 'red' ? 'bg-[#ea504c]' : 'bg-[#d4943a]'}`} />
                )}
              </button>
            )
          })}
          {items.length === 0 && (
            <p className="py-8 text-center text-xs text-[#a39e97]">No hay productos disponibles</p>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between border-t border-[#ebe6df] pt-3">
          <p className="text-xs text-[#a39e97]">{selectedItems.size} seleccionados</p>
          <div className="flex gap-2">
            <DialogClose render={<Button variant="outline" className="h-9 rounded-xl border-[#ebe6df] text-xs text-[#3d2c24] hover:bg-[#faf8f5]" />}>
              Cancelar
            </DialogClose>
            <Button onClick={onSave} disabled={assigning} className="h-9 rounded-xl bg-[#006d5a] text-xs text-white hover:bg-[#004d3f]">
              {assigning && <Loader2 className="size-3.5 animate-spin" />}
              Guardar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
