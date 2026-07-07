import type { Cycle as CycleData } from '../lib/cycles'
import { cycleCounts, cyclePrompt, cycleUsage } from '../lib/cycles'
import { fmtCompact, fmtCurrency } from '../lib/format'
import type { CurrencyMode, TokenRates, UsageUnitMode } from '../lib/pricing'
import { splitUsage, usageCost } from '../lib/pricing'
import EventEntry from './EventEntry'
import UsageBar from './UsageBar'

export default function Cycle({
  cycle,
  index,
  rates,
  unitMode,
  currency,
  scaleMax,
  model,
  effort,
}: {
  cycle: CycleData
  index: number
  rates: TokenRates | null
  unitMode: UsageUnitMode
  currency: CurrencyMode
  scaleMax?: number
  model?: string | null
  effort?: string | null
}) {
  const usage = cycleUsage(cycle)
  const parts = splitUsage(usage)
  const hasUsage = parts.total > 0
  const cost = usageCost(parts, rates)

  return (
    <details className="cycle group mb-2 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-sm shadow-neutral-950/[0.02] dark:border-neutral-800 dark:bg-neutral-900/80">
      <summary className="flex cursor-pointer select-none flex-col gap-2 px-3 py-2.5 text-xs [&::-webkit-details-marker]:hidden hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-sm bg-neutral-100 px-1.5 py-0.5 font-mono text-[0.68rem] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-neutral-900 dark:text-neutral-100">
            {cyclePrompt(cycle)}
          </span>
          {(model || effort) && (
            <span className="shrink-0 whitespace-nowrap text-[0.6rem] text-neutral-400 dark:text-neutral-500">
              {model || 'model n/a'}{effort ? ` · ${effort}` : ''}
            </span>
          )}
        </div>
        {hasUsage && (
          <UsageBar usage={usage} rates={rates} mode={unitMode} currency={currency} compact showLegend={false} scaleMax={scaleMax} />
        )}
      </summary>
      <div className="border-t border-neutral-100 p-2 dark:border-neutral-800/80">
        <div className="mb-2 flex flex-wrap gap-x-2 gap-y-1 px-1 text-[0.68rem] text-neutral-500 dark:text-neutral-400">
          <span>line {cycle.startLine}</span>
          <span>{cycleCounts(cycle) || 'empty'}</span>
          {hasUsage && <span>{fmtCompact(parts.total)} tokens</span>}
          {cost != null && <span>{fmtCurrency(cost, currency)}</span>}
        </div>
        {hasUsage && (
          <div className="mb-2 rounded-md bg-neutral-50 px-2 py-2 dark:bg-neutral-950/60">
            <UsageBar usage={usage} rates={rates} mode={unitMode} currency={currency} compact scaleMax={scaleMax} />
          </div>
        )}
        {cycle.items.map((entry, i) => (
          <EventEntry key={i} entry={entry} />
        ))}
      </div>
    </details>
  )
}
