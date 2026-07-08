import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useKarin } from '../store/karin'
import { cn } from '../lib/cn'
import type { UnifiedSession } from '../types'

// One session's activity clipped to a single day.
interface Interval {
  session: UnifiedSession
  start: number // ms epoch, clipped to the day
  end: number
  lane: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const MIN_GAP_MS = 5 * 60 * 1000 // gaps shorter than this aren't labeled

function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayStartMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function fmtClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDur(ms: number): string {
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// Greedy lane packing: overlapping intervals get separate rows; a lane is reused
// as soon as its previous interval has ended.
function assignLanes(intervals: Omit<Interval, 'lane'>[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  return sorted.map((iv) => {
    let lane = laneEnds.findIndex((end) => end <= iv.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(iv.end)
    } else {
      laneEnds[lane] = iv.end
    }
    return { ...iv, lane }
  })
}

// Merge intervals into a union, then return the gaps between the merged blocks.
function findGaps(intervals: Interval[]): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = [{ ...sorted[0] }]
  for (const iv of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (iv.start <= last.end) last.end = Math.max(last.end, iv.end)
    else merged.push({ start: iv.start, end: iv.end })
  }
  const gaps: Array<{ start: number; end: number }> = []
  for (let i = 1; i < merged.length; i++) {
    const gap = { start: merged[i - 1].end, end: merged[i].start }
    if (gap.end - gap.start >= MIN_GAP_MS) gaps.push(gap)
  }
  return gaps
}

const SOURCE_BAR: Record<UnifiedSession['source'], string> = {
  codex: 'bg-sky-500/80 hover:bg-sky-500 border-sky-600',
  claude: 'bg-orange-500/80 hover:bg-orange-500 border-orange-600',
}

export default function TimelinePage() {
  const sessions = useKarin((s) => s.sessions)
  const sourceFilter = useKarin((s) => s.sourceFilter)
  const setView = useKarin((s) => s.setView)
  const select = useKarin((s) => s.select)

  // Sessions → per-day clipped intervals. A session spanning midnight contributes
  // an interval to every day it touches.
  const byDay = useMemo(() => {
    const map = new Map<string, Omit<Interval, 'lane'>[]>()
    for (const s of sessions) {
      if (sourceFilter !== 'all' && s.source !== sourceFilter) continue
      const startIso = s.started_at ?? s.updated_at
      const endIso = s.updated_at ?? s.started_at
      if (!startIso || !endIso) continue
      let start = Date.parse(startIso)
      let end = Date.parse(endIso)
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      if (end < start) [start, end] = [end, start]
      for (let day = dayStartMs(dayKey(start)); day <= end; day += DAY_MS) {
        const s0 = Math.max(start, day)
        const s1 = Math.min(end, day + DAY_MS - 1)
        if (s1 < s0) continue
        const key = dayKey(day)
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push({ session: s, start: s0, end: s1 })
      }
    }
    return map
  }, [sessions, sourceFilter])

  const days = useMemo(() => [...byDay.keys()].sort(), [byDay])
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  // Default to the most recent day with activity; keep the choice valid if data shifts.
  const day = selectedDay && byDay.has(selectedDay) ? selectedDay : days[days.length - 1] ?? null
  const dayIdx = day ? days.indexOf(day) : -1

  const intervals = useMemo(() => (day ? assignLanes(byDay.get(day)!) : []), [byDay, day])
  const gaps = useMemo(() => findGaps(intervals), [intervals])
  const laneCount = intervals.reduce((max, iv) => Math.max(max, iv.lane + 1), 0)

  // Axis: whole hours padded around the day's activity (min 1h span).
  const HOUR = 3600_000
  const t0 = intervals.length ? Math.floor(Math.min(...intervals.map((i) => i.start)) / HOUR) * HOUR : 0
  const t1 = intervals.length ? Math.max(Math.ceil(Math.max(...intervals.map((i) => i.end)) / HOUR) * HOUR, t0 + HOUR) : 1
  const span = t1 - t0
  const pct = (t: number) => ((t - t0) / span) * 100

  const hourTicks: number[] = []
  const tickStep = span > 12 * HOUR ? 2 * HOUR : HOUR
  for (let t = t0; t <= t1; t += tickStep) hourTicks.push(t)

  const dayLabel = day
    ? new Date(dayStartMs(day)).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <div className="flex h-dvh flex-col bg-neutral-100 text-neutral-900 dark:bg-black dark:text-neutral-100">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={() => setView('sessions')}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sessions
        </button>
        <h1 className="text-base font-semibold tracking-tight">Day timeline</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            disabled={dayIdx <= 0}
            onClick={() => setSelectedDay(days[dayIdx - 1])}
            aria-label="Previous day"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-30 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[14rem] text-center text-sm font-medium tabular-nums">{dayLabel ?? 'No activity'}</span>
          <button
            type="button"
            disabled={dayIdx < 0 || dayIdx >= days.length - 1}
            onClick={() => setSelectedDay(days[dayIdx + 1])}
            aria-label="Next day"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-30 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 text-[0.68rem] text-neutral-500 dark:text-neutral-400">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-500" /> Codex</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-orange-500" /> Claude</span>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {intervals.length === 0 ? (
          <p className="mt-10 text-center text-sm text-neutral-500 dark:text-neutral-400">No sessions on this day.</p>
        ) : (
          <div className="min-w-[640px]">
            {/* Hour axis */}
            <div className="relative h-6 border-b border-neutral-200 dark:border-neutral-800">
              {hourTicks.map((t) => (
                <span
                  key={t}
                  style={{ left: `${pct(t)}%` }}
                  className="absolute -translate-x-1/2 text-[0.65rem] tabular-nums text-neutral-400 dark:text-neutral-500"
                >
                  {fmtClock(t)}
                </span>
              ))}
            </div>

            {/* Gap strip: labeled idle stretches between activity blocks */}
            <div className="relative h-7 border-b border-dashed border-neutral-200 dark:border-neutral-800">
              {gaps.map((g) => (
                <span
                  key={g.start}
                  style={{ left: `${pct(g.start)}%`, width: `${pct(g.end) - pct(g.start)}%` }}
                  title={`Gap ${fmtClock(g.start)} – ${fmtClock(g.end)}`}
                  className="absolute top-1 flex h-5 items-center justify-center overflow-hidden rounded-sm border border-dashed border-neutral-300 text-[0.62rem] whitespace-nowrap text-neutral-400 dark:border-neutral-700 dark:text-neutral-500"
                >
                  {fmtDur(g.end - g.start)} gap
                </span>
              ))}
            </div>

            {/* Lanes: overlapping sessions stack; a lane is reused once free */}
            <div className="relative mt-2" style={{ height: `${laneCount * 34}px` }}>
              {/* hour gridlines */}
              {hourTicks.map((t) => (
                <span
                  key={t}
                  style={{ left: `${pct(t)}%` }}
                  className="absolute top-0 bottom-0 w-px bg-neutral-200/70 dark:bg-neutral-800/70"
                />
              ))}
              {intervals.map((iv) => {
                const left = pct(iv.start)
                const width = Math.max(pct(iv.end) - left, 0.35) // zero-length sessions stay visible
                const label = iv.session.title || iv.session.id
                return (
                  <button
                    key={`${iv.session.uid}-${iv.start}`}
                    type="button"
                    onClick={() => {
                      select(iv.session.uid)
                      setView('sessions')
                    }}
                    style={{ left: `${left}%`, width: `${width}%`, top: `${iv.lane * 34}px` }}
                    title={`${label}\n${fmtClock(iv.start)} – ${fmtClock(iv.end)} (${fmtDur(iv.end - iv.start)})`}
                    className={cn(
                      'absolute flex h-7 items-center overflow-hidden rounded-md border px-1.5 text-left text-[0.68rem] font-medium text-white shadow-sm transition-colors',
                      SOURCE_BAR[iv.session.source],
                    )}
                  >
                    <span className="truncate">{label}</span>
                  </button>
                )
              })}
            </div>

            {/* Per-session start/end listing for the day */}
            <ul className="mt-6 flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800">
              {[...intervals]
                .sort((a, b) => a.start - b.start)
                .map((iv) => (
                  <li key={`row-${iv.session.uid}-${iv.start}`} className="flex items-center gap-2 text-xs">
                    <span className={cn('h-2 w-2 shrink-0 rounded-sm', iv.session.source === 'codex' ? 'bg-sky-500' : 'bg-orange-500')} />
                    <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                      {fmtClock(iv.start)} – {fmtClock(iv.end)}
                    </span>
                    <span className="tabular-nums text-neutral-400 dark:text-neutral-500">({fmtDur(iv.end - iv.start)})</span>
                    <button
                      type="button"
                      onClick={() => {
                        select(iv.session.uid)
                        setView('sessions')
                      }}
                      className="min-w-0 truncate text-left font-medium text-neutral-800 hover:underline dark:text-neutral-200"
                    >
                      {iv.session.title || iv.session.id}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
