import { useKarin, type SourceFilter as SourceFilterValue } from '../store/karin'
import { cn } from '../lib/cn'

// One pill that cycles All → Codex → Claude → Warp. Four side-by-side buttons cost four
// times the width for a filter that only ever holds one value.
const order: { id: SourceFilterValue; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'warp', label: 'Warp' },
]

export default function SourceCycle({ className }: { className?: string }) {
  const sourceFilter = useKarin((s) => s.sourceFilter)
  const setSourceFilter = useKarin((s) => s.setSourceFilter)
  const i = Math.max(0, order.findIndex((o) => o.id === sourceFilter))
  const next = order[(i + 1) % order.length]
  return (
    <button
      type="button"
      onClick={() => setSourceFilter(next.id)}
      title={`Source filter: ${order[i].label} — click for ${next.label}`}
      className={cn(
        'shrink-0 rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[0.65rem] font-medium text-neutral-800 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800',
        className,
      )}
    >
      {order[i].label}
    </button>
  )
}
