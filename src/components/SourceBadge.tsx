import type { SessionSource } from '../types'
import { cn } from '../lib/cn'

// Tiny per-row pill marking whether a session came from Codex or Claude. Muted, theme-aware.
const STYLES: Record<SessionSource, string> = {
  codex: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  claude: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
}

const LABELS: Record<SessionSource, string> = { codex: 'Codex', claude: 'Claude' }

export default function SourceBadge({ source, className }: { source: SessionSource; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide leading-none',
        STYLES[source],
        className,
      )}
    >
      {LABELS[source]}
    </span>
  )
}
