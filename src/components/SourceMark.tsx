import type { SessionSource } from '../types'
import type { TurnState } from '../lib/turnState'
import { cn } from '../lib/cn'

const LABELS: Record<SessionSource, string> = {
  codex: 'OpenAI Codex',
  claude: 'Anthropic Claude',
  warp: 'Warp',
}

const STATE_LABELS: Record<TurnState, string> = {
  working: 'working',
  waiting: 'waiting on you',
  interrupted: 'interrupted',
  unknown: 'activity unknown',
}

// One activity marker per session: the source mark carries the company identity while
// the title keeps the turn-state detail available without a second colored dot.
export default function SourceMark({ source, state, className }: { source: SessionSource; state: TurnState; className?: string }) {
  const stateClass = state === 'working' ? 'animate-pulse' : state === 'interrupted' ? 'opacity-60' : ''
  const title = `${LABELS[source]} · ${STATE_LABELS[state]}`

  return (
    <span aria-label={title} title={title} className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center', stateClass, className)}>
      {source === 'codex' ? (
        <svg viewBox="0 0 24 24" className="h-full w-full text-neutral-800 dark:text-neutral-200" aria-hidden="true">
          <path d="M12 2.5 15 5l3.8-.4.4 3.8 3 2.5-3 2.5-.4 3.8L15 17l-3 4.5L9 17l-3.8.2-.4-3.8-3-2.5 3-2.5.4-3.8L9 5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="2.2" fill="currentColor" />
        </svg>
      ) : source === 'claude' ? (
        <svg viewBox="0 0 24 24" className="h-full w-full text-orange-500" aria-hidden="true">
          <path d="m12 1.7 2.1 6.4 6-4.1-4.1 6 6.3 2-6.3 2 4.1 6-6-4.1-2.1 6.4-2.1-6.4-6 4.1 4.1-6-6.3-2 6.3-2-4.1-6 6 4.1z" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-full w-full text-violet-500" aria-hidden="true">
          <path d="M3.5 5.5 6.8 18.5 12 10l5.2 8.5 3.3-13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}
