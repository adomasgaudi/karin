import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Crosshair } from 'lucide-react'
import { useKarin } from '../store/karin'
import { cn } from '../lib/cn'
import type { UnifiedSession, TokenUsage } from '../types'
import { buildCycles, cycleTiming, cyclePrompt, cycleUsage } from '../lib/unifiedCycles'
import {
  CURRENCY_LABELS,
  TOKEN_UNIT_REF_LABELS,
  UNIT_MODE_LABELS,
  currencyModes,
  effectiveRates,
  ratesForUnified,
  tokenUnitRefs,
  unitModes,
  usageUnitTotal,
  EUR_PER_USD,
  type TokenRates,
} from '../lib/pricing'

// ---------------------------------------------------------------------------
// Data model: each session becomes an envelope [start..end] holding its cycles
// as activity segments — the light space between segments IS the idle time.
//
// Two proportionality rules make cost legible at a glance:
//  • pill HEIGHT is proportional to the session's total (in the active unit)
//    on ONE global scale — spendy sessions are visibly thicker;
//  • the in-pill cumulative line uses a step profile: it only climbs DURING a
//    cycle and stays flat across idle gaps (tokens aren't spent while idle).
// ---------------------------------------------------------------------------

interface Seg {
  start: number
  end: number
  prompt: string
  usage: TokenUsage
}

interface SessionTrack {
  session: UnifiedSession
  start: number
  end: number
  segs: Seg[]
}

interface Placed extends SessionTrack {
  lane: number
}

const MIN_SPAN = 60_000 // fully zoomed in: 1 minute across the screen
const MAX_SPAN = 120 * 86_400_000 // fully zoomed out: ~4 months
const MIN_PILL = 16 // even near-free sessions stay hoverable
const MAX_PILL = 75 // the most expensive session gets this much height
const LANE_GAP = 8

// Build (and cache) the cycle segments for one session. Cycle building flattens the
// whole transcript, so results are cached by uid+updated_at — only sessions that
// actually changed recompute on the 5s data poll.
const trackCache = new Map<string, { updatedAt: string | null; track: SessionTrack | null }>()

function sessionTrack(s: UnifiedSession): SessionTrack | null {
  const hit = trackCache.get(s.uid)
  if (hit && hit.updatedAt === s.updated_at) return hit.track

  let track: SessionTrack | null = null
  try {
    const cycles = buildCycles(s)
    const segs: Seg[] = []
    for (const c of cycles) {
      const t = cycleTiming(c)
      if (t.startMs == null || t.endMs == null) continue
      segs.push({
        start: t.startMs,
        end: Math.max(t.endMs, t.startMs + 1000),
        prompt: cyclePrompt(c),
        usage: cycleUsage(c),
      })
    }
    if (segs.length > 0) {
      segs.sort((a, b) => a.start - b.start)
      track = {
        session: s,
        start: segs[0].start,
        end: Math.max(...segs.map((x) => x.end)),
        segs,
      }
    } else {
      const start = s.started_at ? Date.parse(s.started_at) : NaN
      const end = s.updated_at ? Date.parse(s.updated_at) : NaN
      if (Number.isFinite(start) && Number.isFinite(end)) {
        track = { session: s, start, end: Math.max(end, start + 1000), segs: [] }
      }
    }
  } catch {
    track = null
  }
  trackCache.set(s.uid, { updatedAt: s.updated_at, track })
  return track
}

// Greedy lane packing: overlapping envelopes stack; a lane is reused once free.
function packLanes(tracks: SessionTrack[]): Placed[] {
  const sorted = [...tracks].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  const GAP = 4 * 60_000 // keep a small visual breather before reusing a lane
  return sorted.map((tr) => {
    let lane = laneEnds.findIndex((end) => end + GAP <= tr.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(tr.end)
    } else {
      laneEnds[lane] = tr.end
    }
    return { ...tr, lane }
  })
}

// --- Formatting --------------------------------------------------------------

function fmtClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const mins = Math.round(s / 60)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function fmtCompact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 10e6 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 10e3 ? 0 : 1)}k`
  return String(Math.round(n))
}

function fmtDayTime(ms: number): string {
  const d = new Date(ms)
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtClock(ms)}`
}

