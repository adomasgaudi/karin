import { useRef, useState } from 'react'
import { Upload, Sun, Moon } from 'lucide-react'
import { useKarin } from '../store/karin'
import { parseKarinText } from '../lib/loadData'
import { isClaudeRawData } from '../lib/claudeRaw'
import { isWarpRawData } from '../lib/warpRaw'
import { cn } from '../lib/cn'
import { APP_VERSION } from '../lib/appVersion'

export default function Dropzone() {
  const error = useKarin((s) => s.error)
  const theme = useKarin((s) => s.theme)
  const toggleTheme = useKarin((s) => s.toggleTheme)
  const [isOver, setIsOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // One dropzone, two dataset shapes: a Claude raw feed (has a `projects` array) loads as
  // Claude; anything else is parsed as the Codex `sessions` feed.
  async function handleFile(file: File | null | undefined) {
    if (!file) return
    useKarin.getState().setError(null)
    try {
      const text = await file.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text.trim())
      } catch {
        parsed = null
      }
      if (isClaudeRawData(parsed)) {
        useKarin.getState().setClaudeData(parsed)
      } else if (isWarpRawData(parsed)) {
        useKarin.getState().setWarpData(parsed)
      } else {
        useKarin.getState().setCodexData(parseKarinText(text))
      }
    } catch (err) {
      useKarin.getState().setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="relative flex h-dvh items-center justify-center bg-neutral-50 px-4 py-8 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle dark mode"
        className="absolute right-3 top-3 rounded-md border border-neutral-200 bg-white p-2 text-neutral-500 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-teal-700 dark:text-teal-400">Karin</h1>
          <p className="mt-1 text-xs font-medium text-neutral-400 dark:text-neutral-500">{APP_VERSION}</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            A private, local viewer for Codex &amp; Claude Code sessions.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsOver(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setIsOver(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setIsOver(false)
            void handleFile(e.dataTransfer.files?.[0])
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed px-6 py-12 text-center transition-colors',
            isOver
              ? 'border-teal-500 bg-teal-50 dark:border-teal-400 dark:bg-teal-950/50'
              : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900',
          )}
        >
          <Upload className="h-8 w-8 text-teal-700 dark:text-teal-400" />
          <p className="text-sm text-neutral-900 dark:text-neutral-100">Drop karin-data.js or claude-raw.json here</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            Choose file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".js,.json,application/json"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </div>

        {error && (
          <p className="mt-3 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <p className="mt-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
          Generate it locally:{' '}
          <code className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[0.7rem] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            python bin/karin.py
          </code>{' '}
          → creates <code className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[0.7rem] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">data/karin-data.json</code>. Your transcripts never leave this device.
        </p>
      </div>
    </div>
  )
}
