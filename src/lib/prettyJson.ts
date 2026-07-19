// The v.2 viewer's "clean" mode. Raw mode hands the feed to JsonTree untouched;
// clean mode walks a COPY and rewrites only the parts that are unreadable as-is.
// Nothing is dropped — the underlying JSON on disk is never modified.

import type { Json } from '@adomas/json-tree'

const TZ = 'Europe/Vilnius'

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

// ISO-8601 with a date and a time — the only shape we rewrite. Bare dates
// ("2026-07-19") and arbitrary strings are left alone.
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

/** "2026-07-19T11:32:07.412Z" → "19 Jul 13:32" (Vilnius, no seconds). */
export function prettyDate(value: string): string {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return value
  return fmt.format(new Date(ms))
}

/** Epoch seconds/millis carried by some feeds, under a *_at / *_ms style key. */
const EPOCH_KEY = /(^|_)(ts|time|timestamp|_at|date)$/i

function prettyEpoch(n: number): string | null {
  // Seconds since 2001 through millis to ~2100 — anything outside is a real number.
  const ms = n > 1e11 ? n : n * 1000
  if (ms < 9.8e11 || ms > 4.1e12) return null
  return fmt.format(new Date(ms))
}

export function prettifyJson(value: Json, key?: string): Json {
  if (typeof value === 'string') return ISO.test(value) ? prettyDate(value) : value
  if (typeof value === 'number' && key && EPOCH_KEY.test(key)) {
    return prettyEpoch(value) ?? value
  }
  if (Array.isArray(value)) return value.map((v) => prettifyJson(v as Json))
  if (value && typeof value === 'object') {
    const out: Record<string, Json> = {}
    for (const [k, v] of Object.entries(value)) out[k] = prettifyJson(v as Json, k)
    return out
  }
  return value
}
