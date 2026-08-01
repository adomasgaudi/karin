import type { TokenUsage } from '../types'
import { fmtCompact, fmtCurrency } from '../lib/format'
import {
  EUR_PER_USD,
  splitUsage,
  usageCost,
  usageUnitValue,
  TOKEN_UNIT_REF_LABELS,
  type CurrencyMode,
  type TokenRates,
  type TokenUnitRef,
  type UsageUnitMode,
} from '../lib/pricing'

const EURO_CENTS_PER_USD = EUR_PER_USD * 100
const MAX_BLOCK_LINE_PX = 260
const FULL_BLOCK_PX = 5
const DOT_BLOCK_PX = 3

type Segment = {
  key: 'freshInput' | 'cachedInput' | 'cacheCreate' | 'output' | 'reasoning'
  label: string
  raw: number
  className: string
}

function SegmentBlocks({
  segment,
  blockValue,
  blockPx,
  boxUnit,
  dotScale,
  stretch,
  widthPercent,
  estimated,
  ariaLabel,
}: {
  segment: Segment
  blockValue: number
  blockPx: number
  boxUnit: number
  dotScale: boolean
  stretch: boolean
  widthPercent?: number
  estimated: boolean
  ariaLabel?: string
}) {
  if (blockValue <= 0) return null
  const blockCount = Math.ceil(blockValue / boxUnit - 0.000001)
  const hatch = estimated
    ? { backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0, rgba(255,255,255,0.45) 2px, transparent 2px, transparent 5px)' }
    : undefined
  return (
    <div
      className="flex h-full min-w-0 shrink-0 items-center gap-px"
      style={stretch ? { width: `${Math.max(0, widthPercent || 0)}%` } : undefined}
      aria-label={ariaLabel}
    >
      {Array.from({ length: blockCount }, (_, i) => {
        const fill = Math.min(1, Math.max(0, (blockValue - i * boxUnit) / boxUnit))
        return (
          <span
            key={`${segment.key}-block-${i}`}
            className={`relative block shrink-0 overflow-hidden bg-neutral-300/70 dark:bg-neutral-700/70 ${
              stretch ? 'min-w-0 flex-1 rounded-[2px]' : dotScale ? 'h-[3px] rounded-full' : 'h-full rounded-[2px]'
            }`}
            style={stretch ? undefined : { width: `${dotScale ? DOT_BLOCK_PX : blockPx}px`, ...(dotScale ? { height: `${DOT_BLOCK_PX}px` } : null) }}
          >
            {fill > 0 && (
              <span
                className={`absolute inset-x-0 bottom-0 ${segment.className}`}
                style={{ height: `${fill * 100}%`, minHeight: fill < 1 ? '1px' : undefined, ...hatch }}
              />
            )}
          </span>
        )
      })}
    </div>
  )
}

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
  hideSegmentLabels = false,
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
  // A minimal ~4px line of blocks with no labels/legend — the always-visible collapsed indicator.
  thin?: boolean
  // Reserve the taller inline-label height used by top bars; labels now live in the total line/legend.
  inlineLabels?: boolean
  // Callers may overlay their own summary on the block line (for example, sidebar rows).
  hideSegmentLabels?: boolean
  // In pure token mode, block-line width is proportional to this raw-token scale.
  scaleMax?: number
  // Estimated (not measured) usage: render hatched + faded so it reads as a guess.
  estimated?: boolean
}) {
  const parts = splitUsage(usage)
  const cost = usageCost(parts, rates)
  const allSegments: Segment[] = [
    { key: 'freshInput', label: 'input', raw: parts.freshInput, className: 'bg-sky-500' },
    { key: 'cachedInput', label: 'cached', raw: parts.cachedInput, className: 'bg-emerald-500' },
    { key: 'cacheCreate', label: 'cache write', raw: parts.cacheCreate, className: 'bg-violet-500' },
    { key: 'output', label: 'output', raw: parts.output, className: 'bg-amber-500' },
    { key: 'reasoning', label: 'reasoning', raw: parts.reasoning, className: 'bg-fuchsia-500' },
  ]
  const segments = allSegments.filter((segment) => segment.raw > 0)

  const valuedSegments = segments.map((segment) => ({
    ...segment,
    value: usageUnitValue(segment.raw, segment.key, rates, mode, tokenRef, tokenMult),
    // A block is always one euro cent, even when the visible label is tokens or
    // token-units. When a source has no price table, retain a clearly raw fallback.
    blockValue: rates ? usageUnitValue(segment.raw, segment.key, rates, 'money') * EURO_CENTS_PER_USD : segment.raw / 1_000_000,
  }))
  const total = valuedSegments.reduce((sum, segment) => sum + segment.value, 0)
  const blockTotal = valuedSegments.reduce((sum, segment) => sum + segment.blockValue, 0)
  const tokenTotal = parts.total || usage?.total_tokens || 0
  // Thin row indicators are a run of cent markers, not a miniature full-width
  // proportional bar. The surrounding track belonged to the old visualization.
  const stretch = mode === 'tokens' && !thin
  const tokenDenom = scaleMax && scaleMax > 0 ? scaleMax : tokenTotal
  // Short bars use one small dot per cent. Once a cycle/prompt/session crosses 50 cents,
  // switch that bar to ten-cent boxes so a large total does not become visual noise.
  const dotScale = blockTotal <= 50
  const boxUnit = dotScale ? 1 : 10
  const blockPx = Math.min(FULL_BLOCK_PX, MAX_BLOCK_LINE_PX / Math.max(1, Math.ceil(blockTotal / boxUnit)))
  const isMoney = mode === 'money' && rates != null
  const refSuffix = mode === 'token_units' && rates != null ? ` ${TOKEN_UNIT_REF_LABELS[tokenRef]}` : ''
  const fmtSeg = (segment: { value: number }) => (isMoney ? fmtCurrency(segment.value, currency) : fmtCompact(segment.value))
  const totalLabel = isMoney
    ? `total ${fmtCurrency(total, currency)}`
    : mode === 'token_units' && rates != null
      ? `total ${fmtCompact(total)}${refSuffix}`
      : `total ${fmtCompact(tokenTotal)} tokens${cost == null ? '' : ` / ${fmtCurrency(cost, currency)}`}`
  const hoverTitle = estimated ? `≈ estimated ${totalLabel}` : totalLabel
  // Compact bars (cycle summaries) use the SAME block height as the sidebar's session
  // rows (h-2.5), so a ten-cent box reads as one size everywhere.
  const blockHeight = thin ? 'h-[3px]' : inlineLabels ? (compact ? 'h-2.5' : 'h-3') : compact ? 'h-2.5' : 'h-1.5'
  const hasBlocks = valuedSegments.length > 0 && blockTotal > 0
  if (thin && !hasBlocks) return null

  return (
    <div className={compact ? 'min-w-0' : 'max-w-4xl'}>
      <div
        title={hoverTitle}
        className={
          thin
            ? `inline-flex min-w-0 items-center gap-px ${blockHeight}`
            : `flex min-w-0 items-center gap-px overflow-hidden rounded-sm bg-neutral-200/70 px-0.5 dark:bg-neutral-800/70 ${blockHeight} ${
                estimated ? 'opacity-70 outline-dashed outline-1 outline-offset-[-1px] outline-neutral-400/70 dark:outline-neutral-500/60' : ''
              }`
        }
      >
        {hasBlocks ? (
          valuedSegments.map((segment) => (
            <SegmentBlocks
              key={segment.key}
              segment={segment}
              blockValue={segment.blockValue}
              blockPx={blockPx}
              boxUnit={boxUnit}
              dotScale={dotScale}
              stretch={stretch}
              widthPercent={stretch && tokenDenom > 0 ? (segment.raw / tokenDenom) * 100 : undefined}
              estimated={estimated}
              ariaLabel={hideSegmentLabels ? undefined : segment.label}
            />
          ))
        ) : (
          <div className="h-full w-full bg-neutral-300/70 dark:bg-neutral-700/70" />
        )}
      </div>
      {inlineLabels ? (
        // Compact cycle/card lines carry their value elsewhere; the top bar prints a total below.
        !compact && (
          <div className="mt-1 text-xs font-medium text-neutral-700 dark:text-neutral-300">
            {totalLabel}
          </div>
        )
      ) : (
        showLegend && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            {valuedSegments.map((segment) => (
              <span key={segment.key} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-sm ${segment.className}`} />
                {segment.label} {fmtSeg(segment)}
              </span>
            ))}
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              {totalLabel}
            </span>
          </div>
        )
      )}
    </div>
  )
}
