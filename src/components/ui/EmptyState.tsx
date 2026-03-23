import type { LucideIcon } from 'lucide-react'
import { Coffee } from 'lucide-react'

type EmptyStateProps = {
  icon?: LucideIcon
  title: string
  description?: string
}

export function EmptyState({
  icon: Icon = Coffee,
  title,
  description,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary">
        <Icon className="size-7 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-2 max-w-[260px] text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}
