import { useState } from 'react'
import * as Switch from '@radix-ui/react-switch'
import { FileDown, Moon, Settings, Sun, Upload } from 'lucide-react'
import { useKarin } from '../store/karin'
import { downloadAiExport, downloadGistExport } from '../lib/aiExport'

// Occasional app-wide actions (exports, reload, theme) behind one gear. Lives in the nav
// bar so the sidebar header carries nothing but identity and the session list's own tools.
export default function SettingsMenu() {
  const sessions = useKarin((s) => s.sessions)
  const theme = useKarin((s) => s.theme)
  const toggleTheme = useKarin((s) => s.toggleTheme)
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        title="Exports, load, theme"
        className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-md border border-neutral-200 bg-white p-1 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
            {/* AI exports: "gist" (~1–3 lines/session, clues only) is the primary; "full"
                (every cycle, ~100× bigger) hangs off it as a small secondary. */}
            <div className="flex items-stretch">
              <button
                type="button"
                onClick={() => downloadGistExport(useKarin.getState().sessions)}
                disabled={sessions.length === 0}
                title="Download an ultra-compact gist of ALL sessions (~1–3 lines each) — just enough clues for another AI to summarize what happened"
                className="flex flex-1 items-center gap-2 rounded px-2 py-1 text-left text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                <FileDown className="h-3.5 w-3.5" />
                AI gist
              </button>
              <button
                type="button"
                onClick={() => downloadAiExport(useKarin.getState().sessions)}
                disabled={sessions.length === 0}
                title="Download the FULL digest — every prompt cycle with tools, files and reply excerpts (much larger)"
                className="rounded px-2 py-1 text-[0.68rem] text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-900"
              >
                full
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                useKarin.getState().reset()
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              <Upload className="h-3.5 w-3.5" />
              Load
            </button>
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
  )
}
