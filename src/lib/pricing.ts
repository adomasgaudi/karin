import type { Session, TokenUsage } from '../types'

// How bar segments are weighted: raw token counts, or price-weighted so each segment's
// length reflects its share of cost ("match tokens by price").
export type UsageUnitMode = 'tokens' | 'token_units'

// How monetary amounts are displayed. Cents variants multiply by 100.
export type CurrencyMode = 'usd' | 'usd_cents' | 'eur' | 'eur_cents'

export interface UsageParts {
  freshInput: number
  cachedInput: number
  output: number
  reasoning: number
  total: number
}

export interface TokenRates {
  input: number
  cached: number | null
  output: number
  context: 'short' | 'long'
  source: string
}

const PRICE_SOURCE = 'OpenAI API pricing, July 7 2026'

const STANDARD_RATES: Record<string, { short: Omit<TokenRates, 'context' | 'source'>; long?: Omit<TokenRates, 'context' | 'source'> }> = {
  'gpt-5.5': { short: { input: 5, cached: 0.5, output: 30 }, long: { input: 10, cached: 1, output: 45 } },
  'gpt-5.5-pro': { short: { input: 30, cached: null, output: 180 }, long: { input: 60, cached: null, output: 270 } },
  'gpt-5.4': { short: { input: 2.5, cached: 0.25, output: 15 }, long: { input: 5, cached: 0.5, output: 22.5 } },
  'gpt-5.4-mini': { short: { input: 0.75, cached: 0.075, output: 4.5 } },
  'gpt-5.4-nano': { short: { input: 0.2, cached: 0.02, output: 1.25 } },
  'gpt-5.4-pro': { short: { input: 30, cached: null, output: 180 }, long: { input: 60, cached: null, output: 270 } },
  'gpt-5.3-codex': { short: { input: 1.75, cached: 0.175, output: 14 } },
  'chat-latest': { short: { input: 5, cached: 0.5, output: 30 } },
}

export const UNIT_MODE_LABELS: Record<UsageUnitMode, string> = {
  tokens: 'tokens',
  token_units: 'token units',
}

// EUR per USD, as of the pricing snapshot date. Adjust when the FX rate moves.
export const EUR_PER_USD = 0.92

export const CURRENCY_LABELS: Record<CurrencyMode, string> = {
  usd: '$',
  usd_cents: '¢',
  eur: '€',
  eur_cents: '€¢',
}

export const currencyModes: CurrencyMode[] = ['usd', 'usd_cents', 'eur', 'eur_cents']

// $/1M-token rate for a given segment kind.
function rateForKind(kind: keyof Omit<UsageParts, 'total'>, rates: TokenRates): number {
  const cachedRate = rates.cached ?? rates.input
  return kind === 'freshInput' ? rates.input : kind === 'cachedInput' ? cachedRate : rates.output
}

function normalizeModel(model: string | null | undefined): string {
  return (model || '').toLowerCase().trim()
}

export function splitUsage(usage: TokenUsage | null | undefined): UsageParts {
  const cachedInput = usage?.cached_input_tokens || 0
  const freshInput = Math.max((usage?.input_tokens || 0) - cachedInput, 0)
  const reasoning = usage?.reasoning_output_tokens || 0
  const output = Math.max((usage?.output_tokens || 0) - reasoning, 0)
  return {
    freshInput,
    cachedInput,
    output,
    reasoning,
    total: freshInput + cachedInput + output + reasoning,
  }
}

export function addUsage(a: TokenUsage | null | undefined, b: TokenUsage | null | undefined): TokenUsage {
  return {
    input_tokens: (a?.input_tokens || 0) + (b?.input_tokens || 0),
    cached_input_tokens: (a?.cached_input_tokens || 0) + (b?.cached_input_tokens || 0),
    output_tokens: (a?.output_tokens || 0) + (b?.output_tokens || 0),
    reasoning_output_tokens: (a?.reasoning_output_tokens || 0) + (b?.reasoning_output_tokens || 0),
    total_tokens: (a?.total_tokens || 0) + (b?.total_tokens || 0),
  }
}

export function ratesForSession(session: Session): TokenRates | null {
  const table = STANDARD_RATES[normalizeModel(session.model)]
  if (!table) return null
  const maxContextWindow = Math.max(0, ...(session.token_events || []).map((event) => event.context_window || 0))
  const context = table.long && maxContextWindow > 128000 ? 'long' : 'short'
  const rates = context === 'long' && table.long ? table.long : table.short
  return { ...rates, context, source: PRICE_SOURCE }
}

export function usageCost(parts: UsageParts, rates: TokenRates | null): number | null {
  if (!rates) return null
  const cachedRate = rates.cached ?? rates.input
  return ((parts.freshInput * rates.input) + (parts.cachedInput * cachedRate) + ((parts.output + parts.reasoning) * rates.output)) / 1_000_000
}

// Bar-segment weight. 'tokens' → raw count; 'token_units' → the segment's USD cost, so
// segment lengths become proportional to what each token type actually costs.
// Falls back to raw tokens when the model has no known pricing.
export function usageUnitValue(value: number, kind: keyof Omit<UsageParts, 'total'>, rates: TokenRates | null, mode: UsageUnitMode): number {
  if (mode === 'tokens' || !rates) return value
  return (value * rateForKind(kind, rates)) / 1_000_000
}

// Sum of a usage's four segments expressed in the active unit — the value each bar is
// scaled against so sessions/cycles stay proportional to one another.
export function usageUnitTotal(usage: TokenUsage | null | undefined, rates: TokenRates | null, mode: UsageUnitMode): number {
  const p = splitUsage(usage)
  return (
    usageUnitValue(p.freshInput, 'freshInput', rates, mode) +
    usageUnitValue(p.cachedInput, 'cachedInput', rates, mode) +
    usageUnitValue(p.output, 'output', rates, mode) +
    usageUnitValue(p.reasoning, 'reasoning', rates, mode)
  )
}
