import type { Session, TokenUsage, UnifiedSession } from '../types'

// How usage is expressed:
//  - tokens      → raw token counts
//  - token_units → each token type normalized by its price RELATIVE to a reference token
//                  type, so a cached token counts as a fraction of an output token. The
//                  result is a token COUNT ("equivalent output tokens"), NOT money — it
//                  measures how wastefully a model spends tokens, independent of price.
//  - money       → the actual USD cost.
export type UsageUnitMode = 'tokens' | 'token_units' | 'money'

// Which token type is the "1.0" reference for token_units mode. Every segment is
// re-expressed as the equivalent number of tokens of this type at their relative rates.
// 'scaled' is output-equivalent multiplied by a tunable factor so the total lands near
// the raw token count (input/cached/output land far above or below it).
export type TokenUnitRef = 'input' | 'cached' | 'output' | 'scaled'

// How monetary amounts are displayed. Cents variants multiply by 100.
export type CurrencyMode = 'usd' | 'usd_cents' | 'eur' | 'eur_cents'

export interface UsageParts {
  freshInput: number
  cachedInput: number
  // Claude-only premium cache-write bucket (0 for Codex). cacheCreate is the total;
  // cacheCreate5m/cacheCreate1h are its 5-minute / 1-hour TTL split (used for cost).
  cacheCreate: number
  cacheCreate5m: number
  cacheCreate1h: number
  output: number
  reasoning: number
  total: number
}

export interface TokenRates {
  input: number
  cached: number | null
  output: number
  // Claude-only cache-write rates ($/Mtok). Absent for Codex → treated as 0 in cost.
  cacheWrite5m?: number | null
  cacheWrite1h?: number | null
  context: 'short' | 'long'
  source: string
}

const PRICE_SOURCE = 'OpenAI API pricing, July 7 2026'
const CLAUDE_PRICE_SOURCE = 'Anthropic API pricing, July 7 2026'

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

// Anthropic $/1M-token rates. cacheWrite5m/1h are the premium cache-creation rates for
// 5-minute and 1-hour TTLs. All Claude context is treated as 'long'.
export const CLAUDE_RATES: Record<string, { input: number; cached: number; cacheWrite5m: number; cacheWrite1h: number; output: number }> = {
  'claude-opus-4-8': { input: 5, cached: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, output: 25 },
  'claude-opus-4-7': { input: 5, cached: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, output: 25 },
  'claude-opus-4-6': { input: 5, cached: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, output: 25 },
  'claude-sonnet-5': { input: 3, cached: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6, output: 15 },
  'claude-sonnet-4-6': { input: 3, cached: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6, output: 15 },
  'claude-haiku-4-5': { input: 1, cached: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2, output: 5 },
  'claude-fable-5': { input: 10, cached: 1, cacheWrite5m: 12.5, cacheWrite1h: 20, output: 50 },
}

export const UNIT_MODE_LABELS: Record<UsageUnitMode, string> = {
  tokens: 'tokens',
  token_units: 'token units',
  money: 'money',
}

export const unitModes: UsageUnitMode[] = ['tokens', 'token_units', 'money']

// The reference-token sub-toggle for token_units mode. "-eq" = equivalent tokens.
export const tokenUnitRefs: TokenUnitRef[] = ['input', 'cached', 'output', 'scaled']
export const TOKEN_UNIT_REF_LABELS: Record<TokenUnitRef, string> = {
  input: 'input-eq',
  cached: 'cached-eq',
  output: 'output-eq',
  scaled: 'scaled',
}

// The 'scaled' reference multiplies output-equivalent tokens by this factor so the total
// sits near the raw token count. A ladder of "nice" multipliers the ±stepper walks; the
// default is tuned so a typical mixed session lands close to its raw total.
export const TOKEN_MULT_STEPS = [1, 2, 3, 5, 8, 12, 20, 30, 50, 75, 100]
export const DEFAULT_TOKEN_MULT = 12

// Step the multiplier one notch along the ladder (dir +1 up, -1 down), clamped to the ends.
export function stepTokenMult(current: number, dir: 1 | -1): number {
  const nearest = TOKEN_MULT_STEPS.reduce(
    (best, v, i) => (Math.abs(v - current) < Math.abs(TOKEN_MULT_STEPS[best] - current) ? i : best),
    0,
  )
  const idx = Math.min(Math.max(nearest + dir, 0), TOKEN_MULT_STEPS.length - 1)
  return TOKEN_MULT_STEPS[idx]
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
  if (kind === 'freshInput') return rates.input
  if (kind === 'cachedInput') return cachedRate
  if (kind === 'cacheCreate' || kind === 'cacheCreate5m' || kind === 'cacheCreate1h') return rates.cacheWrite5m ?? rates.input
  return rates.output
}

function normalizeModel(model: string | null | undefined): string {
  return (model || '').toLowerCase().trim()
}

