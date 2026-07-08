import { cn } from '../lib/cn'
import type { TurnState } from '../lib/turnState'

// A small status dot for a session's TURN STATE (see lib/turnState.ts) — reads the AI's
// own stop signal from the last record, not recency, so it never fakes liveness. Amber =
// still mid-turn, gray = idle awaiting you, rose = cut off. "As of last index" (paired
// with the row's "Xm ago").
const CONFIG: Record<TurnState, { cls: string; title: string } | null> = {
  working: {
    cls: 'bg-amber-500 animate-pulse shadow-[0_0_0_2px_rgba(245,158,11,0.25)]',
    title: 'Working — the AI’s turn isn’t closed (tool call pending or your prompt unanswered), as of the last index',
  },
  waiting: {
    cls: 'bg-neutral-300 dark:bg-neutral-600',
    title: 'Waiting on you — the AI finished its turn (end_turn), as of the last index',
  },
  interrupted: {
    cls: 'bg-rose-500',
    title: 'Interrupted — the last response was cut off (max tokens), as of the last index',
  },
  unknown: null,
}

export default function TurnDot({ state, className }: { state: TurnState; className?: string }) {
  const c = CONFIG[state]
  if (!c) return <span className={cn('h-2 w-2 shrink-0 rounded-full ring-1 ring-neutral-200 dark:ring-neutral-700', className)} title="Turn state unknown" />
  return <span aria-label={state} title={c.title} className={cn('h-2 w-2 shrink-0 rounded-full', c.cls, className)} />
}
