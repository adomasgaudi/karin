import { useKarin, type SourceFilter as SourceFilterValue } from '../store/karin'
import { cn } from '../lib/cn'

const options: { id: SourceFilterValue; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
]

// Segmented All / Codex / Claude filter for the combined session list — same pill
// vocabulary as the old Codex|Claude page switch, but now it narrows one shared list
// instead of swapping between two separate pages.
export default function SourceFilter({ className }: { className?: string }) {
  const sourceFilter = useKarin((s) => s.sourceFilter)
  const setSourceFilter = useKarin((s) => s.setSourceFilter)
  return (
    <div
      className={cn(
        'inline-flex max-w-full overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900',
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setSourceFilter(o.id)}
          className={cn(
            'shrink-0 rounded-sm px-2 py-0.5 text-[0.68rem]',
            sourceFilter === o.id
              ? 'bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-50'
              : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
