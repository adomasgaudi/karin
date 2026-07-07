import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronsDown, ChevronsUp, PanelTopOpen } from 'lucide-react'
import type { TokenUsage } from '../types'
import { useKarin } from '../store/karin'
import { buildCycles, cycleUsage, cycleModelEffort } from '../lib/cycles'
import { fmtCompact } from '../lib/format'
import {
  CURRENCY_LABELS,
  UNIT_MODE_LABELS,
  currencyModes,
  ratesForSession,
  splitUsage,
  usageUnitTotal,
  type CurrencyMode,
  type UsageUnitMode,
} from '../lib/pricing'
import { APP_VERSION } from '../lib/appVersion'
import AgeIndicator from './AgeIndicator'
import Cycle from './Cycle'
import ContextAudit from './ContextAudit'
import DateStamp from './DateStamp'
import UsageBar from './UsageBar'

function Stat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.65rem] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</div>
      <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{value || 'n/a'}</div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-xs">
      <span className="text-neutral-400 dark:text-neutral-500">{label}</span>
      <span className="min-w-0 break-words text-neutral-700 dark:text-neutral-300">{value || 'n/a'}</span>
    </div>
  )
}

const unitModes: UsageUnitMode[] = ['tokens', 'token_units']

export default function SessionDetail() {
  const data = useKarin((s) => s.data)
  const selectedId = useKarin((s) => s.selectedId)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [unitMode, setUnitMode] = useState<UsageUnitMode>('tokens')
  const [currency, setCurrency] = useState<CurrencyMode>('usd')

  const s = data?.sessions.find((x) => x.id === selectedId)
  const cycles = useMemo(() => (s ? buildCycles(s) : []), [s])
  const u: TokenUsage = s?.latest_total_usage || {}
  const parts = splitUsage(u)
  const rates = s ? ratesForSession(s) : null
  // One shared ruler for the top session-total bar AND every cycle bar: the session total
  // is the running sum of each turn's usage, so scaling all bars against it keeps them
  // mutually proportional (top bar fills the track; each cycle is its true fraction).
  const scaleMax = Math.max(
    usageUnitTotal(u, rates, unitMode),
    ...cycles.map((c) => usageUnitTotal(cycleUsage(c), rates, unitMode)),
  )

  if (!s) {
    return (
      <div className="flex h-dvh flex-1 items-center justify-center p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a session to view its prompts, tools, and token usage.
      </div>
    )
  }

  function setAllOpen(mode: 'all' | 'none' | 'cycles') {
    const root = bodyRef.current
    if (!root) return
    root.querySelectorAll('details').forEach((el) => {
      if (mode === 'all') el.open = true
      else if (mode === 'none') el.open = false
      else el.open = el.classList.contains('cycle')
    })
  }

  return (
    <div className="flex h-dvh min-w-0 flex-col">
      <div className="shrink-0 border-b border-neutral-200/80 bg-white/90 p-3 shadow-sm shadow-neutral-950/[0.03] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/85 md:p-4">
        <button
          type="button"
          onClick={() => useKarin.getState().select(null)}
          className="mb-2 inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 md:hidden"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
              {s.title || s.id}
            </h1>
            <AgeIndicator value={s.updated_at} className="mt-1 text-base" />
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">Karin {APP_VERSION}</span>
              <span>updated <DateStamp value={s.updated_at} /></span>
              <span>{(s.models && s.models.length ? s.models.join(', ') : s.model) || 'model n/a'}</span>
              <span>effort {s.efforts && s.efforts.length ? s.efforts.join(', ') : (s.reasoning_effort || 'n/a')}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
            <Stat label="total" value={fmtCompact(parts.total)} />
            <Stat label="cached" value={fmtCompact(parts.cachedInput)} />
            <Stat label="tools" value={s.counts.tool_calls} />
            <Stat label="cycles" value={cycles.length} />
          </div>
        </div>

        <div className="mt-4">
          <UsageBar usage={u} rates={rates} mode={unitMode} currency={currency} scaleMax={scaleMax} />
          <div className="mt-2 flex max-w-full flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">graph</span>
            <div className="inline-flex max-w-full overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
              {unitModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setUnitMode(mode)}
                  className={`shrink-0 rounded-sm px-2 py-1 text-xs ${
                    unitMode === mode
                      ? 'bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-50'
                      : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100'
                  }`}
                >
                  {UNIT_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <div className="inline-flex max-w-full overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
              {currencyModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setCurrency(mode)}
                  className={`shrink-0 rounded-sm px-2 py-1 text-xs ${
                    currency === mode
                      ? 'bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-50'
                      : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100'
                  }`}
                >
                  {CURRENCY_LABELS[mode]}
                </button>
              ))}
            </div>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {rates ? `${rates.context} / $${rates.input}/$${rates.cached ?? rates.input}/$${rates.output} per 1M` : 'price n/a'}
            </span>
          </div>
        </div>

        <details className="mt-3 rounded-md border border-neutral-200 bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-900/55">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-700 [&::-webkit-details-marker]:hidden dark:text-neutral-300">
            <ChevronDown className="h-3.5 w-3.5" />
            Session metadata
          </summary>
          <div className="grid gap-1 border-t border-neutral-200 px-3 py-2 dark:border-neutral-800 md:grid-cols-2">
            <Meta label="id" value={s.id} />
            <Meta label="cwd" value={s.cwd} />
            <Meta label="codex" value={s.cli_version} />
            <Meta label="fast" value={s.fast_mode == null ? null : s.fast_mode ? 'on' : 'off'} />
            <Meta label="input" value={fmtCompact(u.input_tokens)} />
            <Meta label="cached" value={fmtCompact(u.cached_input_tokens)} />
            <Meta label="output" value={fmtCompact(u.output_tokens)} />
            <Meta label="reasoning" value={fmtCompact(u.reasoning_output_tokens)} />
            <Meta label="edits" value={s.counts.code_edits} />
            <Meta label="contexts" value={s.counts.contexts ?? 0} />
            <Meta label="runtime" value={s.counts.runtime_events ?? 0} />
            <Meta label="path" value={s.path} />
          </div>
        </details>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto p-3 md:p-4">
        <ContextAudit session={s} />

        <div className="mb-2 mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Prompt / Answer Cycles
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-500">
              {cycles.length} cycles / details open on demand
            </div>
          </div>

          <div className="flex max-w-full flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAllOpen('all')}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <ChevronsDown className="h-3.5 w-3.5" />
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setAllOpen('none')}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <ChevronsUp className="h-3.5 w-3.5" />
              Collapse
            </button>
            <button
              type="button"
              onClick={() => setAllOpen('cycles')}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <PanelTopOpen className="h-3.5 w-3.5" />
              Cycles only
            </button>
          </div>
        </div>

        {cycles.map((cycle, i) => {
          const { model, effort } = cycleModelEffort(cycle, s.turn_contexts)
          return (
            <Cycle key={i} cycle={cycle} index={i} rates={rates} unitMode={unitMode} currency={currency} scaleMax={scaleMax} model={model} effort={effort} />
          )
        })}
      </div>
    </div>
  )
}
