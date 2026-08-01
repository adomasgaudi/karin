import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '../lib/cn'

// Nav-bar indicator for the three feed watchers (karin.py / karin_claude.py /
// karin_warp.py --watch). The serving Vite process reports which are running via
// /api/watchers; when any is down, this shows a one-click restart that spawns the
// missing ones on the owner's PC (POST /api/watchers/start). Renders nothing when
// the endpoint is unreachable — e.g. the bundle opened from a bare file path.
type WatcherId = 'codex' | 'claude' | 'warp'
type Running = Record<WatcherId, boolean>

const WATCHER_LABELS: Record<WatcherId, string> = {
  codex: 'Codex',
  claude: 'Claude',
  warp: 'Warp',
}

const POLL_MS = 15000

export default function WatcherStatus() {
  const [running, setRunning] = useState<Running | null>(null)
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      // Skip the poll while a start request is in flight — its response is fresher.
      if (startingRef.current) return
      try {
        const res = await fetch('/api/watchers', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { running?: Running }
        if (!cancelled) setRunning(body.running ?? null)
      } catch {
        if (!cancelled) setRunning(null)
      }
    }
    void check()
    const timer = setInterval(() => void check(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (!running) return null

  const down = (Object.keys(WATCHER_LABELS) as WatcherId[]).filter((id) => !running[id])
  if (down.length === 0) {
    return (
      <span
        title="All three feed watchers are running (Codex, Claude, Warp)"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
      />
    )
  }

  const restart = async () => {
    setStarting(true)
    startingRef.current = true
    try {
      const res = await fetch('/api/watchers/start', { method: 'POST' })
      if (res.ok) {
        const body = (await res.json()) as { running?: Running }
        if (body.running) setRunning(body.running)
      }
    } catch {
      // Leave the button up; the next poll re-checks.
    } finally {
      setStarting(false)
      startingRef.current = false
    }
  }

  return (
    <button
      type="button"
      onClick={() => void restart()}
      disabled={starting}
      title={`Not watching: ${down.map((id) => WATCHER_LABELS[id]).join(', ')} — click to restart the watcher${down.length > 1 ? 's' : ''} on this PC`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[0.65rem] font-medium text-amber-800',
        'hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70',
      )}
    >
      <RefreshCw className={cn('h-3 w-3', starting && 'animate-spin')} />
      {starting ? 'starting…' : `watchers off (${down.length})`}
    </button>
  )
}
