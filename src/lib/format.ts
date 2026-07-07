import type { Session } from '../types'
import { EUR_PER_USD, type CurrencyMode } from './pricing'

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
    hour: d.getHours().toString().padStart(2, '0'),
    minute: d.getMinutes().toString().padStart(2, '0'),
  }
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return ''
  const parts = dateParts(value)
  return parts ? `${parts.date} ${parts.hour}:${parts.minute}` : value
}

export function fmtTime(value: Date): string {
  return `${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}:${value.getSeconds().toString().padStart(2, '0')}`
}

export function fmtLiveDateTime(value: Date): string {
  return `${MONTHS[value.getMonth()]} ${value.getDate()} ${fmtTime(value)}`
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

export function fmtNum(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString() : 'n/a'
}

export function fmtCompact(n: number | null | undefined): string {
  if (typeof n !== 'number') return 'n/a'
  return Intl.NumberFormat(undefined, { maximumFractionDigits: n < 10 ? 2 : 1, notation: 'compact' }).format(n)
}

// Format a USD amount in the chosen currency/denomination. Cents variants append ¢.
export function fmtCurrency(usd: number | null | undefined, currency: CurrencyMode = 'usd'): string {
  if (typeof usd !== 'number') return 'n/a'
  if (currency === 'usd' || currency === 'eur') {
    const value = currency === 'usd' ? usd : usd * EUR_PER_USD
    const small = Math.abs(value) < 1
    return Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency === 'usd' ? 'USD' : 'EUR',
      minimumFractionDigits: small ? 4 : 2,
      maximumFractionDigits: small ? 4 : 2,
    }).format(value)
  }
  const cents = (currency === 'usd_cents' ? usd : usd * EUR_PER_USD) * 100
  const symbol = currency === 'usd_cents' ? '¢' : '€¢'
  const abs = Math.abs(cents)
  const digits = abs < 1 ? 3 : abs < 100 ? 2 : 1
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