export function splitUsage(usage: TokenUsage | null | undefined): UsageParts {
  const cachedInput = usage?.cached_input_tokens || 0
  const freshInput = Math.max((usage?.input_tokens || 0) - cachedInput, 0)
  const cacheCreate = usage?.cache_creation_input_tokens || 0
  const cacheCreate5m = usage?.cache_creation_5m_input_tokens || 0
  const cacheCreate1h = usage?.cache_creation_1h_input_tokens || 0
  const reasoning = usage?.reasoning_output_tokens || 0
  const output = Math.max((usage?.output_tokens || 0) - reasoning, 0)
  return {
    freshInput,
    cachedInput,
    cacheCreate,
    cacheCreate5m,
    cacheCreate1h,
    output,
    reasoning,
    total: freshInput + cachedInput + cacheCreate + output + reasoning,
  }
}

export function addUsage(a: TokenUsage | null | undefined, b: TokenUsage | null | undefined): TokenUsage {
  return {
    input_tokens: (a?.input_tokens || 0) + (b?.input_tokens || 0),
    cached_input_tokens: (a?.cached_input_tokens || 0) + (b?.cached_input_tokens || 0),
    cache_creation_input_tokens: (a?.cache_creation_input_tokens || 0) + (b?.cache_creation_input_tokens || 0),
    cache_creation_5m_input_tokens: (a?.cache_creation_5m_input_tokens || 0) + (b?.cache_creation_5m_input_tokens || 0),
    cache_creation_1h_input_tokens: (a?.cache_creation_1h_input_tokens || 0) + (b?.cache_creation_1h_input_tokens || 0),
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
  return (
    (parts.freshInput * rates.input) +
    (parts.cachedInput * cachedRate) +
    (parts.cacheCreate5m * (rates.cacheWrite5m ?? 0)) +
    (parts.cacheCreate1h * (rates.cacheWrite1h ?? 0)) +
    ((parts.output + parts.reasoning) * rates.output)
  ) / 1_000_000
}

export function ratesForClaudeModel(model: string | null | undefined): TokenRates | null {
  let key = normalizeModel(model).replace(/\[1m\]$/, '')
  if (key === 'claude-haiku-4-5-20251001') key = 'claude-haiku-4-5'
  const r = CLAUDE_RATES[key]
  if (!r) return null
  return {
    input: r.input,
    cached: r.cached,
    output: r.output,
    cacheWrite5m: r.cacheWrite5m,
    cacheWrite1h: r.cacheWrite1h,
    context: 'long',
    source: CLAUDE_PRICE_SOURCE,
  }
}

// Pricing for a unified session — dispatches on source to the per-source rate table.
// Codex needs the full session (its rates depend on the max context window seen); Claude
// keys purely off the model name.
export function ratesForUnified(s: UnifiedSession): TokenRates | null {
  return s.source === 'codex' ? ratesForSession(s.raw as Session) : ratesForClaudeModel(s.model)
}

// $/1M-token rate of the reference token type used as the "1.0" unit in token_units mode.
// 'scaled' divides the output rate by the multiplier, so a segment's scaled value equals
// its output-equivalent times `mult` (larger mult → total closer to / above raw tokens).
function refRate(rates: TokenRates, ref: TokenUnitRef, mult: number): number {
  if (ref === 'input') return rates.input
  if (ref === 'cached') return rates.cached ?? rates.input
  if (ref === 'scaled') return rates.output / (mult || 1)
  return rates.output
}

// Bar-segment weight in the active unit:
//  - 'tokens'      → raw count
//  - 'money'       → the segment's USD cost
//  - 'token_units' → the segment re-expressed as the equivalent number of reference tokens
//                    (e.g. a cached token is worth ~1/50th of an output token), so segment
//                    lengths reflect token *weight*, not raw count or absolute price.
// Falls back to raw tokens when the model has no known pricing.
export function usageUnitValue(
  value: number,
  kind: keyof Omit<UsageParts, 'total'>,
  rates: TokenRates | null,
  mode: UsageUnitMode,
  ref: TokenUnitRef = 'output',
  mult: number = DEFAULT_TOKEN_MULT,
): number {
  if (mode === 'tokens' || !rates) return value
  const weighted = value * rateForKind(kind, rates) // value · ($/Mtok)
  if (mode === 'money') return weighted / 1_000_000 // actual USD
  const denom = refRate(rates, ref, mult)
  if (!denom) return value
  return weighted / denom // equivalent count of reference tokens
}

// Sum of a usage's segments expressed in the active unit — the value each bar is
// scaled against so sessions/cycles stay proportional to one another.
export function usageUnitTotal(
  usage: TokenUsage | null | undefined,
  rates: TokenRates | null,
  mode: UsageUnitMode,
  ref: TokenUnitRef = 'output',
  mult: number = DEFAULT_TOKEN_MULT,
): number {
  const p = splitUsage(usage)
  return (
    usageUnitValue(p.freshInput, 'freshInput', rates, mode, ref, mult) +
    usageUnitValue(p.cachedInput, 'cachedInput', rates, mode, ref, mult) +
    usageUnitValue(p.cacheCreate, 'cacheCreate', rates, mode, ref, mult) +
    usageUnitValue(p.output, 'output', rates, mode, ref, mult) +
    usageUnitValue(p.reasoning, 'reasoning', rates, mode, ref, mult)
  )
}
