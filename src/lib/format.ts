import type { Session } from '../types'

export function fmtDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export function fmtNum(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString() : 'n/a'
}

export function tokensLabel(s: Session): string {
  const total = s.latest_total_usage?.total_tokens
  return total ? `${total.toLocaleString()} tokens` : 'tokens n/a'
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
