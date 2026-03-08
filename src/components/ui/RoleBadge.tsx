import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'

type RoleBadgeProps = {
  role: AppRole
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const config = ROLES[role]

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${config.color}18`,
        color: config.color,
      }}
    >
      <span>{config.emoji}</span>
      {config.label}
    </span>
  )
}
