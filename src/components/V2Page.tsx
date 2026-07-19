import { useMemo, useState } from 'react'
import * as Switch from '@radix-ui/react-switch'
import { Moon, Settings, Sun } from 'lucide-react'
import { JsonTree, type Json } from '@adomas/json-tree'
import { useKarin } from '../store/karin'
import { NavBarShell } from './NavBar'
import { prettifyJson } from '../lib/prettyJson'

// Karin v.2.0 — starts from the raw feeds themselves. v.1 renders a heavily
// interpreted view (cycles, attributed usage, pricing); v.2 begins at the other
// end, showing exactly what the indexers wrote, and will earn its abstractions
// one at a time. The viewer is @adomas/json-tree, the SAME package Pepper uses —
// it lives in its own repo, so a change there lands in both apps.

// v.2 carries its OWN 2.x version line, bumped on every material v.2 change —
// separate from the app-wide v.N in appVersion.ts, which also keeps ticking.
export const V2_VERSION = 'v.2.1'

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
  // 'raw' = byte-for-byte what the indexer wrote. 'clean' = the same tree with
  // timestamps rewritten to Vilnius day+time. Same JsonTree either way, so
  // collapse/expand and the big-array paging guards apply to both.
  const [mode, setMode] = useState<'clean' | 'raw'>('clean')

  const raw = feeds[active] as Json | null
  const value = useMemo(
    () => (raw == null || mode === 'raw' ? raw : prettifyJson(raw)),
    [raw, mode],
  )

  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900 dark:bg-black dark:text-neutral-100">
      {/* Same nav scaffold as v.1 — only the tabs and the right slot differ. */}
      <NavBarShell
        tabs={FEEDS.map((f) => ({ id: f.key, label: f.label, title: `data/${f.file}`, disabled: feeds[f.key] == null }))}
        active={active}
        onSelect={setActive}
        versionLabel={V2_VERSION}
        onVersionClick={() => setView('sessions')}
        versionTitle="Back to Karin v.1"
        right={
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-neutral-200 p-px text-[0.68rem] dark:border-neutral-800">
              {(['clean', 'raw'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  title={m === 'clean' ? 'Dates shown as Vilnius day + time' : 'Exactly as written on disk'}
                  className={`rounded px-1.5 py-0.5 ${
                    mode === m
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                      : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-label="Settings"
              title="Theme"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setSettingsOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-md border border-neutral-200 bg-white p-1 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="flex items-center gap-1.5 px-2 py-1">
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
          </div>
        }
      />

      <main className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[0.78rem] leading-relaxed">
        {value == null ? (
          <p className="text-neutral-500">
            No {FEEDS.find((f) => f.key === active)?.label} feed loaded — run the indexer for it.
          </p>
        ) : (
          <JsonTree value={value} openDepth={2} theme="auto" />
        )}
      </main>
    </div>
  )
}
