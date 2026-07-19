import { useKarin } from '../store/karin'

// Karin v.2.0 — deliberately blank. The v1 sessions UI stays untouched at
// view === 'sessions'; this is the parallel rebuild surface to fill in.
export default function V2Page() {
  const setView = useKarin((s) => s.setView)

  return (
    <div className="flex h-dvh flex-col bg-black text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-900 px-4 py-3">
        <button
          type="button"
          onClick={() => setView('sessions')}
          className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
        >
          ← v.1
        </button>
        <span className="text-sm font-semibold tracking-tight">Karin</span>
        <span className="text-xs text-neutral-500">v.2.0</span>
      </header>
      <main className="flex-1" />
    </div>
  )
}
