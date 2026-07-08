import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { APP_VERSION } from '../lib/appVersion'
import { CHANGELOG } from '../lib/changelog'

// Floating bottom-right button that opens the version-updates log. Each entry
// is a title that expands to a short summary, which can expand once more to a
// longer detail (when the entry provides one).
export default function ChangelogButton() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div
          className="flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          role="dialog"
          aria-label="Version updates"
        >
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Version updates
            </span>
            <span className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
              {CHANGELOG.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {CHANGELOG.map((entry) => (
              <details
                key={entry.version}
                className="group border-b border-neutral-100 last:border-b-0 dark:border-neutral-800"
              >
                <summary className="flex cursor-pointer list-none items-baseline gap-2 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                  <span className="text-neutral-300 transition-transform group-open:rotate-90 dark:text-neutral-600">
                    ›
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-neutral-400 dark:text-neutral-500">
                    {entry.version}
                  </span>
                  <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {entry.title}
                  </span>
                </summary>

                <div className="px-3 pb-3 pl-8">
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">{entry.summary}</p>
                  {entry.detail && (
                    <details className="group/detail mt-2">
                      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">
                        <span className="transition-transform group-open/detail:rotate-90">›</span>
                        More detail
                      </summary>
                      <p className="mt-1.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                        {entry.detail}
                      </p>
                    </details>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Version updates"
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold shadow-lg transition-colors',
          'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
          'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800',
        )}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span className="tabular-nums">{APP_VERSION}</span>
      </button>
    </div>
  )
}
