import type {
  Session,
  Message,
  Tool,
  Reasoning,
  ContextBlock,
  RuntimeEvent,
  TokenEvent,
  CodeEdit,
  TokenUsage,
  TurnContext,
} from '../types'
import { addUsage } from './pricing'

// A single transcript event, tagged by kind, used to build prompt/answer cycles.
export type Entry =
  | { kind: 'context'; line: number; index: number; item: ContextBlock }
  | { kind: 'message'; line: number; index: number; item: Message }
  | { kind: 'reasoning'; line: number; index: number; item: Reasoning }
  | { kind: 'runtime'; line: number; index: number; item: RuntimeEvent }
  | { kind: 'tool'; line: number; index: number; item: Tool }
  | { kind: 'edit'; line: number; index: number; item: CodeEdit }
  | { kind: 'token'; line: number; index: number; item: TokenEvent }

export type EntryKind = Entry['kind']

export interface Cycle {
  startLine: number
  items: Entry[]
}

const KIND_ORDER: Record<EntryKind, number> = {
  context: 0,
  message: 1,
  reasoning: 2,
  tool: 3,
  edit: 4,
  token: 5,
  runtime: 6,
}

// Flatten every event of a session into one line-ordered list (mirrors karin.py groupedItems).
export function buildEntries(s: Session): Entry[] {
  const entries: Entry[] = [
    ...(s.contexts || []).map((item, index): Entry => ({ kind: 'context', line: item.line || 0, index, item })),
    ...(s.messages || []).map((item, index): Entry => ({ kind: 'message', line: item.line || 0, index, item })),
    ...(s.reasoning || []).map((item, index): Entry => ({ kind: 'reasoning', line: item.line || 0, index, item })),
    ...(s.runtime_events || []).map((item, index): Entry => ({ kind: 'runtime', line: item.line || 0, index, item })),
    ...(s.tools || []).map((item, index): Entry => ({ kind: 'tool', line: item.line || 0, index, item })),
    ...(s.code_edits || []).map((item, index): Entry => ({ kind: 'edit', line: item.line || 0, index, item })),
    ...(s.token_events || []).map((item, index): Entry => ({ kind: 'token', line: item.line || 0, index, item })),
  ]
  return entries.sort((a, b) => a.line - b.line || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

// Group the flat entry list into cycles: a new cycle starts at each user prompt / context block
// that follows a response (mirrors karin.py renderCycles).
export function buildCycles(s: Session): Cycle[] {
  const entries = buildEntries(s)
  const cycles: Cycle[] = []
  let current: (Cycle & { hasResponse: boolean }) | null = null

  for (const entry of entries) {
    const isUser = entry.kind === 'message' && entry.item.role === 'user'
    const promptSide = entry.kind === 'context' || isUser
    if (!current || (promptSide && current.hasResponse)) {
      current = { startLine: entry.line || 0, items: [], hasResponse: false }
      cycles.push(current)
    }
    current.items.push(entry)
    if (!promptSide) current.hasResponse = true
  }
  return cycles
}

// Human counts for a cycle summary line.
export function cycleCounts(cycle: Cycle): string {
  const counts: Record<string, number> = {}
  for (const entry of cycle.items) {
    const key = entry.kind === 'message' ? entry.item.role : entry.kind
    counts[key] = (counts[key] || 0) + 1
  }
  return [
    counts.user ? `${counts.user} prompt` : null,
    counts.assistant ? `${counts.assistant} answer` : null,
    counts.tool ? `${counts.tool} tool` : null,
    counts.reasoning ? `${counts.reasoning} reasoning` : null,
    counts.edit ? `${counts.edit} edit` : null,
    counts.token ? `${counts.token} token` : null,
    counts.runtime ? `${counts.runtime} runtime` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function cycleUsage(cycle: Cycle): TokenUsage {
  return cycle.items
    .filter((entry): entry is Extract<Entry, { kind: 'token' }> => entry.kind === 'token')
    .reduce((sum, entry) => addUsage(sum, entry.item.last), {})
}

// Injected startup context is stored as a user message too (see karin.py
// classify_context_message) — skip it so the title shows the owner's real prompt.
function isInjectedContext(text: string): boolean {
  return text.includes('# AGENTS.md instructions') || text.includes('<environment_context>')
}

// First real user prompt in the cycle, trimmed to a short summary title.
export function cyclePrompt(cycle: Cycle): string {
  for (const e of cycle.items) {
    if (e.kind !== 'message' || e.item.role !== 'user') continue
    const raw = e.item.text?.trim() || ''
    if (!raw || isInjectedContext(raw)) continue
    const t = raw.replace(/\s+/g, ' ').slice(0, 40)
    if (t) return raw.length > 40 ? `${t}…` : t
  }
  return 'context only'
}

// Model + reasoning effort active for a cycle: the latest turn_context at/before its first line.
export function cycleModelEffort(
  cycle: Cycle,
  turnContexts: TurnContext[] | undefined,
): { model: string | null; effort: string | null } {
  const line = cycle.items[0]?.line ?? cycle.startLine
  let picked: TurnContext | null = null
  for (const tc of turnContexts || []) {
    if (tc.line <= line) picked = tc
    else break
  }
  return { model: picked?.model ?? null, effort: picked?.effort ?? null }
}
