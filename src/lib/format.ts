import type { Session, UnifiedSession } from '../types'
import {
  EUR_PER_USD,
  TOKEN_UNIT_REF_LABELS,
  coinDenominations,
  usageUnitTotal,
  type CurrencyMode,
  type TokenRates,
  type TokenUnitRef,
  type UsageUnitMode,
} from './pricing'

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

export interface DateParts {
  date: string
  hour: string
  minute: string
}

export function dateParts(value: string | null | undefined): DateParts | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null

  return {
    date: `${MONTHS[d.getMonth()]} ${d.getDate()}`,
    hour: twoDigits(d.getHours()),
    minute: twoDigits(d.getMinutes()),
  }
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return ''
  const parts = dateParts(value)
  return parts ? `${parts.date} ${parts.hour}:${parts.minute}` : value
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, '0')
}

export function fmtTime(value: Date): string {
  const hours = twoDigits(value.getHours())
  const minutes = twoDigits(value.getMinutes())
  const seconds = twoDigits(value.getSeconds())
  return `${hours}:${minutes}:${seconds}`
}

export function fmtLiveDateTime(value: Date): string {
  return `${MONTHS[value.getMonth()]} ${value.getDate()} ${fmtTime(value)}`
}

// h:MM:ss — wall-clock time with an unpadded hour. Deliberately not fmtTime's zero-padded
// HH:MM:SS: this sits beside a session title, where a leading zero reads as noise.
// Takes an ISO string (a record's timestamp) or a Date (the live clock).
export function fmtClockTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getHours()}:${twoDigits(d.getMinutes())}:${twoDigits(d.getSeconds())}`
}

// The timestamp of a session's LAST step, taken from its own feed records rather than the
// session's updated_at — for Claude that field is the transcript file's mtime, which drifts
// from the last event Claude actually logged. Records are written in order, so this walks
// back from the end and stops at the first usable stamp instead of scanning thousands.
export function lastRecordTime(records: { timestamp?: unknown }[] | null | undefined): string | null {
  if (!records) return null
  for (let i = records.length - 1; i >= 0; i--) {
    const stamp = records[i]?.timestamp
    if (typeof stamp === 'string' && !Number.isNaN(Date.parse(stamp))) return stamp
  }
  return null
}

export function relativeAge(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return 'n/a'
  const then = new Date(value)
  if (Number.isNaN(then.getTime())) return 'n/a'
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// Compact elapsed age with no "ago" suffix: "45s", "12m", "3h 4m", "2d".
export function shortAge(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return 'n/a'
  const then = new Date(value)
  if (Number.isNaN(then.getTime())) return 'n/a'
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

// Wall-clock time-of-day (HH:MM:SS) from an epoch-ms value; em-dash when absent.
export function fmtClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return fmtTime(new Date(ms))
}

// --- Significant-figure policy (site-wide) ---------------------------------
// Every displayed *measured* value (tokens, cost, durations) uses 2 significant
// figures below 10 and 3 at or above 10 — never fewer than 2, never more than 3.
// Exact counts of discrete things (records, events, m/s time breakdowns) are
// exempt and rendered as-is. These helpers are the single source for that rule.

function sigFigsFor(n: number): number {
  return Math.abs(n) < 10 ? 2 : 3
}

// Decimal places needed to render `figs` significant figures at n's magnitude.
function decimalsFor(n: number, figs: number): number {
  if (n === 0) return figs - 1
  const intDigits = Math.floor(Math.log10(Math.abs(n))) + 1
  return Math.max(0, figs - intDigits)
}

// Grouped sig-fig string: 7.3, "45,200", 0.071, 0.0040. "n/a" when unavailable.
export function sigFig(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'n/a'
  if (n === 0) return '0'
  const figs = sigFigsFor(n)
  const rounded = Number(n.toPrecision(figs))
  const decimals = decimalsFor(rounded, figs)
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// Human elapsed duration: "0.042s", "3.7s", "12.0s", "2m 14s", "1h 3m". Anything
// under a minute follows the sig-fig policy so sub-second steps keep their
// accuracy; longer spans break into exact m/s. "n/a" when unavailable.
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'n/a'
  const s = ms / 1000
  if (s < 60) return `${sigFig(s)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  if (m < 60) {
    if (rem) return `${m}m ${rem}s`
    return `${m}m`
  }
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (mm) return `${h}h ${mm}m`
  return `${h}h`
}

export function fmtNum(n: number | null | undefined): string {
  return typeof n === 'number' ? sigFig(n) : 'n/a'
}

export function fmtCompact(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  if (n === 0) return '0'
  const figs = sigFigsFor(n)
  return Intl.NumberFormat(undefined, {
    notation: 'compact',
    minimumSignificantDigits: figs,
    maximumSignificantDigits: figs,
  }).format(n)
}

