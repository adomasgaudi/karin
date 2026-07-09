import type { TokenUsage } from '../types'
import { fmtCompact, fmtCurrency } from '../lib/format'
import {
  splitUsage,
  usageCost,
  usageUnitValue,
  TOKEN_UNIT_REF_LABELS,
  type CurrencyMode,
  type TokenRates,
  type TokenUnitRef,
  type UsageUnitMode,
} from '../lib/pricing'

export default function UsageBar({
  usage,
  rates,
  mode,
  currency = 'usd',
  tokenRef = 'output',
  tokenMult,
  compact = false,
  showLegend = true,
  inlineLabels = false,
  thin = false,
  scaleMax,
  estimated = false,
}: {
  usage: TokenUsage
  rates: TokenRates | null
  mode: UsageUnitMode
  currency?: CurrencyMode
  // Reference token type for token_units mode (which type = 1.0).
  tokenRef?: TokenUnitRef
  // Multiplier for the 'scaled' reference.
  tokenMult?: number
  compact?: boolean
  showLegend?: boolean
  // A minimal ~4px bar with no labels/legend — the always-visible collapsed indicator.
  thin?: boolean
  // Draw each segment's label + value inside the bar itself (no dot legend below).
  inlineLabels?: boolean
  // When set, segment widths are drawn relative to this value (the session-total bar)
  // instead of the bar's own total, so cycles are proportional to the top bar.
  scaleMax?: number
  // Estimated (not measured) usage: render hatched + faded + dashed so it reads as a
  // guess, not a real recorded number.
  estimated?: boolean
}) {
  const parts = splitUsage(usage)
  const cost = usageCost(parts, rates)
  const segments = [
    { key: 'freshInput' as const, label: 'input', raw: parts.freshInput, className: 'bg-sky-500' },
    { key: 'cachedInput' as const, label: 'cached', raw: parts.cachedInput, className: 'bg-emerald-500' },
    { key: 'cacheCreate' as const, label: 'cache write', raw: parts.cacheCreate, className: 'bg-violet-500' },
    { key: 'output' as const, label: 'output', raw: parts.output, className: 'bg-amber-500' },
    { key: 'reasoning' as const, label: 'reasoning', raw: parts.reasoning, className: 'bg-fuchsia-500' },
  ]
    .map((segment) => ({ ...segment, value: usageUnitValue(segment.raw, segment.key, rates, mode, tokenRef, tokenMult) }))
    .filter((segment) => segment.raw > 0)
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const denom = scaleMax && scaleMax > 0 ? scaleMax : total
  // Money mode renders segment.value as currency; tokens / token-units render it as a
  // token count (raw, or reference-equivalent). refSuffix labels the token-units unit.
  const isMoney = mode === 'money' && rates != null
  const refSuffix = mode === 'token_units' && rates != null ? ` ${TOKEN_UNIT_REF_LABELS[tokenRef]}` : ''
  // A source may report a total without the per-type split that `parts` sums (Warp gives
  // one cumulative scalar per model). Fall back to that total so the bar's label isn't 0.
  const tokenTotal = parts.total || usage?.total_tokens || 0
  const fmtSeg = (segment: { raw: number; value: number }) =>
    isMoney ? fmtCurrency(segment.value, currency) : fmtCompact(segment.value)
  // Inline-label bars need enough height to hold text; compact ones sit a touch
  // shorter than the top session bar (h-6) but still readable.
  const barHeight = thin ? 'h-1' : inlineLabels ? (compact ? 'h-5' : 'h-6') : compact ? 'h-2' : 'h-3'
  // Diagonal hatch overlaid on each segment's colour so estimated bars read as "not real".
  const hatch = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0, rgba(255,255,255,0.45) 2px, transparent 2px, transparent 5px)'

  return (
    <div className={compact ? 'min-w-0' : 'max-w-4xl'}>
      <div
        className={`flex overflow-hidden rounded-sm bg-neutral-200 dark:bg-neutral-800 ${barHeight} ${
          estimated ? 'opacity-70 outline-dashed outline-1 outline-offset-[-1px] outline-neutral-400/70 dark:outline-neutral-500/60' : ''
        }`}
      >
        {total > 0 ? (
          segments.map((segment) => {
            const frac = segment.value / denom
            return (
              <div
                key={segment.key}
                className={`flex items-center overflow-hidden whitespace-nowrap ${segment.className}`}
                style={{ width: `${frac * 100}%`, ...(estimated ? { backgroundImage: hatch } : null) }}
                title={`${estimated ? '≈ estimated ' : ''}${segment.label}: ${fmtCompact(segment.raw)} tokens${mode === 'money' && rates ? `; ${fmtCurrency(segment.value, currency)}` : mode === 'token_units' && rates ? `; ${fmtCompact(segment.value)}${refSuffix}` : ''}`}
              >
                {inlineLabels && frac >= 0.07 && (
                  <span className={`${compact ? 'px-1 text-[0.6rem]' : 'px-1.5 text-[0.68rem]'} font-medium leading-none text-white/95`}>
                    {segment.label} {fmtSeg(segment)}
                  </span>
                )}
              </div>
            )
          })
        ) : (
          <div className="h-full w-full bg-neutral-300 dark:bg-neutral-700" />
        )}
      </div>
      {inlineLabels ? (
        // The compact (cycle/card) bars carry their total elsewhere, so only the
        // full-size top bar prints a total line under itself.
        !compact && (
          <div className="mt-1 text-xs font-medium text-neutral-700 dark:text-neutral-300">
            {isMoney
              ? `total ${fmtCurrency(total, currency)}`
              : mode === 'token_units' && rates != null
              ? `total ${fmtCompact(total)}${refSuffix}`
              : `total ${fmtCompact(tokenTotal)} tokens${cost == null ? '' : ` / ${fmtCurrency(cost, currency)}`}`}
          </div>
        )
      ) : (
        showLegend && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            {segments.map((segment) => (
              <span key={segment.key} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-sm ${segment.className}`} />
                {segment.label} {fmtSeg(segment)}
              </span>
            ))}
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              {isMoney
                ? `total ${fmtCurrency(total, currency)}`
                : mode === 'token_units' && rates != null
                ? `total ${fmtCompact(total)}${refSuffix}`
                : `total ${fmtCompact(tokenTotal)} tokens${cost == null ? '' : ` / ${fmtCurrency(cost, currency)}`}`}
            </span>
          </div>
        )
      )}
    </div>
  )
}
