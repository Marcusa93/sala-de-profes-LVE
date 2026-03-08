import { cn } from '@/lib/utils'

type SemaphoreValue = 'green' | 'yellow' | 'red'

type StockSemaphoreBadgeProps = {
  semaphore: SemaphoreValue
  className?: string
}

const CONFIG: Record<SemaphoreValue, { label: string; dotColor: string; textColor: string; bgColor: string }> = {
  green: {
    label: 'Normal',
    dotColor: 'bg-green-500',
    textColor: 'text-green-700 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-950/30',
  },
  yellow: {
    label: 'Atencion',
    dotColor: 'bg-yellow-500',
    textColor: 'text-yellow-700 dark:text-yellow-400',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/30',
  },
  red: {
    label: 'Critico',
    dotColor: 'bg-red-500',
    textColor: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
  },
}

export function StockSemaphoreBadge({ semaphore, className }: StockSemaphoreBadgeProps) {
  const { label, dotColor, textColor, bgColor } = CONFIG[semaphore]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        bgColor,
        textColor,
        className,
      )}
    >
      <span className={cn('size-2 rounded-full', dotColor)} />
      {label}
    </span>
  )
}

export function getSemaphore(currentQty: number, minQty: number): SemaphoreValue {
  if (currentQty <= 0) return 'red'
  if (currentQty <= minQty) return 'red'
  if (currentQty <= minQty * 1.5) return 'yellow'
  return 'green'
}
