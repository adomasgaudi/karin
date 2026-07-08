import { useMemo, type ReactNode } from 'react'
import type { SessionSource } from '../types'
import type { Cycle as CycleData, UnifiedEntry } from '../lib/unifiedCycles'
import { attributeCycleUsage, cycleCounts, cycleOrigin, cyclePrompt, cycleTiming, cycleUsage, entryBand, isContextOnlyCycle, stepDurations } from '../lib/unifiedCycles'
import { fmtClock, fmtCompact, fmtCurrency, fmtDuration } from '../lib/format'
import type { CurrencyMode, TokenRates, TokenUnitRef, UsageUnitMode } from '../lib/pricing'
import { splitUsage, usageCost, usageUnitTotal } from '../lib/pricing'
import EventEntry from './EventEntry'
import { HooksBand, ClaudeBlock, type BandDisplay } from './CycleBands'
import UsageBar from './UsageBar'

// Colour + label per touchpoint kind: owner prompt (neutral), mid-turn interjection
// (amber), answer to an AI question (violet). 'context' cycles show no tag.
const ORIGIN_TAG: Record<'prompt' | 'interjection' | 'answer', { label: string; cls: string }> = {
  prompt: { label: 'owner', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300' },
  interjection: { label: 'interjected', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  answer: { label: 'answer', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300' },
}

export default function Cycle({
  cycle,
  index,
  source,
  rates,
  unitMode,
  currency,
  tokenRef,
  tokenMult,
  scaleMax,
  model,
  effort,
}: {
  cycle: CycleData
  index: number
  source: SessionSource
  rates: TokenRates | null
  unitMode: UsageUnitMode
  currency: CurrencyMode
  tokenRef: TokenUnitRef
  tokenMult?: number
  scaleMax?: number
  model?: string | null
  effort?: string | null
}) {
  const usage = cycleUsage(cycle)
  const parts = splitUsage(usage)
  const hasUsage = parts.total > 0
  const cost = usageCost(parts, rates)
  // Per-entry token usage: Codex → estimates (share of the turn's measured total, weighted
  // by text length); Claude → measured usage frames only.
  const entryUsage = useMemo(() => attributeCycleUsage(cycle, source), [cycle, source])
  // Per-cycle wall-clock: start/end plus working (excl. owner deliberation) and
  // total (incl.) spans; per-card step durations feed each event's own chip.
  const timing = useMemo(() => cycleTiming(cycle), [cycle])
  const steps = useMemo(() => stepDurations(cycle), [cycle])
  const hasWait = timing.waitMs != null && timing.waitMs > 1000
  // Each card's bar scales against the cycle total, so a card's fill = its fraction of the cycle.
  const cardScaleMax = usageUnitTotal(usage, rates, unitMode, tokenRef, tokenMult)
  // A context-only cycle carries no owner prompt — gray it down so the real
  // prompt/answer cycles stay visually dominant.
  const contextOnly = isContextOnlyCycle(cycle)
  // What human touchpoint opened this cycle: a fresh prompt, a mid-turn interjection,
  // or the owner's answer to an AI question. A small tag makes the shape legible.
  const origin = cycleOrigin(cycle)

  // Split the cycle into authorship bands: each human touchpoint is its own row, the
  // injected context it did not choose folds into a hooks band, and everything the AI
  // chose folds into a claude block (grouped by usage frame). Order within a segment is
  // human → hooks → claude, per the owner's layout.
  const numFor = useMemo(() => {
    const m = new Map<UnifiedEntry, number>()
    cycle.items.forEach((e, i) => m.set(e, i + 1))
    return m
  }, [cycle])
  const display: BandDisplay = { rates, unitMode, currency, tokenRef, tokenMult, scaleMax: cardScaleMax, entryUsage, steps, numFor }
  const eventNodes: ReactNode[] = []
  let hooksBuf: UnifiedEntry[] = []
  let claudeBuf: UnifiedEntry[] = []
  let seg = 0
  const flushBands = () => {
    if (hooksBuf.length) {
      eventNodes.push(<HooksBand key={`hooks-${seg}`} entries={hooksBuf} d={display} />)
      hooksBuf = []
    }
    if (claudeBuf.length) {
      eventNodes.push(<ClaudeBlock key={`claude-${seg}`} entries={claudeBuf} sourceLabel={source} model={model} d={display} />)
      claudeBuf = []
    }
    seg++
  }
  for (const entry of cycle.items) {
    const band = entryBand(entry)
    if (band === 'human') {
      flushBands()
      eventNodes.push(
        <EventEntry
          key={`human-${numFor.get(entry)}`}
          num={numFor.get(entry) ?? 0}
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
      claudeBuf.push(entry)
    }
  }
  flushBands()

  return (
    <details
      className={`cycle group mb-2 rounded-md border shadow-sm shadow-neutral-950/[0.02] transition-[margin] open:mb-8 open:shadow-md ${
        contextOnly
          ? 'border-neutral-200/70 bg-neutral-50/50 opacity-70 dark:border-neutral-800/70 dark:bg-neutral-900/40'
          : 'border-neutral-200 bg-white open:border-neutral-300 open:ring-1 open:ring-neutral-200 dark:border-neutral-800 dark:bg-neutral-900/80 dark:open:border-neutral-700 dark:open:ring-neutral-800'
      }`}
    >
      <summary className="flex cursor-pointer select-none flex-col gap-2 rounded-t-md px-3 py-2.5 text-xs [&::-webkit-details-marker]:hidden hover:bg-neutral-50 group-open:sticky group-open:top-0 group-open:z-10 group-open:border-b group-open:border-neutral-200 group-open:bg-white/95 group-open:backdrop-blur dark:hover:bg-neutral-800/60 dark:group-open:border-neutral-800 dark:group-open:bg-neutral-900/95">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-sm bg-neutral-100 px-1.5 py-0.5 font-mono text-[0.68rem] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {index + 1}
          </span>
          {origin !== 'context' && !contextOnly && (
            <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-wide ${ORIGIN_TAG[origin].cls}`}>
              {ORIGIN_TAG[origin].label}
            </span>
          )}
          <span
            className={`min-w-0 flex-1 truncate ${
              contextOnly
                ? 'text-[0.7rem] font-normal italic text-neutral-400 dark:text-neutral-500'
                : 'font-medium text-neutral-900 dark:text-neutral-100'
            }`}
          >
            {cyclePrompt(cycle)}
          </span>
          {timing.workingMs != null && (
            <span
              className="shrink-0 whitespace-nowrap font-mono text-[0.62rem] text-neutral-500 dark:text-neutral-400"
              title={`Working time (AI churning, excludes waiting on you)${hasWait ? ` · ${fmtDuration(timing.totalMs)} total incl. your ${fmtDuration(timing.waitMs)} to answer` : ''}`}
            >
              ⏱ {fmtDuration(timing.workingMs)}
            </span>
          )}
          {(model || effort) && (
            <span className="shrink-0 whitespace-nowrap text-[0.6rem] text-neutral-400 dark:text-neutral-500">
              {model || 'model n/a'}{effort ? ` · ${effort}` : ''}
            </span>
          )}
        </div>
        {hasUsage && (
          <UsageBar usage={usage} rates={rates} mode={unitMode} currency={currency} tokenRef={tokenRef} tokenMult={tokenMult} compact showLegend={false} scaleMax={scaleMax} />
        )}
      </summary>
      <div className="rounded-b-md border-t border-neutral-100 bg-neutral-50/50 p-2 dark:border-neutral-800/80 dark:bg-neutral-950/30">
        <div className="mb-2 flex flex-wrap gap-x-2 gap-y-1 px-1 text-[0.68rem] text-neutral-500 dark:text-neutral-400">
          <span>line {cycle.startLine}</span>
          {timing.startMs != null && (
            <span title="When this cycle started → when it ended (wall clock)">
              {fmtClock(timing.workStartMs ?? timing.startMs)} → {fmtClock(timing.endMs)}
            </span>
          )}
          {timing.workingMs != null && (
            <span className="font-medium text-neutral-600 dark:text-neutral-300" title="AI working time — excludes any time waiting on you">
              working {fmtDuration(timing.workingMs)}
            </span>
          )}
          {timing.totalMs != null && (
            <span title="Total wall-clock span, including any time you spent answering">
              total {fmtDuration(timing.totalMs)}
            </span>
          )}
          {hasWait && (
            <span className="text-violet-500 dark:text-violet-400" title="Time you spent answering the AI's question — not counted as working time">
              {fmtDuration(timing.waitMs)} waiting on you
            </span>
          )}
          <span>{cycleCounts(cycle) || 'empty'}</span>
          {hasUsage && <span>{fmtCompact(parts.total)} tokens</span>}
          {cost != null && <span>{fmtCurrency(cost, currency)}</span>}
        </div>
        {/* Expanded view: this bar fills full width (scaled to the cycle's own total),
            and every card bar below is proportional to it via the same cardScaleMax. */}
        {hasUsage && (
          <div className="mb-2 rounded-md bg-neutral-50 px-2 py-2 dark:bg-neutral-950/60">
            <UsageBar usage={usage} rates={rates} mode={unitMode} currency={currency} tokenRef={tokenRef} tokenMult={tokenMult} compact inlineLabels scaleMax={cardScaleMax} />
          </div>
        )}
        {/* Indent + left guide so the cards read as nested inside this cycle. */}
        <div className="ml-1 border-l-2 border-neutral-200/80 pl-2 dark:border-neutral-800">
          {eventNodes}
        </div>
        {/* Explicit boundary so a long expanded cycle has an unmistakable end. */}
        <div className="mt-2 flex items-center gap-2 px-1 text-[0.6rem] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          end of cycle {index + 1}
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </div>
      </div>
    </details>
  )
}
