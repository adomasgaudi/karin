import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { UnifiedEntry, EntryUsage, StepDuration } from '../lib/unifiedCycles'
import { groupClaudeActions } from '../lib/unifiedCycles'
import type { ContextBlock, TokenUsage } from '../types'
import type { ClaudeContext } from '../lib/claudeModel'
import {
  addUsage,
  splitUsage,
  usageUnitTotal,
  TOKEN_UNIT_REF_LABELS,
  type CurrencyMode,
  type TokenRates,
  type TokenUnitRef,
  type UsageUnitMode,
} from '../lib/pricing'
import { fmtCompact, fmtCurrency } from '../lib/format'
import EventEntry, { SessionMetaGroup, isSessionMeta as entryIsSessionMeta } from './EventEntry'
import UsageBar from './UsageBar'

// Local style tokens mirror EventEntry's compact row look (kept here so the two files
// don't have to cross-import private constants while both are under active edit).
const rowBase = 'overflow-hidden border-l-2 border-b border-b-neutral-100 dark:border-b-neutral-900/70'
const summaryClass =
  'flex cursor-pointer select-none list-none items-center gap-1.5 px-2 py-1 text-xs marker:hidden [&::-webkit-details-marker]:hidden hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'

function Chevron() {
  return (
    <ChevronRight className="h-3 w-3 shrink-0 text-neutral-400 transition-transform [[open]_&]:rotate-90 dark:text-neutral-500" />
  )
}

// Shared display props threaded to every leaf row.
export interface BandDisplay {
  rates: TokenRates | null
  unitMode: UsageUnitMode
  currency: CurrencyMode
  tokenRef: TokenUnitRef
  scaleMax: number
  entryUsage: Map<UnifiedEntry, EntryUsage>
  steps: Map<UnifiedEntry, StepDuration>
  numFor: Map<UnifiedEntry, number>
}

function leafRow(entry: UnifiedEntry, d: BandDisplay) {
  return (
    <EventEntry
      key={d.numFor.get(entry)}
      entry={entry}
      num={d.numFor.get(entry) ?? 0}
      usage={d.entryUsage.get(entry)}
      step={d.steps.get(entry)}
      rates={d.rates}
      unitMode={d.unitMode}
      currency={d.currency}
      tokenRef={d.tokenRef}
      scaleMax={d.scaleMax}
    />
  )
}

// A token figure in the active unit mode — the label every claude group carries.
function figure(usage: TokenUsage | null, d: BandDisplay): string {
  const total = splitUsage(usage).total
  if (total <= 0) return ''
  if (d.unitMode === 'money' && d.rates != null) return fmtCurrency(usageUnitTotal(usage, d.rates, d.unitMode, d.tokenRef), d.currency)
  if (d.unitMode === 'token_units' && d.rates != null)
    return `${fmtCompact(usageUnitTotal(usage, d.rates, d.unitMode, d.tokenRef))} ${TOKEN_UNIT_REF_LABELS[d.tokenRef]}`
  return `${fmtCompact(total)} tok`
}

function contextChars(entry: UnifiedEntry): number {
  return entry.kind === 'context' ? (entry.item as ContextBlock | ClaudeContext).chars || 0 : 0
}

// --- Hooks band: injected context the AI did not choose --------------------
// Collapsed by default (low signal). Consecutive session-state blocks fold into one
// SessionMetaGroup; the rest render as their normal (dimmed) context rows.
export function HooksBand({ entries, d }: { entries: UnifiedEntry[]; d: BandDisplay }) {
  const totalChars = entries.reduce((s, e) => s + contextChars(e), 0)
  const nodes: ReactNode[] = []
  let metaRun: UnifiedEntry[] = []
  let metaNum = 0
  const flushMeta = () => {
    if (metaRun.length === 0) return
    if (metaRun.length === 1) nodes.push(leafRow(metaRun[0], d))
    else nodes.push(<SessionMetaGroup key={`meta-${metaNum}`} entries={metaRun} num={metaNum} />)
    metaRun = []
  }
  for (const e of entries) {
    if (entryIsSessionMeta(e)) {
      if (metaRun.length === 0) metaNum = d.numFor.get(e) ?? 0
      metaRun.push(e)
      continue
    }
    flushMeta()
    nodes.push(leafRow(e, d))
  }
  flushMeta()

  return (
    <details className={`${rowBase} border-l-neutral-300 opacity-70 dark:border-l-neutral-700`}>
      <summary className={summaryClass}>
        <Chevron />
        <span className="shrink-0 font-medium italic text-neutral-500 dark:text-neutral-400">context</span>
        <span className="min-w-0 flex-1 truncate font-normal italic text-neutral-400 dark:text-neutral-500">
          {entries.length} · {fmtCompact(totalChars)} chars
        </span>
      </summary>
      <div className="pb-1">{nodes}</div>
    </details>
  )
}

// --- Claude block: everything the AI chose, grouped by usage frame ----------
// Each group = one API call's worth of actions, headed by the tokens that call spent.
export function ClaudeBlock({
  entries,
  sourceLabel,
  model,
  d,
}: {
  entries: UnifiedEntry[]
  sourceLabel: string
  model?: string | null
  d: BandDisplay
}) {
  const groups = groupClaudeActions(entries)
  const total = groups.reduce<TokenUsage>((s, g) => addUsage(s, g.usage ?? {}), {})
  const totalFig = figure(total, d)

  return (
    <details open className={`${rowBase} border-l-emerald-400`}>
      <summary className={summaryClass}>
        <Chevron />
        <span className="shrink-0 font-semibold text-neutral-800 dark:text-neutral-100">{sourceLabel}:</span>
        {model && (
          <span className="shrink-0 rounded-sm bg-neutral-200/80 px-1 py-0.5 text-[0.5rem] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            {model}
          </span>
        )}
        {totalFig && (
          <span className="ml-auto shrink-0 whitespace-nowrap pl-2 font-mono text-[0.6rem] text-neutral-500 dark:text-neutral-400">
            {totalFig}
          </span>
        )}
      </summary>
      <div className="pb-1 pl-2">
        {groups.map((g, gi) => {
          const fig = figure(g.usage, d)
          const has = splitUsage(g.usage).total > 0
          return (
            <div key={gi} className="border-l border-neutral-200/70 pl-1 dark:border-neutral-800/70">
              {/* Group token header — the usage frame that closed this group, no longer a row of its own. */}
              <div className="flex items-center gap-2 py-1 pl-6 pr-2">
                <span className="shrink-0 text-[0.55rem] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  step {gi + 1}
                </span>
                {has && (
                  <div className="min-w-0 flex-1">
                    <UsageBar usage={g.usage!} rates={d.rates} mode={d.unitMode} currency={d.currency} tokenRef={d.tokenRef} compact inlineLabels scaleMax={d.scaleMax} />
                  </div>
                )}
                <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[0.6rem] text-neutral-500 dark:text-neutral-400">
                  {fig || (g.measured ? '0 tok' : 'no frame')}
                </span>
              </div>
              {g.actions.map((a) => leafRow(a, d))}
            </div>
          )
        })}
      </div>
    </details>
  )
}