// --- Time axis ---------------------------------------------------------------

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const TICK_STEPS = [
  MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN,
  HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY, 14 * DAY,
]

function localMidnight(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Ticks aligned to local wall-clock boundaries; day-and-up steps walk local
// midnights so DST shifts can't drift the grid.
function buildTicks(start: number, end: number, widthPx: number): { step: number; ticks: number[] } {
  const span = end - start
  const msPerPx = span / Math.max(widthPx, 1)
  const step = TICK_STEPS.find((s) => s / msPerPx >= 78) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const ticks: number[] = []
  if (step >= DAY) {
    const days = Math.round(step / DAY)
    for (let t = localMidnight(start); t <= end; ) {
      if (t >= start) ticks.push(t)
      const d = new Date(t)
      d.setDate(d.getDate() + days)
      d.setHours(0, 0, 0, 0)
      t = d.getTime()
    }
  } else {
    const base = localMidnight(start)
    for (let t = base + Math.floor((start - base) / step) * step; t <= end; t += step) {
      if (t >= start) ticks.push(t)
    }
  }
  return { step, ticks }
}

function tickLabel(t: number, step: number): string {
  const d = new Date(t)
  if (step >= DAY) return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  if (d.getHours() === 0 && d.getMinutes() === 0)
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return fmtClock(t)
}

// --- Source accents (accents only — the pill itself stays neutral) ------------

const ACCENT = {
  codex: { bar: 'bg-sky-500', seg: 'bg-sky-500/30 hover:bg-sky-500/55 dark:bg-sky-400/25 dark:hover:bg-sky-400/50' },
  claude: { bar: 'bg-orange-500', seg: 'bg-orange-500/30 hover:bg-orange-500/55 dark:bg-orange-400/25 dark:hover:bg-orange-400/50' },
} as const

interface Tip {
  x: number
  y: number
  title: string
  lines: string[]
}

export default function TimelinePage() {
  const sessions = useKarin((s) => s.sessions)
  const sourceFilter = useKarin((s) => s.sourceFilter)
  const setView = useKarin((s) => s.setView)
  const select = useKarin((s) => s.select)
  const priceBasis = useKarin((s) => s.priceBasis)
  const subDivisors = useKarin((s) => s.subDivisors)
  // Same global unit system as the main page — changing it here re-expresses the
  // sidebar and detail views too, exactly like the sidebar's own toggle.
  const unitMode = useKarin((s) => s.unitMode)
  const setUnitMode = useKarin((s) => s.setUnitMode)
  const tokenRef = useKarin((s) => s.tokenRef)
  const setTokenRef = useKarin((s) => s.setTokenRef)
  const tokenMult = useKarin((s) => s.tokenMult)
  const currency = useKarin((s) => s.currency)
  const setCurrency = useKarin((s) => s.setCurrency)

  // Value of a usage blob in the ACTIVE unit (tokens / token units / money).
  const unitValue = useCallback(
    (usage: TokenUsage | null | undefined, rates: TokenRates | null): number =>
      usageUnitTotal(usage, rates, unitMode, tokenRef, tokenMult),
    [unitMode, tokenRef, tokenMult],
  )

  const fmtVal = useCallback(
    (v: number): string => {
      if (unitMode !== 'money') return `${fmtCompact(v)} ${unitMode === 'tokens' ? 'tok' : 'tu'}`
      const eur = currency === 'eur' || currency === 'eur_cents'
      const x = eur ? v * EUR_PER_USD : v
      const sym = eur ? '€' : '$'
      if (x >= 100) return `${sym}${Math.round(x)}`
      if (x >= 1) return `${sym}${x.toFixed(2)}`
      return `${sym}${x.toFixed(3)}`
    },
    [unitMode, currency],
  )

  const tracks = useMemo(() => {
    const out: SessionTrack[] = []
    for (const s of sessions) {
      if (sourceFilter !== 'all' && s.source !== sourceFilter) continue
      const tr = sessionTrack(s)
      if (tr) out.push(tr)
    }
    return out
  }, [sessions, sourceFilter])

  const placed = useMemo(() => packLanes(tracks), [tracks])

  // Per-session totals in the active unit + the ONE global scale all heights share.
  const valued = useMemo(() => {
    return placed.map((p) => {
      const rates = effectiveRates(ratesForUnified(p.session), priceBasis, subDivisors[p.session.source])
      const segVals = p.segs.map((seg) => unitValue(seg.usage, rates))
      const total = segVals.reduce((a, b) => a + b, 0)
      return { ...p, rates, segVals, total }
    })
  }, [placed, priceBasis, subDivisors, unitValue])

  const globalMax = useMemo(() => Math.max(1e-9, ...valued.map((v) => v.total)), [valued])
  // ONE value→pixels scale shared by pill heights AND the in-pill lines, so a €0.10
  // session's line is literally 10× lower than a €1 session's. Pills clamp to
  // MIN_PILL for hoverability — the line inside keeps the true (unclamped) height.
  const pxPerValue = MAX_PILL / globalMax
  const pillHeight = useCallback(
    (total: number) => Math.min(MAX_PILL, Math.max(MIN_PILL, total * pxPerValue)),
    [pxPerValue],
  )

  // Variable-height lanes: each lane is as tall as its tallest pill; pills sit on
  // the lane's BOTTOM so heights compare against a shared baseline.
  const laneTops = useMemo(() => {
    const heights: number[] = []
    for (const v of valued) {
      const h = pillHeight(v.total)
      heights[v.lane] = Math.max(heights[v.lane] ?? MIN_PILL, h)
    }
    const tops: number[] = []
    let y = LANE_GAP
    for (let i = 0; i < heights.length; i++) {
      tops[i] = y
      y += (heights[i] ?? MIN_PILL) + LANE_GAP
    }
    return { tops, heights, totalH: y }
  }, [valued, pillHeight])

  const dataMin = tracks.length ? Math.min(...tracks.map((t) => t.start)) : Date.now() - 6 * HOUR
  const dataMax = tracks.length ? Math.max(...tracks.map((t) => t.end)) : Date.now()

  // Viewport = visible [start, end] in ms. Everything renders off this pair.
  const [viewState, setViewState] = useState<{ start: number; end: number } | null>(null)
  const view = viewState ?? { start: Math.max(dataMin, dataMax - 12 * HOUR) - 15 * MIN, end: dataMax + 30 * MIN }
  const span = view.end - view.start

  const canvasRef = useRef<HTMLDivElement>(null)
  const [widthPx, setWidthPx] = useState(1200)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidthPx(el.clientWidth))
    ro.observe(el)
    setWidthPx(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const clampView = useCallback(
    (start: number, end: number): { start: number; end: number } => {
      let s = start
      let e = end
      let sp = e - s
      if (sp < MIN_SPAN) {
        const c = (s + e) / 2
        s = c - MIN_SPAN / 2
        e = c + MIN_SPAN / 2
        sp = MIN_SPAN
      }
      if (sp > MAX_SPAN) {
        const c = (s + e) / 2
        s = c - MAX_SPAN / 2
        e = c + MAX_SPAN / 2
        sp = MAX_SPAN
      }
      const lo = dataMin - sp
      const hi = dataMax + sp
      if (s < lo) {
        s = lo
        e = s + sp
      }
      if (e > hi) {
        e = hi
        s = e - sp
      }
      return { start: s, end: e }
    },
    [dataMin, dataMax],
  )

  const pct = (t: number) => ((t - view.start) / span) * 100

  // Wheel: zoom around the cursor. Trackpad horizontal delta (or shift+wheel) pans.
  // Attached manually so preventDefault works (React wheel handlers can be passive).
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setViewState((prev) => {
        const v = prev ?? view
        const sp = v.end - v.start
        const rect = el.getBoundingClientRect()
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
          const d = (e.deltaX || e.deltaY) * (sp / rect.width)
          return clampView(v.start + d, v.end + d)
        }
        const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        const anchor = v.start + frac * sp
        const factor = Math.exp(e.deltaY * 0.0016)
        const ns = sp * factor
        return clampView(anchor - frac * ns, anchor + (1 - frac) * ns)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // view is intentionally read fresh via setViewState's callback; deps stay minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampView])

  // Drag to pan — horizontally through time AND vertically through lanes.
  // Pointer capture is only taken once movement crosses the threshold —
  // capturing on pointer-down would retarget the click to the canvas and swallow
  // pill/cycle clicks (that was a real bug).
  const lanesRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; start: number; end: number; scrollTop: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: view.start,
      end: view.end,
      scrollTop: lanesRef.current?.scrollTop ?? 0,
      moved: false,
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(d.id)
    }
    if (!d.moved) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const dt = -dx * ((d.end - d.start) / rect.width)
    setViewState(clampView(d.start + dt, d.end + dt))
    if (lanesRef.current) lanesRef.current.scrollTop = d.scrollTop - dy
  }
  const onPointerUp = () => {
    const d = drag.current
    if (d) setTimeout(() => (drag.current = null), 0)
  }
  const clickAllowed = () => !drag.current?.moved

  const fit = (preset: 'hour' | 'day' | 'week' | 'all') => {
    const now = Date.now()
    if (preset === 'all') {
      const pad = Math.max((dataMax - dataMin) * 0.03, 10 * MIN)
      setViewState(clampView(dataMin - pad, dataMax + pad))
    } else if (preset === 'hour') {
      const anchor = Math.min(now, dataMax)
      setViewState(clampView(anchor - 55 * MIN, anchor + 5 * MIN))
    } else if (preset === 'day') {
      const mid = localMidnight(Math.min(now, dataMax))
      setViewState(clampView(mid, mid + DAY))
    } else {
      const mid = localMidnight(Math.min(now, dataMax))
      setViewState(clampView(mid - 6 * DAY, mid + DAY))
    }
  }

  // Keyboard: ← → pan, + − zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      setViewState((prev) => {
        const v = prev ?? view
        const sp = v.end - v.start
        if (e.key === 'ArrowLeft') return clampView(v.start - sp * 0.15, v.end - sp * 0.15)
        if (e.key === 'ArrowRight') return clampView(v.start + sp * 0.15, v.end + sp * 0.15)
        if (e.key === '+' || e.key === '=') return clampView(v.start + sp * 0.15, v.end - sp * 0.15)
        if (e.key === '-') return clampView(v.start - sp * 0.15, v.end + sp * 0.15)
        return prev
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampView])

  const [tip, setTip] = useState<Tip | null>(null)
  const showTip = (e: React.MouseEvent, title: string, lines: string[]) =>
    setTip({ x: e.clientX, y: e.clientY, title, lines })
  const moveTip = (e: React.MouseEvent) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))

  const openSession = (uid: string) => {
    if (!clickAllowed()) return
    select(uid)
    setView('sessions')
  }

  const { step, ticks } = buildTicks(view.start, view.end, widthPx)
  const now = Date.now()
  const visible = valued.filter((p) => p.end >= view.start && p.start <= view.end)

  return (
    <div className="flex h-dvh flex-col bg-neutral-100 text-neutral-900 dark:bg-black dark:text-neutral-100">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={() => setView('sessions')}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sessions
        </button>
        <h1 className="text-base font-semibold tracking-tight">Timeline</h1>
        <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {fmtDayTime(view.start)} — {fmtDayTime(view.end)}
        </span>
        {/* Units — the SAME global toggle as the sidebar (tokens / token units / money) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setUnitMode(unitModes[(unitModes.indexOf(unitMode) + 1) % unitModes.length])}
            title="Cycle usage unit: tokens → token units → money (heights rescale)"
            className="h-7 rounded-md border border-neutral-200 bg-neutral-50 px-2 text-[0.7rem] font-medium text-neutral-800 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {UNIT_MODE_LABELS[unitMode]}
          </button>
          {unitMode === 'token_units' && (
            <button
              type="button"
              onClick={() => setTokenRef(tokenUnitRefs[(tokenUnitRefs.indexOf(tokenRef) + 1) % tokenUnitRefs.length])}
              title="Reference token type"
              className="h-7 rounded-md border border-neutral-200 bg-neutral-50 px-2 text-[0.7rem] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {TOKEN_UNIT_REF_LABELS[tokenRef]}
            </button>
          )}
          {unitMode === 'money' && (
            <button
              type="button"
              onClick={() => setCurrency(currencyModes[(currencyModes.indexOf(currency) + 1) % currencyModes.length])}
              className="h-7 rounded-md border border-neutral-200 bg-neutral-50 px-2 text-[0.7rem] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {CURRENCY_LABELS[currency]}
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {(['hour', 'day', 'week', 'all'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => fit(p)}
              className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-[0.7rem] font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {p === 'hour' ? '1h' : p === 'day' ? 'Day' : p === 'week' ? 'Week' : 'All'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const sp = span
              setViewState(clampView(Date.now() - sp * 0.8, Date.now() + sp * 0.2))
            }}
            title="Jump to now (keeps zoom)"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[0.7rem] font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Crosshair className="h-3 w-3" />
            Now
          </button>
        </div>
        <div className="flex w-full items-center justify-between gap-3 text-[0.68rem] text-neutral-400 dark:text-neutral-500">
          <span>
            <span className="mr-3 inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-500" /> Codex</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-orange-500" /> Claude</span>
            <span className="ml-3">pill height = total {unitMode === 'money' ? 'cost' : 'usage'} (one scale for all) · blocks = cycles · line climbs only while working</span>
          </span>
          <span className="hidden md:inline">scroll = zoom · drag = pan (any direction) · ± ←→</span>
        </div>
      </header>

      <div
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative flex-1 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
      >
        {/* Hour/day gridlines */}
        {ticks.map((t) => (
          <div key={t} style={{ left: `${pct(t)}%` }} className="absolute top-0 bottom-0 w-px bg-neutral-200/80 dark:bg-neutral-800/80" />
        ))}
        {/* Axis labels */}
        <div className="pointer-events-none absolute top-0 right-0 left-0 h-6 border-b border-neutral-200 bg-neutral-100/80 backdrop-blur-sm dark:border-neutral-800 dark:bg-black/60">
          {ticks.map((t) => (
            <span
              key={t}
              style={{ left: `${pct(t)}%` }}
              className="absolute top-1 ml-1 text-[0.65rem] whitespace-nowrap tabular-nums text-neutral-400 dark:text-neutral-500"
            >
              {tickLabel(t, step)}
            </span>
          ))}
        </div>
        {/* Now marker */}
        {now >= view.start && now <= view.end && (
          <div style={{ left: `${pct(now)}%` }} className="pointer-events-none absolute top-0 bottom-0 w-px bg-red-500/70">
            <span className="absolute top-6 left-1 text-[0.6rem] font-medium text-red-500">now</span>
          </div>
        )}

        {/* Session pills */}
        <div ref={lanesRef} className="absolute top-8 right-0 bottom-0 left-0 overflow-y-auto">
          <div style={{ height: `${Math.max(laneTops.totalH, 100)}px` }} className="relative">
            {visible.map((p) => {
              const left = pct(p.start)
              const width = Math.max(pct(p.end) - left, 0.15)
              const wPx = (width / 100) * widthPx
              const label = p.session.title || p.session.id
              const accent = ACCENT[p.session.source]
              const sessSpan = p.end - p.start
              const relPct = (t: number) => ((t - p.start) / sessSpan) * 100
              const pillH = pillHeight(p.total)
              const laneH = laneTops.heights[p.lane] ?? MIN_PILL
              const top = (laneTops.tops[p.lane] ?? 0) + (laneH - pillH) // bottom-aligned

              // Step profile: the line climbs only across a cycle's span and holds
              // flat through idle gaps — two points per segment (start@before, end@after).
              // Y uses the GLOBAL value→pixel scale (not the pill's own top), so line
              // heights are proportional across sessions; the svg y% converts px→pill%.
              const yPct = (v: number) => 100 - Math.min(98, (v * pxPerValue * 0.94) / pillH * 100)
              let cum = 0
              const stepPts: Array<{ x: number; y: number }> = [{ x: 0, y: 100 }]
              p.segs.forEach((seg, i) => {
                stepPts.push({ x: relPct(seg.start), y: yPct(cum) })
                cum += p.segVals[i]
                stepPts.push({ x: relPct(seg.end), y: yPct(cum) })
              })
              stepPts.push({ x: 100, y: stepPts[stepPts.length - 1].y })
              const polyline = stepPts.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ')
              const area = `0,100 ${polyline} 100,100`
              const totalLabel = fmtVal(p.total)
              const sessTipLines = [
                `${fmtDayTime(p.start)} – ${fmtClock(p.end)} · ${fmtDur(p.end - p.start)}`,
                `${p.segs.length} cycles · ${totalLabel}`,
              ]

              return (
                <div
                  key={p.session.uid}
                  style={{ left: `${left}%`, width: `${width}%`, top: `${top}px`, height: `${pillH}px` }}
                  className="absolute cursor-pointer overflow-hidden rounded-md border border-neutral-300/70 bg-neutral-200/40 shadow-sm transition-colors hover:border-neutral-400/80 dark:border-neutral-700/70 dark:bg-neutral-800/30 dark:hover:border-neutral-500/80"
                  onClick={() => openSession(p.session.uid)}
                  onMouseEnter={(e) => showTip(e, label, sessTipLines)}
                  onMouseMove={moveTip}
                  onMouseLeave={() => setTip(null)}
                >
                  {/* Cumulative usage step-line — flat while idle, climbing while working */}
                  {p.segs.length > 0 && wPx > 24 && (
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                      <polygon points={area} className="fill-neutral-400/35 dark:fill-neutral-500/25" />
                      <polyline
                        points={polyline}
                        fill="none"
                        vectorEffect="non-scaling-stroke"
                        className="stroke-neutral-500/80 dark:stroke-neutral-400/70"
                        strokeWidth="1.2"
                      />
                    </svg>
                  )}
                  {/* Cycle segments — click one to open the session */}
                  {wPx > 12 &&
                    p.segs.map((seg, i) => {
                      const segLeft = relPct(seg.start)
                      const segW = Math.max(relPct(seg.end) - segLeft, 0.4)
                      return (
                        <div
                          key={i}
                          style={{ left: `${segLeft}%`, width: `${segW}%` }}
                          className={cn('absolute top-0 bottom-0 rounded-[3px] transition-colors', accent.seg)}
                          onClick={(e) => {
                            e.stopPropagation()
                            openSession(p.session.uid)
                          }}
                          onMouseEnter={(e) => {
                            e.stopPropagation()
                            showTip(e, seg.prompt, [
                              `${fmtClock(seg.start)} – ${fmtClock(seg.end)} · ${fmtDur(seg.end - seg.start)}`,
                              fmtVal(p.segVals[i]),
                            ])
                          }}
                          onMouseMove={(e) => {
                            e.stopPropagation()
                            moveTip(e)
                          }}
                          onMouseLeave={(e) => {
                            e.stopPropagation()
                            showTip(e, label, sessTipLines)
                          }}
                        />
                      )
                    })}
                  {/* Source accent */}
                  <div className={cn('absolute top-0 bottom-0 left-0 w-[3px]', accent.bar)} />
                  {/* Title + total overlay (skipped on very thin pills — tooltip covers them) */}
                  {wPx > 56 && pillH >= 26 && (
                    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-2 pt-0.5">
                      <span className="truncate text-[0.7rem] font-medium text-neutral-800 [text-shadow:0_0_4px_rgba(255,255,255,0.5)] dark:text-neutral-100 dark:[text-shadow:0_0_4px_rgba(0,0,0,0.6)]">
                        {label}
                      </span>
                      {wPx > 170 && (
                        <span className="shrink-0 text-[0.65rem] tabular-nums text-neutral-600 dark:text-neutral-300">
                          {totalLabel}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {visible.length === 0 && (
              <div className="absolute inset-x-0 top-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
                Nothing in view — scroll out or hit{' '}
                <button type="button" onClick={() => fit('all')} className="font-medium text-neutral-700 underline dark:text-neutral-200">
                  All
                </button>
                .
              </div>
            )}
          </div>
        </div>

        {/* Tooltip */}
        {tip && (
          <div
            style={{
              left: Math.min(tip.x + 14, widthPx - 280),
              top: tip.y + 16,
            }}
            className="pointer-events-none fixed z-50 max-w-[280px] rounded-md border border-neutral-200 bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/95"
          >
            <p className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{tip.title}</p>
            {tip.lines.map((l, i) => (
              <p key={i} className="text-[0.68rem] tabular-nums text-neutral-500 dark:text-neutral-400">
                {l}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
