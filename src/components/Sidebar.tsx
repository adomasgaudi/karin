import { useState } from 'react'
import * as Switch from '@radix-ui/react-switch'
import { Moon, Search, Sun, Upload } from 'lucide-react'
import { useKarin } from '../store/karin'
import { fmtCompact, sessionMatches, tokensLabel } from '../lib/format'
import { cn } from '../lib/cn'
import { APP_VERSION } from '../lib/appVersion'
import { UNIT_MODE_LABELS, ratesForSession, usageUnitTotal, type UsageUnitMode } from '../lib/pricing'
import AgeIndicator, { useLiveNow } from './AgeIndicator'
import DateStamp from './DateStamp'
import UsageBar from './UsageBar'

interface SidebarProps {
  className?: string
}

const unitModes: UsageUnitMode[] = ['tokens', 'token_units']

export default function Sidebar({ className }: SidebarProps) {
  const data = useKarin((s) => s.data)
  const selectedId = useKarin((s) => s.selectedId)
  const search = useKarin((s) => s.search)
  const setSearch = useKarin((s) => s.setSearch)
  const theme = useKarin((s) => s.theme)
  const toggleTheme = useKarin((s) => s.toggleTheme)
  const now = useLiveNow()
  const [unitMode, setUnitMode] = useState<UsageUnitMode>('tokens')

  if (!data) return null

  const list = data.sessions.filter((s) => sessionMatches(s, search))
  // Each session's bar is drawn against the largest session's total (in the active unit),
  // so every session's input/cached/output bar is proportional to all the others.
  const rows = list.map((s) => {
    const rates = ratesForSession(s)
    return { session: s, rates, unitTotal: usageUnitTotal(s.latest_total_usage, rates, unitMode) }
  })
  const scaleMax = Math.max(0, ...rows.map((r) => r.unitTotal))
  // Newest prompt across all sessions — "minutes since last prompt" for the header.
  const latestPrompt = data.sessions.reduce<string | null>(
    (max, s) => (s.updated_at && (!max || s.updated_at > max) ? s.updated_at : max),
    null,
  )

  return (
    <aside
      className={cn(
        'flex h-dvh w-full min-w-0 flex-col border-r border-neutral-200 bg-white md:w-[clamp(300px,30vw,430px)] dark:border-neutral-800 dark:bg-neutral-950',
        className,
      )}
    >
      <div className="shrink-0 border-b border-neutral-200/80 px-3 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">Karin</span>
              <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">{APP_VERSION}</span>
            </div>
            <AgeIndicator value={latestPrompt} now={now} className="mt-0.5 text-base" />
            <p className="text-[0.68rem] text-neutral-400 dark:text-neutral-500">
              {data.session_count} sessions / generated <DateStamp value={data.generated_at} />
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => useKarin.getState().reset()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Upload className="h-3.5 w-3.5" />
              Load
            </button>
            <div className="flex items-center gap-1.5">
              <Sun className="h-3.5 w-3.5 text-neutral-400" />
              <Switch.Root
                aria-label="Toggle dark mode"
                checked={theme === 'dark'}
                onCheckedChange={() => toggleTheme()}
                className="relative h-5 w-9 rounded-md bg-neutral-200 outline-none data-[state=checked]:bg-neutral-700 dark:bg-neutral-800 dark:data-[state=checked]:bg-neutral-200"
              >
                <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-sm bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px] dark:bg-neutral-950" />
              </Switch.Root>
              <Moon className="h-3.5 w-3.5 text-neutral-400" />
            </div>
          </div>
        </div>

        <label className="mt-3 flex h-9 items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 text-sm text-neutral-500 focus-within:border-neutral-400 focus-within:bg-white dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-600 dark:focus-within:bg-neutral-950">
          <Search className="h-4 w-4 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions, prompts, tools"
            className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
        </label>

        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[0.68rem] text-neutral-400 dark:text-neutral-500">bars</span>
          <div className="inline-flex max-w-full overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
            {unitModes.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setUnitMode(mode)}
                className={cn(
                  'shrink-0 rounded-sm px-2 py-0.5 text-[0.68rem]',
                  unitMode === mode
                    ? 'bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-50'
                    : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100',
                )}
              >
                {UNIT_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {list.length === 0 ? (
          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No sessions match.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map(({ session: s, rates }) => {
              const selected = s.id === selectedId
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => useKarin.getState().select(s.id)}
                    className={cn(
                      'grid w-full gap-1 rounded-md border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'border-neutral-300 bg-neutral-100 shadow-sm dark:border-neutral-700 dark:bg-neutral-900'
                        : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-900',
                    )}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 truncate text-sm font-medium text-neutral-950 dark:text-neutral-50">
                        {s.title || s.id}
                      </div>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      <span className="truncate">
                        <DateStamp value={s.updated_at} /> / {tokensLabel(s)}
                      </span>
                      <span>{fmtCompact(s.latest_total_usage?.cached_input_tokens)} cached</span>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-1 text-[0.68rem] text-neutral-500 dark:text-neutral-500">
                      <span>{s.counts.user} user</span>
                      <span>{s.counts.assistant} assistant</span>
                      <span>{s.counts.tool_calls} tools</span>
                      <span>{s.counts.code_edits} edits</span>
                    </div>
                    <UsageBar
                      usage={s.latest_total_usage || {}}
                      rates={rates}
                      mode={unitMode}
                      compact
                      showLegend={false}
                      scaleMax={scaleMax}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
