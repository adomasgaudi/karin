import * as Switch from '@radix-ui/react-switch'
import { Upload, Sun, Moon } from 'lucide-react'
import { useKarin } from '../store/karin'
import { fmtDate, tokensLabel, sessionMatches } from '../lib/format'
import { cn } from '../lib/cn'

interface SidebarProps {
  className?: string
}

export default function Sidebar({ className }: SidebarProps) {
  const data = useKarin((s) => s.data)
  const selectedId = useKarin((s) => s.selectedId)
  const search = useKarin((s) => s.search)
  const setSearch = useKarin((s) => s.setSearch)
  const theme = useKarin((s) => s.theme)
  const toggleTheme = useKarin((s) => s.toggleTheme)

  if (!data) return null

  const list = data.sessions.filter((s) => sessionMatches(s, search))

  return (
    <aside
      className={cn(
        'flex h-dvh w-full min-w-0 flex-col border-r border-neutral-200 bg-white md:w-[clamp(280px,32vw,420px)] dark:border-neutral-800 dark:bg-neutral-900',
        className,
      )}
    >
      <div className="shrink-0 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-bold tracking-tight text-teal-700 dark:text-teal-400">Karin</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => useKarin.getState().reset()}
              className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Upload className="h-3.5 w-3.5" />
              Load file
            </button>
            <div className="flex items-center gap-1.5">
              <Sun className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
              <Switch.Root
                aria-label="Toggle dark mode"
                checked={theme === 'dark'}
                onCheckedChange={() => toggleTheme()}
                className="relative h-5 w-9 rounded-md bg-neutral-200 outline-none data-[state=checked]:bg-teal-600 dark:bg-neutral-700 dark:data-[state=checked]:bg-teal-500"
              >
                <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-md bg-white transition-transform data-[state=checked]:translate-x-[18px]" />
              </Switch.Root>
              <Moon className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
            </div>
          </div>
        </div>

        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {`${data.session_count} sessions · generated ${fmtDate(data.generated_at)}`}
        </p>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions, prompts, tools"
          className="mt-2 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-teal-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {list.length === 0 ? (
          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No sessions match.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((s) => {
              const selected = s.id === selectedId
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => useKarin.getState().select(s.id)}
                    className={cn(
                      'w-full rounded-md border px-3 py-2 text-left',
                      selected
                        ? 'border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950/50'
                        : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800',
                    )}
                  >
                    <div className="break-words text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {s.title || s.id}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      {`${fmtDate(s.updated_at)} · ${tokensLabel(s)}`}
                    </div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      {`${s.counts.user} user · ${s.counts.assistant} assistant · ${s.counts.tool_calls} tools`}
                    </div>
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
