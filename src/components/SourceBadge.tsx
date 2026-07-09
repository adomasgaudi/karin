import type { SessionSource } from '../types'
import { cn } from '../lib/cn'

// Tiny per-row pill marking which agent a session came from. Muted, theme-aware.
const STYLES: Record<SessionSource, string> = {
  codex: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  claude: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  warp: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
}

const LABELS: Record<SessionSource, string> = { codex: 'Codex', claude: 'Claude', warp: 'Warp' }

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
