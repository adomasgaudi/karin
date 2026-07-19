import { useState } from 'react'
import * as Switch from '@radix-ui/react-switch'
import { Moon, Settings, Sun } from 'lucide-react'
import { JsonTree, type Json } from '@adomas/json-tree'
import { useKarin } from '../store/karin'
import KarinLogo from './KarinLogo'

// Karin v.2.0 — starts from the raw feeds themselves. v.1 renders a heavily
// interpreted view (cycles, attributed usage, pricing); v.2 begins at the other
// end, showing exactly what the indexers wrote, and will earn its abstractions
// one at a time. The viewer is @adomas/json-tree, the SAME package Pepper uses —
// it lives in its own repo, so a change there lands in both apps.

type FeedKey = 'codex' | 'claude' | 'warp'
const FEEDS: { key: FeedKey; label: string; file: string }[] = [
  { key: 'codex', label: 'Codex', file: 'karin-data.json' },
  { key: 'claude', label: 'Claude', file: 'claude-raw.json' },
  { key: 'warp', label: 'Warp', file: 'warp-raw.json' },
]

export default function V2Page() {
  const setView = useKarin((s) => s.setView)
  const theme = useKarin((s) => s.theme)
  const toggleTheme = useKarin((s) => s.toggleTheme)
  // Selected one at a time: a selector returning a fresh object re-renders on every store tick.
  const codex = useKarin((s) => s.codex)
  const claude = useKarin((s) => s.claude)
  const warp = useKarin((s) => s.warp)
  const feeds = { codex, claude, warp }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [active, setActive] = useState<FeedKey>('codex')

  const value = feeds[active] as Json | null

  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900 dark:bg-black dark:text-neutral-100">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-900">
        <KarinLogo />
        <span className="text-sm font-semibold tracking-tight">Karin</span>
        {/* The version label is the toggle both ways — click it to drop back to v.1. */}
        <button
          type="button"
          onClick={() => setView('sessions')}
          title="Back to Karin v.1"
          className="text-xs text-neutral-400 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100"
        >
          v.2.0
        </button>

        <div className="ml-4 flex items-center gap-1">
          {FEEDS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setActive(f.key)}
              disabled={feeds[f.key] == null}
              title={`data/${f.file}`}
              className={
                'rounded-md border px-2 py-1 text-xs disabled:opacity-30 ' +
                (active === f.key
                  ? 'border-neutral-400 bg-neutral-100 text-neutral-900 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100'
                  : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900')
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Settings"
            title="Theme"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          {settingsOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSettingsOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-md border border-neutral-200 bg-white p-1 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
                <div className="flex items-center gap-1.5 px-2 py-1.5">
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
            </>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[0.78rem] leading-relaxed">
        {value == null ? (
          <p className="text-neutral-500">
            No {FEEDS.find((f) => f.key === active)?.label} feed loaded — run the indexer for it.
          </p>
        ) : (
          <JsonTree value={value} openDepth={2} />
        )}
      </main>
    </div>
  )
}
