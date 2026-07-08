// One cycle builder for BOTH sources. Replaces the twin lib/cycles.ts (Codex) and
// src/components/claude/detail/cycles.ts (Claude): same flatten → sort → split → count
// structure, parametrized on `source` in exactly the two places the sources genuinely
// differ — the cycle-split predicate and per-entry usage attribution.
//
// Kinds are normalized across sources: Codex `reasoning` + Claude `thinking` → `thinking`;
// Codex `token` + Claude `usage` → `usage`. `runtime` is Codex-only, `subagent` Claude-only.
// Each entry carries `source` so EventEntry can branch only where rendering diverges
// (locked-vs-signed, patch-vs-diff, plain-output-vs-structured-result, estimated-vs-measured).

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
  UnifiedSession,
  SessionSource,
} from '../types'
import type {
  ClaudeDetailSession,
  ClaudeMessage,
  ClaudeThinking,
  ClaudeTool,
  ClaudeEdit,
  ClaudeUsageFrame,
  ClaudeContext,
  ClaudeSubagent,
  ClaudeTurnCtx,
} from './claudeModel'
import { addUsage, splitUsage } from './pricing'

// A single transcript event, tagged by unified kind + source, used to build cycles.
export type UnifiedEntry =
  | { kind: 'context'; source: SessionSource; line: number; index: number; item: ContextBlock | ClaudeContext }
  | { kind: 'message'; source: SessionSource; line: number; index: number; item: Message | ClaudeMessage }
  | { kind: 'thinking'; source: SessionSource; line: number; index: number; item: Reasoning | ClaudeThinking }
  | { kind: 'tool'; source: SessionSource; line: number; index: number; item: Tool | ClaudeTool }
  | { kind: 'edit'; source: SessionSource; line: number; index: number; item: CodeEdit | ClaudeEdit }
  | { kind: 'usage'; source: SessionSource; line: number; index: number; item: TokenEvent | ClaudeUsageFrame }
  | { kind: 'runtime'; source: SessionSource; line: number; index: number; item: RuntimeEvent }
  | { kind: 'subagent'; source: SessionSource; line: number; index: number; item: ClaudeSubagent }

export type Entry = UnifiedEntry
export type EntryKind = UnifiedEntry['kind']

export interface Cycle {
  startLine: number
  items: UnifiedEntry[]
}

const KIND_ORDER: Record<EntryKind, number> = {
  context: 0,
  message: 1,
  thinking: 2,
  tool: 3,
  edit: 4,
  usage: 5,
  runtime: 6,
  subagent: 6,
}

// --- Flatten each source's enriched arrays into one line-ordered entry list -------

