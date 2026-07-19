import { useState } from 'react'
import * as Switch from '@radix-ui/react-switch'
import { Moon, Settings, Sun } from 'lucide-react'
import { useKarin } from '../store/karin'
import KarinLogo from './KarinLogo'

// Karin v.2.0 — deliberately near-blank. The v1 sessions UI stays untouched at
// view === 'sessions'; this is the parallel rebuild surface to fill in.
export default function V2Page() {
  const setView = useKarin((s) => s.setView)
  const theme = useKarin((s) => s.theme)
  const toggleTheme = useKarin((s) => s.toggleTheme)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
      <main className="flex-1" />
    </div>
  )
}
