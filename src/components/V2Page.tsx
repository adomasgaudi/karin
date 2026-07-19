import { useKarin } from '../store/karin'

// Karin v.2.0 — deliberately blank. The v1 sessions UI stays untouched at
// view === 'sessions'; this is the parallel rebuild surface to fill in.
export default function V2Page() {
  const setView = useKarin((s) => s.setView)

  return (
    <div className="flex h-dvh flex-col bg-black text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-900 px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">Karin</span>
        {/* The version label is the toggle both ways — click it to drop back to v.1. */}
        <button
          type="button"
          onClick={() => setView('sessions')}
          title="Back to Karin v.1"
          className="text-xs text-neutral-500 hover:text-neutral-100"
        >
          v.2.0
        </button>
      </header>
      <main className="flex-1" />
    </div>
  )
}
