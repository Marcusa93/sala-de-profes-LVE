import { PRIORITIES, type Priority } from '@/lib/constants'

type PriorityBadgeProps = {
  priority: string
}

const PRIORITY_STYLES: Record<Priority, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
  high: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' },
  medium: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400' },
  low: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const key = priority as Priority
  const config = PRIORITIES[key]
  const style = PRIORITY_STYLES[key]

  if (!config || !style) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {priority}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {config.label}
    </span>
  )
}
