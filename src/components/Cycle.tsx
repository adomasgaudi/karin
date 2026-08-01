import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Braces } from 'lucide-react'
import { useKarin } from '../store/karin'
import type { SessionSource } from '../types'
import type { Cycle as CycleData, UnifiedEntry } from '../lib/unifiedCycles'
import { attributeCycleUsage, cycleOrigin, cyclePrompt, cycleStepCount, cycleUsage, entryBand, isContextOnlyCycle, stepDurations } from '../lib/unifiedCycles'
import type { CurrencyMode, TokenRates, TokenUnitRef, UsageUnitMode } from '../lib/pricing'
import { splitUsage, usageUnitTotal } from '../lib/pricing'
import EventEntry from './EventEntry'
import { HooksBand, ActionBand, type BandDisplay } from './CycleBands'
import UsageBar from './UsageBar'
import RawJson from './RawJson'

// Colour + label per touchpoint kind: owner prompt (neutral), mid-turn interjection
// (amber), answer to an AI question (violet). 'context' cycles show no tag.
const ORIGIN_TAG: Record<'prompt' | 'interjection' | 'answer', { label: string; cls: string }> = {
  prompt: { label: 'owner', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300' },
  interjection: { label: 'interjected', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  answer: { label: 'answer', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300' },
}

export default function Cycle({
  cycle,
  source,
  rates,
  unitMode,
  currency,
  tokenRef,
  tokenMult,
  scaleMax,
  singleModel,
}: {
  cycle: CycleData
  source: SessionSource
  rates: TokenRates | null
  unitMode: UsageUnitMode
  currency: CurrencyMode
  tokenRef: TokenUnitRef
  tokenMult?: number
  scaleMax?: number
  singleModel?: boolean
}) {
  const usage = cycleUsage(cycle)
  const hasUsage = splitUsage(usage).total > 0
  // Per-entry token usage: Codex → estimates (share of the turn's measured total, weighted
  // by text length); Claude → measured usage frames only.
  const entryUsage = useMemo(() => attributeCycleUsage(cycle, source), [cycle, source])
  // Per-card step durations feed each event's own chip.
  const steps = useMemo(() => stepDurations(cycle), [cycle])
  const stepCount = useMemo(() => cycleStepCount(cycle), [cycle])
  // Each card's bar scales against the cycle total, so a card's fill = its fraction of the cycle.
  const cardScaleMax = usageUnitTotal(usage, rates, unitMode, tokenRef, tokenMult)
  // A context-only cycle carries no owner prompt — gray it down so the real
  // prompt/answer cycles stay visually dominant.
  const contextOnly = isContextOnlyCycle(cycle)
  const showStepCounts = useKarin((s) => s.showStepCounts)
  // Whole-cycle raw view: swaps every card in this cycle for the untouched records
  // behind them. Same idea as a step's Raw JSON switch, one level up.
  const [rawCycle, setRawCycle] = useState(false)
  const rawItems = useMemo(() => {
    if (!rawCycle) return []
    const seen = new Set<string>()
    return cycle.items.flatMap((entry) => {
      const key = entry.raw ? `raw:${entry.raw._line}` : `entry:${entry.kind}:${entry.line}:${entry.index}`
      if (seen.has(key)) return []
      seen.add(key)
      return [entry.raw ?? entry.item]
    })
  }, [rawCycle, cycle])
  // The button now sits in the body, so it no longer has to fight <summary>'s
  // click-to-collapse — the cycle is already open whenever it is reachable.
  const toggleRaw = () => setRawCycle((prev) => !prev)
  // Accordion: expanding a step row closes this cycle's other open steps, unless the
  // owner opted out in settings. `toggle` doesn't bubble, so listen in capture phase.
  const keepStepsOpen = useKarin((s) => s.keepStepsOpen)
  const eventsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = eventsRef.current
    if (!node || keepStepsOpen) return
    const onToggle = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLDetailsElement) || !target.open || !target.hasAttribute('data-step-row')) return
      for (const other of node.querySelectorAll<HTMLDetailsElement>('details[data-step-row][open]')) {
        // Leave ancestors/descendants alone (a subagent's inner steps live inside a row).
        if (other !== target && !other.contains(target) && !target.contains(other)) other.open = false
      }
    }
    node.addEventListener('toggle', onToggle, true)
    return () => node.removeEventListener('toggle', onToggle, true)
  }, [keepStepsOpen])
  // What human touchpoint opened this cycle: a fresh prompt, a mid-turn interjection,
  // or the owner's answer to an AI question. A small tag makes the shape legible.
  const origin = cycleOrigin(cycle)
  const prompt = cyclePrompt(cycle)
  const promptRef = useRef<HTMLSpanElement>(null)
  const [promptOverflows, setPromptOverflows] = useState(false)
  useLayoutEffect(() => {
    const node = promptRef.current
    if (!node) return
    const measure = () => setPromptOverflows(node.scrollWidth > node.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [prompt])
  // The cycle title already names a cycle containing only its opening prompt. Do not
  // repeat that same prompt as the sole child when there is no additional cycle data.
  const onlyPromptCycle =
    cycle.items.length === 1 &&
    cycle.items[0]?.kind === 'message' &&
    (cycle.items[0].item as { role?: string }).role === 'user'
  const hideOnlyPrompt = onlyPromptCycle && !promptOverflows

  // Split the cycle into authorship bands: each human touchpoint is its own row, the
  // injected context it did not choose folds into a hooks band, and everything the AI
  // chose folds into an action band (grouped by usage frame). Order within a segment is
  // human → hooks → AI, per the owner's layout.
  // Badge each structured item with its raw JSONL line number (== the ordinal shown in the
  // Raw pane), so every part of the structured view can be traced back to the raw record.
  const numFor = useMemo(() => {
    const m = new Map<UnifiedEntry, number>()
    cycle.items.forEach((e) => m.set(e, e.line))
    return m
  }, [cycle])
  const display: BandDisplay = { source, rates, unitMode, currency, tokenRef, tokenMult, scaleMax: cardScaleMax, singleModel, entryUsage, steps, numFor }
  const eventNodes: ReactNode[] = []
  let hooksBuf: UnifiedEntry[] = []
  let aiBuf: UnifiedEntry[] = []
  let seg = 0
  const flushBands = () => {
    if (hooksBuf.length) {
      eventNodes.push(<HooksBand key={`hooks-${seg}`} entries={hooksBuf} d={display} />)
      hooksBuf = []
    }
    if (aiBuf.length) {
      eventNodes.push(<ActionBand key={`ai-${seg}`} entries={aiBuf} sourceLabel={source} d={display} />)
      aiBuf = []
    }
    seg++
  }
  for (const entry of cycle.items) {
    if (hideOnlyPrompt) continue
    const band = entryBand(entry)
    if (band === 'human') {
      flushBands()
      eventNodes.push(
        <EventEntry
          key={`human-${numFor.get(entry)}`}
          entry={entry}
          usage={entryUsage.get(entry)}
          step={steps.get(entry)}
          rates={rates}
          unitMode={unitMode}
          currency={currency}
          tokenRef={tokenRef}
          scaleMax={cardScaleMax}
        />,
      )
    } else if (band === 'hooks') {
      hooksBuf.push(entry)
    } else {
      aiBuf.push(entry)
    }
  }
  flushBands()

  // No border or ring: a card per cycle drew a grid of outlines down the page. The card
  // is defined by its fill alone, and lifts on hover or once opened.
  return (
    <details
      className={`cycle group mb-[3px] rounded-md transition-[margin,box-shadow] open:mb-[11px] hover:shadow-md open:shadow-md open:ring-1 open:ring-neutral-200 dark:open:ring-neutral-800 ${
        contextOnly ? 'bg-white dark:bg-neutral-900' : 'bg-white dark:bg-neutral-900/80'
      }`}
    >
      <summary className="flex cursor-pointer select-none flex-col gap-[3px] rounded-t-md px-1 py-[3px] text-xs [&::-webkit-details-marker]:hidden hover:bg-neutral-50 group-open:sticky group-open:top-0 group-open:z-10 group-open:border-b group-open:border-neutral-200 group-open:bg-white/95 group-open:backdrop-blur dark:hover:bg-neutral-800/60 dark:group-open:border-neutral-800 dark:group-open:bg-neutral-900/95">
        {/* No ordinal badge: the cycles are already in order down the page, so a number
            on each one was a column of noise beside every prompt. */}
        <div className="flex min-w-0 items-center gap-1">
          {origin !== 'context' && origin !== 'prompt' && !contextOnly && (
            <span className={`shrink-0 rounded-sm px-[2px] py-[1px] text-[0.62rem] font-medium uppercase tracking-wide ${ORIGIN_TAG[origin].cls}`}>
              {ORIGIN_TAG[origin].label}
            </span>
          )}
          <span
            ref={promptRef}
            className={`min-w-0 flex-1 truncate ${
              contextOnly
                ? 'text-[0.7rem] font-normal italic text-neutral-500 dark:text-neutral-400'
                : 'font-medium text-neutral-900 dark:text-neutral-100'
            }`}
          >
            {prompt}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              toggleRaw()
            }}
            aria-label={rawCycle ? 'Back to the structured cycle' : 'View this cycle as raw JSON'}
            title={rawCycle ? 'Back to the structured cycle' : 'View this cycle as raw JSON'}
            className={`hidden shrink-0 items-center rounded-sm p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 group-open:inline-flex dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 ${
              rawCycle ? 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-100' : ''
            }`}
          >
            <Braces className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Step count and token squares read as one measurement of the cycle's size, so
            they share a line — the count first, then the weight it produced. */}
        <div className="flex min-w-0 items-center gap-1.5">
          {showStepCounts && (
            <span
              className="shrink-0 whitespace-nowrap font-mono text-[0.62rem] text-neutral-500 dark:text-neutral-400"
              title="Meaningful AI work entries in this cycle"
            >
              {stepCount} {stepCount === 1 ? 'step' : 'steps'}
            </span>
          )}
          {hasUsage && (
            <UsageBar usage={usage} rates={rates} mode={unitMode} currency={currency} tokenMult={tokenMult} tokenRef={tokenRef} compact bare showLegend={false} scaleMax={scaleMax} />
          )}
        </div>
      </summary>
      {/* This remains part of the cycle card: opening the title grows its original
          surface rather than revealing a second, separately tinted content card. */}
      <div className="rounded-b-md px-[3px] pb-[3px] pt-1">
        {/* Indent + left guide so the cards read as nested inside this cycle. */}
        {rawCycle ? (
          <div className="max-h-[36rem] overflow-y-auto rounded-md bg-white dark:bg-neutral-950">
            <RawJson value={rawItems} />
          </div>
        ) : (
          <div ref={eventsRef} className="ml-[1px] pl-[3px]">
            {eventNodes}
          </div>
        )}
        {/* Explicit boundary so a long expanded cycle has an unmistakable end. */}
        <div className="mt-[3px] flex items-center gap-[3px] px-[1px] text-[0.6rem] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          end of cycle
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </div>
      </div>
    </details>
  )
}