// Format a USD amount in the chosen currency/denomination. Cents variants append ¢.
// Amounts follow the same 2-/3-sig-fig policy as every other measured number.
// An amount as counts of coin denominations: "3×10c 7×1c". Coarse denominations take
// whole counts and the FINEST one absorbs what is left, so the terms always re-add to the
// original amount at that resolution. Deliberately always US cents — the point of a coin
// mode is the size of the denomination, and folding an FX rate in would make two readings
// on the same screen incomparable.
function fmtCoins(usd: number, denoms: number[]): string {
  let cents = Math.abs(usd) * 100
  const parts: string[] = []
  denoms.forEach((denom, i) => {
    const finest = i === denoms.length - 1
    const count = finest ? Math.round(cents / denom) : Math.floor(cents / denom)
    cents -= count * denom
    if (count > 0) parts.push(`${fmtNum(count)}×${denom}c`)
  })
  if (!parts.length) return `0×${denoms[denoms.length - 1]}c`
  return `${usd < 0 ? '-' : ''}${parts.join(' ')}`
}

export function fmtCurrency(usd: number | null | undefined, currency: CurrencyMode = 'usd'): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return 'n/a'
  const coins = coinDenominations(currency)
  if (coins) return fmtCoins(usd, coins)
  if (currency === 'usd' || currency === 'eur') {
    const raw = currency === 'usd' ? usd : usd * EUR_PER_USD
    const value = raw === 0 ? 0 : Number(raw.toPrecision(sigFigsFor(raw)))
    const decimals = raw === 0 ? 2 : decimalsFor(value, sigFigsFor(raw))
    return Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency === 'usd' ? 'USD' : 'EUR',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  }
  const raw = (currency === 'usd_cents' ? usd : usd * EUR_PER_USD) * 100
  const cents = raw === 0 ? 0 : Number(raw.toPrecision(sigFigsFor(raw)))
  const symbol = currency === 'usd_cents' ? '¢' : '€¢'
  const digits = raw === 0 ? 0 : decimalsFor(cents, sigFigsFor(raw))
  return `${cents.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${symbol}`
}

export function fmtMoney(n: number | null | undefined): string {
  return fmtCurrency(n, 'usd')
}

export function tokensLabel(s: Session): string {
  const total = s.latest_total_usage?.total_tokens
  return total ? `${fmtCompact(total)} tokens` : 'tokens n/a'
}

// Lower-cased searchable blob for a session (mirrors karin.py haystack).
function haystack(s: Session): string {
  return [
    s.title,
    s.id,
    s.cwd,
    ...(s.messages || []).map((m) => m.text),
    ...(s.contexts || []).map((c) => c.text),
    ...(s.reasoning || []).map((r) => r.text),
    ...(s.runtime_events || []).map((e) => e.text),
    ...(s.tools || []).map((t) => `${t.name} ${t.arguments} ${t.output}`),
    ...(s.code_edits || []).map((e) => `${e.name} ${e.patch}`),
  ]
    .join('\n')
    .toLowerCase()
}

export function sessionMatches(s: Session, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return haystack(s).includes(q)
}

// --- Unified-session variants (source-agnostic) ----------------------------

export function tokensLabelUnified(s: UnifiedSession): string {
  const total = s.latest_total_usage?.total_tokens
  return total ? `${fmtCompact(total)} tokens` : 'tokens n/a'
}

// Session total in the ACTIVE usage unit, so the row label tracks the global toggle
// like the bars do: raw "5.8M tokens" in tokens mode, "1.2M output-eq" in token-units
// mode, or "$1.20" in money mode. Falls back to raw tokens when the model has no pricing.
export function sessionTotalLabel(
  s: UnifiedSession,
  rates: TokenRates | null,
  mode: UsageUnitMode,
  currency: CurrencyMode,
  ref: TokenUnitRef = 'output',
  mult?: number,
): string {
  if (mode === 'money' && rates) {
    return fmtCurrency(usageUnitTotal(s.latest_total_usage, rates, mode, ref, mult), currency)
  }
  if (mode === 'token_units' && rates) {
    return `${fmtCompact(usageUnitTotal(s.latest_total_usage, rates, mode, ref, mult))} ${TOKEN_UNIT_REF_LABELS[ref]}`
  }
  const total = s.latest_total_usage?.total_tokens
  return total ? `${fmtCompact(total)} tokens` : 'tokens n/a'
}

// Search against the precomputed haystack the adapter built for either source.
export function sessionMatchesUnified(s: UnifiedSession, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return s.haystack.includes(q)
}
