// Summary view: reconstructs "what happened" from the loaded sessions as 10–20 work
// items and shows where the effort went (per project). Altitude follows the log rule
// in lib/summary.ts: a dominant project gets inside detail, otherwise projects stay
// as one-liners.

import { useMemo, useState } from 'react'
import { useKarin } from '../store/karin'
import { buildSummary, type SummaryRange } from '../lib/summary'
import { fmtCompact, fmtDuration } from '../lib/format'
import { cn } from '../lib/cn'

const RANGES: Array<{ key: SummaryRange; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: 'all', label: 'All' },
]

// Fixed palette for project segments (effort-desc order), neutral-friendly.
const COLORS = ['#2563eb', '#ea580c', '#059669', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#64748b']

export default function SummaryPage() {
  const sessions = useKarin((s) => s.sessions)
  const [range, setRange] = useState<SummaryRange>('today')

  // `sessions` identity changes only on data refresh, so the summary recomputes rarely.
  const data = useMemo(() => buildSummary(sessions, range, Date.now()), [sessions, range])
  const topProjects = data.projects.slice(0, COLORS.length - 1)
  const restShare = 1 - topProjects.reduce((sum, p) => sum + p.share, 0)

  return (
    <div className="flex h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <h1 className="text-sm font-semibold">Summary</h1>
        <div className="inline-flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={cn(
                'px-2 py-1 text-xs',
                range === r.key
                  ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900'
                  : 'bg-white text-neutral-600 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {data.sessionCount} sessions · {fmtCompact(data.totalTokens)} tok · {fmtDuration(data.totalWallMs)} wall
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {data.sessionCount === 0 ? (
            <p className="mt-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No sessions in this range.
            </p>
          ) : (
            <>
              {/* Where the effort went — stacked share bar + per-project legend. */}
              <section>
                <h2 className="mb-1.5 text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  Where effort went
                </h2>
                <div className="flex h-3 w-full overflow-hidden rounded-sm">
                  {topProjects.map((p, i) => (
                    <div
                      key={p.name}
                      title={`${p.name} — ${Math.round(p.share * 100)}%`}
                      style={{ width: `${p.share * 100}%`, backgroundColor: COLORS[i] }}
                    />
                  ))}
                  {restShare > 0.001 && (
                    <div style={{ width: `${restShare * 100}%`, backgroundColor: COLORS[COLORS.length - 1] }} />
                  )}
                </div>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {topProjects.map((p, i) => (
                    <li key={p.name} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: COLORS[i] }} />
                      <span className="font-medium">{p.name}</span>
                      <span className="text-neutral-500 dark:text-neutral-400">
                        {Math.round(p.share * 100)}% · {fmtCompact(p.tokens)} tok · {fmtDuration(p.wallMs)} ·{' '}
                        {p.sessions.length} sessions
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[0.68rem] text-neutral-400 dark:text-neutral-500">
                  {data.dominant
                    ? `Mostly ${data.dominant} — its items are specified below; other projects stay grouped.`
                    : 'Effort is spread across projects — items stay at project level.'}
                </p>
              </section>

              {/* The 10–20 reconstructed work items. */}
              <section>
                <h2 className="mb-1.5 text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  What happened
                </h2>
                <ol className="flex flex-col gap-1">
                  {data.items.map((item, i) => (
                    <li
                      key={`${item.project}-${i}`}
                      className="flex items-baseline gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                    >
                      <span className="w-5 shrink-0 text-right text-xs text-neutral-400 tabular-nums dark:text-neutral-500">
                        {i + 1}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-sm px-1 py-px text-[0.68rem]',
                          item.kind === 'detail'
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                            : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
                        )}
                      >
                        {item.project}
                      </span>
                      <span className="min-w-0 flex-1">{item.text}</span>
                      <span className="shrink-0 text-[0.68rem] text-neutral-400 tabular-nums dark:text-neutral-500">
                        {item.sessions > 1 ? `${item.sessions}s · ` : ''}
                        {fmtCompact(item.tokens)} · {fmtDuration(item.wallMs)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