function codexEntries(s: Session): UnifiedEntry[] {
  const src: SessionSource = 'codex'
  const entries: UnifiedEntry[] = [
    ...(s.contexts || []).map((item, index): UnifiedEntry => ({ kind: 'context', source: src, line: item.line || 0, index, item })),
    ...(s.messages || []).map((item, index): UnifiedEntry => ({ kind: 'message', source: src, line: item.line || 0, index, item })),
    ...(s.reasoning || []).map((item, index): UnifiedEntry => ({ kind: 'thinking', source: src, line: item.line || 0, index, item })),
    ...(s.runtime_events || []).map((item, index): UnifiedEntry => ({ kind: 'runtime', source: src, line: item.line || 0, index, item })),
    ...(s.tools || []).map((item, index): UnifiedEntry => ({ kind: 'tool', source: src, line: item.line || 0, index, item })),
    ...(s.code_edits || []).map((item, index): UnifiedEntry => ({ kind: 'edit', source: src, line: item.line || 0, index, item })),
    ...(s.token_events || []).map((item, index): UnifiedEntry => ({ kind: 'usage', source: src, line: item.line || 0, index, item })),
  ]
  return entries.sort((a, b) => a.line - b.line || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

function claudeEntries(s: ClaudeDetailSession): UnifiedEntry[] {
  const src: SessionSource = 'claude'
  const entries: UnifiedEntry[] = [
    ...(s.contexts || []).map((item, index): UnifiedEntry => ({ kind: 'context', source: src, line: item.line || 0, index, item })),
    ...(s.messages || []).map((item, index): UnifiedEntry => ({ kind: 'message', source: src, line: item.line || 0, index, item })),
    ...(s.thinking || []).map((item, index): UnifiedEntry => ({ kind: 'thinking', source: src, line: item.line || 0, index, item })),
    ...(s.tools || []).map((item, index): UnifiedEntry => ({ kind: 'tool', source: src, line: item.line || 0, index, item })),
    ...(s.code_edits || []).map((item, index): UnifiedEntry => ({ kind: 'edit', source: src, line: item.line || 0, index, item })),
    ...(s.usage_frames || []).map((item, index): UnifiedEntry => ({ kind: 'usage', source: src, line: item.line || 0, index, item })),
    ...(s.subagents || []).map((item, index): UnifiedEntry => ({ kind: 'subagent', source: src, line: item.parent_line || 0, index, item })),
  ]
  return entries.sort((a, b) => a.line - b.line || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

export function buildEntries(s: UnifiedSession): UnifiedEntry[] {
  return s.source === 'codex' ? codexEntries(s.raw as Session) : claudeEntries(s.raw as ClaudeDetailSession)
}

// --- Cycle splitting --------------------------------------------------------
// ONE framework for every AI. A cycle = one human touchpoint plus all the work it drove,
// so a session reads as the logical back-and-forth (prompt → question/answer →
// interjection → …), not just "AI ran until the owner cold-started a new prompt". A new
// cycle opens at:
//   • a human prompt — Codex: any user message; Claude: a user message whose origin is
//     human and whose prompt_source is `typed` (fresh) OR `queued` (interjected mid-turn).
//   • the owner's answer to an AI question — an AskUserQuestion tool call carrying a
//     result. The split lands BEFORE that tool, so the Q&A heads the cycle it redirected.
// Leading environment context naturally forms a context-only cycle before the first
// prompt. The `items.length > 0` guard stops back-to-back touchpoints from spawning empty
// cycles while still splitting genuinely consecutive human inputs.

const ASK_TOOL = 'AskUserQuestion'

// A human prompt (fresh or interjected), source-aware. Codex messages carry no origin
// metadata, so every Codex user message is human; Claude distinguishes typed/queued
// humans from agent/tool-injected user records.
function isHumanPrompt(entry: UnifiedEntry): boolean {
  if (entry.kind !== 'message') return false
  const m = entry.item as Message | ClaudeMessage
  if (m.role !== 'user') return false
  if (entry.source === 'codex') return true
  const cm = m as ClaudeMessage
  return cm.origin_kind === 'human' && (cm.prompt_source === 'typed' || cm.prompt_source === 'queued')
}

// An AskUserQuestion tool call the owner actually answered (result present). Codex has no
// such tool, so this is Claude-only in practice — the source difference falls out for free.
function isAnsweredQuestion(entry: UnifiedEntry): boolean {
  if (entry.kind !== 'tool') return false
  if (entry.source === 'claude') {
    const t = entry.item as ClaudeTool
    return t.name === ASK_TOOL && t.result != null
  }
  const t = entry.item as Tool
  return t.name === ASK_TOOL && t.output != null
}

function opensCycle(entry: UnifiedEntry): boolean {
  return isHumanPrompt(entry) || isAnsweredQuestion(entry)
}

export function buildCycles(s: UnifiedSession): Cycle[] {
  const entries = buildEntries(s)
  const cycles: Cycle[] = []
  let current: Cycle | null = null
  for (const entry of entries) {
    if (!current || (opensCycle(entry) && current.items.length > 0)) {
      current = { startLine: entry.line || 0, items: [] }
      cycles.push(current)
    }
    current.items.push(entry)
  }
  return cycles
}

// --- Cycle summaries -------------------------------------------------------

export function cycleCounts(cycle: Cycle): string {
  const counts: Record<string, number> = {}
  for (const entry of cycle.items) {
    const key = entry.kind === 'message' ? (entry.item as Message | ClaudeMessage).role : entry.kind
    counts[key] = (counts[key] || 0) + 1
  }
  return [
    counts.user ? `${counts.user} prompt` : null,
    counts.assistant ? `${counts.assistant} answer` : null,
    counts.tool ? `${counts.tool} tool` : null,
    counts.thinking ? `${counts.thinking} thinking` : null,
    counts.edit ? `${counts.edit} edit` : null,
    counts.usage ? `${counts.usage} usage` : null,
    counts.runtime ? `${counts.runtime} runtime` : null,
    counts.subagent ? `${counts.subagent} subagent` : null,
    counts.context ? `${counts.context} context` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

// A cycle's usage = the exact sum of its measured usage frames' `last` totals. Uniform:
// both Codex TokenEvent.last and Claude ClaudeUsageFrame.last are TokenUsage.
export function cycleUsage(cycle: Cycle): TokenUsage {
  return cycle.items
    .filter((entry): entry is Extract<UnifiedEntry, { kind: 'usage' }> => entry.kind === 'usage')
    .reduce((sum, entry) => addUsage(sum, entry.item.last), {})
}

// --- Per-entry usage attribution -------------------------------------------
// Codex records tokens only per model TURN (the token_count events), never per card, so
// each frame's real usage is distributed across the cards it closes (weighted by text
// length) → `estimated: true`. Claude records real usage per assistant message, so each
// usage frame is already measured (`estimated: false`) and content cards get no bar.

export interface EntryUsage {
  usage: TokenUsage
  estimated: boolean
}

function entryWeightText(e: UnifiedEntry): string {
  switch (e.kind) {
    case 'message':
      return (e.item as Message).text || ''
    case 'thinking':
      return (e.item as Reasoning).text || ''
    case 'context':
      return (e.item as ContextBlock).text || ''
    case 'tool': {
      const t = e.item as Tool
      return `${t.arguments || ''}${t.output || ''}`
    }
    case 'edit':
      return (e.item as CodeEdit).patch || ''
    default:
      return ''
  }
}

type Acc = { freshInput: number; cachedInput: number; output: number; reasoning: number }

function partsToUsage(p: Acc): TokenUsage {
  return {
    input_tokens: p.freshInput + p.cachedInput,
    cached_input_tokens: p.cachedInput,
    output_tokens: p.output + p.reasoning,
    reasoning_output_tokens: p.reasoning,
    total_tokens: p.freshInput + p.cachedInput + p.output + p.reasoning,
  }
}

function attributeFrame(frame: TokenUsage | null | undefined, cards: UnifiedEntry[], result: Map<UnifiedEntry, EntryUsage>) {
  if (cards.length === 0) return
  const acc = new Map<UnifiedEntry, Acc>()
  const bucket = (e: UnifiedEntry): Acc => {
    let v = acc.get(e)
    if (!v) {
      v = { freshInput: 0, cachedInput: 0, output: 0, reasoning: 0 }
      acc.set(e, v)
    }
    return v
  }

  const parts = splitUsage(frame)

  const reasoningCards = cards.filter((e) => e.kind === 'thinking')
  const outputCards = cards.filter((e) => e.kind === 'message' && (e.item as Message).role === 'assistant')
  const inputCards = cards.filter(
    (e) =>
      e.kind === 'context' ||
      (e.kind === 'message' && (e.item as Message).role === 'user') ||
      e.kind === 'tool' ||
      e.kind === 'edit',
  )

  const distribute = (pool: number, group: UnifiedEntry[], key: keyof Acc) => {
    if (pool <= 0 || group.length === 0) return
    const weights = group.map((e) => entryWeightText(e).length)
    const totalW = weights.reduce((s, w) => s + w, 0)
    group.forEach((e, i) => {
      const share = totalW > 0 ? pool * (weights[i] / totalW) : pool / group.length
      bucket(e)[key] += share
    })
  }

  distribute(parts.reasoning, reasoningCards, 'reasoning')
  distribute(parts.output, outputCards, 'output')
  distribute(parts.freshInput, inputCards, 'freshInput')
  distribute(parts.cachedInput, inputCards, 'cachedInput')

  for (const [e, p] of acc) result.set(e, { usage: partsToUsage(p), estimated: true })
}

export function attributeCycleUsage(cycle: Cycle, source: SessionSource): Map<UnifiedEntry, EntryUsage> {
  const result = new Map<UnifiedEntry, EntryUsage>()

  if (source === 'claude') {
    // Claude: only usage frames carry a (measured) bar; content cards carry none.
    for (const e of cycle.items) {
      if (e.kind === 'usage') result.set(e, { usage: e.item.last ?? {}, estimated: false })
    }
    return result
  }

  // Codex: segment the cycle at each token frame and attribute the closed cards.
  let pending: UnifiedEntry[] = []
  for (const e of cycle.items) {
    if (e.kind === 'usage') {
      const last = (e.item as TokenEvent).last
      attributeFrame(last, pending, result)
      if (last) result.set(e, { usage: last, estimated: false })
      pending = []
    } else {
      pending.push(e)
    }
  }
  return result
}

// --- Timing ----------------------------------------------------------------
// Every entry carries a wall-clock `timestamp`, so a cycle's span is derivable
// with no indexer changes. Two spans matter, because the split already isolates
// human touchpoints into their own cycles (so WITHIN a cycle the AI is working
// continuously — the only in-cycle human wait is the owner deliberating over an
// AskUserQuestion, which heads an answer-cycle):
//   • total   = last − first timestamp. For an answer-cycle the leading item is
//     the AskUserQuestion tool, whose timestamp is the ASK time (end of the
//     prior turn) — so `total` includes the owner's deliberation.
//   • working = last − first-AI-action-after-the-touchpoint. Excludes that
//     deliberation. For a plain prompt cycle the two coincide (the prompt's
//     send-time ≈ when the AI starts), so this only diverges where it should.

function entryMs(entry: UnifiedEntry): number | null {
  const raw = (entry.item as { timestamp?: string | null }).timestamp
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? null : t
}

export interface CycleTiming {
  startMs: number | null // first timestamp — the human touchpoint
  endMs: number | null // last timestamp — cycle end
  workStartMs: number | null // first AI action after the touchpoint
  totalMs: number | null // endMs − startMs (includes owner deliberation)
  workingMs: number | null // endMs − workStartMs (excludes owner deliberation)
  waitMs: number | null // workStartMs − startMs (owner deliberation / lead-in)
}

export function cycleTiming(cycle: Cycle): CycleTiming {
  const empty: CycleTiming = { startMs: null, endMs: null, workStartMs: null, totalMs: null, workingMs: null, waitMs: null }
  const times = cycle.items.map(entryMs).filter((t): t is number => t != null)
  if (times.length === 0) return empty
  const startMs = Math.min(...times)
  const endMs = Math.max(...times)
  // The leading item is the human touchpoint (prompt / interjection / answer);
  // context-only cycles have none to skip.
  const leading = cycleOrigin(cycle) === 'context' ? null : cycle.items[0]
  const restTimes = cycle.items.filter((e) => e !== leading).map(entryMs).filter((t): t is number => t != null)
  const workStartMs = restTimes.length ? Math.min(...restTimes) : startMs
  return {
    startMs,
    endMs,
    workStartMs,
    totalMs: endMs - startMs,
    workingMs: endMs - workStartMs,
    waitMs: Math.max(0, workStartMs - startMs),
  }
}

export interface StepDuration {
  ms: number | null // time until the next event — how long this step ran (null for the last)
  wait: boolean // this step is the owner deliberating over an AskUserQuestion, not AI work
}

// Per-card duration: the gap from each entry to the next (chronologically). The
// leading answer tool's gap IS the owner's deliberation → flagged `wait` so the
// UI labels it "waiting on you" rather than counting it as a working step.
export function stepDurations(cycle: Cycle): Map<UnifiedEntry, StepDuration> {
  const map = new Map<UnifiedEntry, StepDuration>()
  const ordered = cycle.items
    .map((e) => ({ e, t: entryMs(e) }))
    .filter((x): x is { e: UnifiedEntry; t: number } => x.t != null)
    .sort((a, b) => a.t - b.t)
  const leading = cycleOrigin(cycle) === 'answer' ? cycle.items[0] : null
  for (let i = 0; i < ordered.length; i++) {
    const next = ordered[i + 1]
    map.set(ordered[i].e, { ms: next ? next.t - ordered[i].t : null, wait: ordered[i].e === leading })
  }
  return map
}

// --- Titles / model+effort -------------------------------------------------

function isInjectedContext(text: string): boolean {
  return text.includes('# AGENTS.md instructions') || text.includes('<environment_context>')
}

// Is this message entry a genuine owner prompt — typed OR interjected (source-aware)?
// Shares the exact predicate the cycle splitter uses, so labels track boundaries.
function isRealUserMessage(e: UnifiedEntry): e is Extract<UnifiedEntry, { kind: 'message' }> {
  return isHumanPrompt(e)
}

const clip = (raw: string): string | null => {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}

function realUserPrompt(cycle: Cycle): string | null {
  for (const e of cycle.items) {
    if (!isRealUserMessage(e)) continue
    const raw = (e.item as Message | ClaudeMessage).text?.trim() || ''
    if (!raw || isInjectedContext(raw)) continue
    const t = clip(raw)
    if (t) return t
  }
  return null
}

// The owner's answer to an AskUserQuestion, when that Q&A heads the cycle. Prefer the
// structured selected answers; fall back to the flattened result text.
function answerLabel(cycle: Cycle): string | null {
  const head = cycle.items[0]
  if (!head || !isAnsweredQuestion(head)) return null
  if (head.source === 'claude') {
    const t = head.item as ClaudeTool
    const raw = t.result?.raw
    if (raw && typeof raw === 'object' && 'answers' in raw) {
      const answers = (raw as { answers?: unknown }).answers
      if (answers && typeof answers === 'object') {
        const joined = Object.values(answers as Record<string, unknown>)
          .filter((v) => typeof v === 'string' && v)
          .join(', ')
        const t2 = clip(joined)
        if (t2) return t2
      }
    }
    return clip(t.result?.text || '')
  }
  return clip((head.item as Tool).output || '')
}

export function cyclePrompt(cycle: Cycle): string {
  return realUserPrompt(cycle) ?? answerLabel(cycle) ?? 'context only'
}

export function isContextOnlyCycle(cycle: Cycle): boolean {
  return realUserPrompt(cycle) === null && answerLabel(cycle) === null
}

// What kind of human touchpoint opened this cycle — drives the small tag on each row.
export type CycleOrigin = 'prompt' | 'interjection' | 'answer' | 'context'

export function cycleOrigin(cycle: Cycle): CycleOrigin {
  const head = cycle.items[0]
  if (head) {
    if (isAnsweredQuestion(head)) return 'answer'
    if (isHumanPrompt(head)) {
      const queued = head.source === 'claude' && (head.item as ClaudeMessage).prompt_source === 'queued'
      return queued ? 'interjection' : 'prompt'
    }
  }
  return 'context'
}

// Model + reasoning effort for a cycle: the latest turn_context at/before its first line.
// Both TurnContext and ClaudeTurnCtx share { line, model, effort } — one impl serves both.
export function cycleModelEffort(
  cycle: Cycle,
  turnContexts: Array<{ line: number; model: string | null; effort: string | null }> | ClaudeTurnCtx[] | undefined,
): { model: string | null; effort: string | null } {
  const line = cycle.items[0]?.line ?? cycle.startLine
  let picked: { model: string | null; effort: string | null } | null = null
  for (const tc of turnContexts || []) {
    if (tc.line <= line) picked = tc
    else break
  }
  return { model: picked?.model ?? null, effort: picked?.effort ?? null }
}
