import type { TokenUsage } from '../types'
import { fmtCompact, fmtCurrency } from '../lib/format'
import {
  splitUsage,
  usageCost,
  usageUnitValue,
  type CurrencyMode,
  type TokenRates,
  type UsageUnitMode,
} from '../lib/pricing'

export default function UsageBar({
  usage,
  rates,
  mode,
  currency = 'usd',
  compact = false,
  showLegend = true,
  scaleMax,
}: {
  usage: TokenUsage
  rates: TokenRates | null
  mode: UsageUnitMode
  currency?: CurrencyMode
  compact?: boolean
  showLegend?: boolean
  // When set, segment widths are drawn relative to this value (the session-total bar)
  // instead of the bar's own total, so cycles are proportional to the top bar.
  scaleMax?: number
}) {
  const parts = splitUsage(usage)
  const cost = usageCost(parts, rates)
  const segments = [
    { key: 'freshInput' as const, label: 'input', raw: parts.freshInput, className: 'bg-sky-500' },
    { key: 'cachedInput' as const, label: 'cached', raw: parts.cachedInput, className: 'bg-emerald-500' },
    { key: 'output' as const, label: 'output', raw: parts.output, className: 'bg-amber-500' },
    { key: 'reasoning' as const, label: 'reasoning', raw: parts.reasoning, className: 'bg-fuchsia-500' },
  ]
    .map((segment) => ({ ...segment, value: usageUnitValue(segment.raw, segment.key, rates, mode) }))
    .filter((segment) => segment.raw > 0)
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const denom = scaleMax && scaleMax > 0 ? scaleMax : total
  // In token_units mode segment.value is a USD cost; render it in the chosen currency.
  const priced = mode === 'token_units' && rates != null
  const fmtSeg = (segment: { raw: number; value: number }) =>
    priced ? fmtCurrency(segment.value, currency) : fmtCompact(segment.raw)

  return (
    <div className={compact ? 'min-w-0' : 'mt-3 max-w-4xl'}>
      <div className={`flex overflow-hidden rounded-sm bg-neutral-200 dark:bg-neutral-800 ${compact ? 'h-2' : 'h-3'}`}>
        {total > 0 ? (
          segments.map((segment) => (
            <div
              key={segment.key}
              className={segment.className}
              style={{ width: `${(segment.value / denom) * 100}%` }}
              title={`${segment.label}: ${fmtCompact(segment.raw)} tokens${priced ? `; ${fmtCurrency(segment.value, currency)}` : ''}`}
            />
          ))
        ) : (
          <div className="h-full w-full bg-neutral-300 dark:bg-neutral-700" />
        )}
      </div>
      {showLegend && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          {segments.map((segment) => (
            <span key={segment.key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-sm ${segment.className}`} />
              {segment.label} {fmtSeg(segment)}
            </span>
          ))}
          <span className="font-medium text-neutral-700 dark:text-neutral-300">
            {priced
              ? `total ${fmtCurrency(total, currency)}`
              : `total ${fmtCompact(parts.total)} tokens${cost == null ? '' : ` / ${fmtCurrency(cost, currency)}`}`}
          </span>
        </div>
      )}
    </div>
  )
}
