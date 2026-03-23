import type { PriorityValue } from '@/types/database'

const PRIORITY_STYLES: Record<PriorityValue, { dot: string; text: string; label: string }> = {
  baja:    { dot: 'bg-[#006d5a]', text: 'text-[#006d5a]', label: 'Baja' },
  media:   { dot: 'bg-[#d4943a]', text: 'text-[#9a6d28]', label: 'Media' },
  alta:    { dot: 'bg-[#ea504c]', text: 'text-[#c42b28]', label: 'Alta' },
  critica: { dot: 'bg-[#c42b28]', text: 'text-[#c42b28]', label: 'Crítica' },
}

export function PriorityBadge({ priority }: { priority: PriorityValue }) {
  const style = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.baja

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold ${style.text}`}
    >
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  )
}
