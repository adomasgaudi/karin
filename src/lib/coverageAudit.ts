import type { FeedRecord, Session, UnifiedSession } from '../types'
import type { ClaudeDetailSession } from './claudeModel'

export type CoverageStatus = 'unhandled' | 'reclassified' | 'merged' | 'parse_error'

export interface CoverageFinding {
  status: CoverageStatus
  name: string
  count: number
  reason: string
  lines: number[]
}

export interface CoverageAudit {
  rawRecords: number
  structuredRows: number
  loaded: boolean
  findings: CoverageFinding[]
  notAvailable: Array<{ name: string; reason: string }>
}

type SourceSession = Session | ClaudeDetailSession
type AnyRecord = Record<string, unknown>

function objectOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null
}

function linesOf(values: unknown): Set<number> {
  if (!Array.isArray(values)) return new Set()
  return new Set(
    values
      .map((value) => Number(objectOf(value)?.line))
      .filter((line) => Number.isFinite(line) && line > 0),
  )
}

function recordLine(record: FeedRecord): number {
  return Number(record._line) || 0
}

function addFinding(
  findings: Map<string, CoverageFinding>,
  status: CoverageStatus,
  name: string,
  reason: string,
  line: number,
) {
  const key = `${status}:${name}:${reason}`
  const existing = findings.get(key)
  if (existing) {
    if (line > 0 && !existing.lines.includes(line)) existing.lines.push(line)
    existing.count += 1
    return
  }
  findings.set(key, { status, name, count: 1, reason, lines: line > 0 ? [line] : [] })
}

function totalFromCounts(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0)
}

function codexAudit(raw: Session, records: FeedRecord[], findings: Map<string, CoverageFinding>) {
  const messages = linesOf(raw.messages)
  const contexts = linesOf(raw.contexts)
  const reasoning = linesOf(raw.reasoning)
  const tools = linesOf(raw.tools?.length ? raw.tools : raw.tool_previews)
  const edits = linesOf(raw.code_edits)
  const tokens = linesOf(raw.token_events)
  const runtime = linesOf(raw.runtime_events)
  const resultLines = new Set(
    (raw.code_edits ?? [])
      .map((edit) => edit.result?.line)
      .filter((line): line is number => typeof line === 'number' && line > 0),
  )
  const toolCallIds = new Set(
    (raw.tools ?? []).map((tool) => tool.call_id).filter((id): id is string => Boolean(id)),
  )

  for (const record of records) {
    const line = recordLine(record)
    const topType = record._type
    const payload = objectOf(record.payload)
    const subtype = typeof payload?.type === 'string' ? payload.type : ''
    const callId = typeof payload?.call_id === 'string' ? payload.call_id : null

    if (topType === 'session_meta' || topType === 'turn_context') {
      if (!contexts.has(line)) addFinding(findings, 'unhandled', topType, 'Source metadata was not promoted to a context row.', line)
      continue
    }
    if (topType === 'world_state' || topType === 'compacted') {
      addFinding(findings, 'unhandled', topType, 'Codex stores this stream-state record, but the structured session view does not render it.', line)
      continue
    }
    if (topType === 'response_item') {
      if (subtype === 'message') {
        if (contexts.has(line) && messages.has(line)) {
          addFinding(findings, 'reclassified', 'developer/startup message', 'The same source line is surfaced in both the message and injected-context views.', line)
        } else if (!messages.has(line) && !contexts.has(line)) {
          addFinding(findings, 'unhandled', `response_item/${subtype}`, 'No structured message or context row points to this source line.', line)
        }
      } else if (subtype === 'reasoning') {
        if (!reasoning.has(line)) addFinding(findings, 'unhandled', `response_item/${subtype}`, 'No reasoning row points to this source line.', line)
      } else if (subtype.endsWith('_call') || subtype === 'function_call') {
        if (edits.has(line) && callId) {
          addFinding(findings, 'merged', 'tool call / edit', 'The edit row is the canonical presentation for this call; the duplicate generic tool row is suppressed.', line)
        } else if (!tools.has(line) && !edits.has(line)) {
          addFinding(findings, 'unhandled', `response_item/${subtype}`, 'No structured tool or edit row points to this source line.', line)
        }
      } else if (subtype.endsWith('_output')) {
        if (callId && toolCallIds.has(callId)) {
          addFinding(findings, 'merged', 'tool output', 'The output is attached to its call row and is not rendered as a second card.', line)
        } else {
          addFinding(findings, 'unhandled', `response_item/${subtype}`, 'The output has no matching structured tool call.', line)
        }
      } else {
        addFinding(findings, 'unhandled', `response_item/${subtype || 'unknown'}`, 'This response item type has no shared structured renderer yet.', line)
      }
      continue
    }
    if (topType === 'event_msg') {
      if (subtype === 'token_count') {
        if (!tokens.has(line)) addFinding(findings, 'unhandled', 'event_msg/token_count', 'No token-count row points to this source line.', line)
      } else if (subtype === 'patch_apply_end') {
        if (resultLines.has(line)) addFinding(findings, 'merged', 'patch completion', 'The completion is attached to its edit row instead of becoming a duplicate event card.', line)
        else addFinding(findings, 'unhandled', 'event_msg/patch_apply_end', 'No edit row contains this patch completion.', line)
      } else if (subtype === 'task_complete') {
        addFinding(findings, 'unhandled', 'event_msg/task_complete', 'Stored in task_completions for accounting, but not rendered as a cycle event.', line)
      } else if (subtype === 'agent_message' || subtype === 'user_message') {
        addFinding(findings, 'unhandled', `event_msg/${subtype}`, 'Transport message kept in the raw feed, not rendered as a chat card.', line)
      } else if (!runtime.has(line)) {
        addFinding(findings, 'unhandled', `event_msg/${subtype || 'unknown'}`, 'No runtime row points to this event line.', line)
      }
      continue
    }
    addFinding(findings, 'unhandled', topType || 'unknown', 'This top-level Codex record type has no structured renderer yet.', line)
  }
}

function claudeAudit(raw: ClaudeDetailSession, records: FeedRecord[], findings: Map<string, CoverageFinding>) {
  const messages = linesOf(raw.messages)
  const thinking = linesOf(raw.thinking)
  const tools = linesOf(raw.tools)
  const usage = linesOf(raw.usage_frames)
  const contexts = linesOf(raw.contexts)
  const resultLines = new Set(
    (raw.tools ?? []).map((tool) => tool.result_line).filter((line): line is number => typeof line === 'number' && line > 0),
  )
  const contextTypes = new Set([
    'system', 'attachment', 'mode', 'permission-mode', 'bridge-session',
    'file-history-snapshot', 'file-history-delta', 'queue-operation', 'last-prompt',
    'ai-title', 'custom-title', 'relocated', 'worktree-state', 'frame-link',
  ])

  for (const record of records) {
    const line = recordLine(record)
    const type = record._type
    if (type === 'assistant') {
      if (!messages.has(line) && !thinking.has(line) && !tools.has(line) && !usage.has(line)) {
        addFinding(findings, 'unhandled', type, 'No structured message, thinking, tool, or usage row points to this assistant line.', line)
      }
    } else if (type === 'user') {
      if (!messages.has(line) && !resultLines.has(line)) {
        addFinding(findings, 'unhandled', type, 'This user record is neither a rendered prompt nor a tool-result carrier.', line)
      } else if (resultLines.has(line) && !messages.has(line)) {
        addFinding(findings, 'merged', 'tool result', 'The result is attached to its tool row instead of becoming a duplicate user card.', line)
      }
    } else if (contextTypes.has(type)) {
      if (!contexts.has(line)) addFinding(findings, 'unhandled', type, 'No structured context row points to this source line.', line)
    } else {
      addFinding(findings, 'unhandled', type || 'unknown', 'This Claude record type has no shared structured renderer yet.', line)
    }
  }
}

export function buildCoverageAudit(session: UnifiedSession): CoverageAudit {
  const raw = session.raw as SourceSession
  const audit = raw.audit
  const records = session.rawRecords ?? []
  const rawRecords = session.recordCount ?? (
    session.source === 'claude'
      ? (raw as ClaudeDetailSession).record_count
      : totalFromCounts((raw as Session).audit.record_counts)
  )
  const structuredRows = (audit?.visible ?? []).reduce((sum, item) => sum + item.count, 0)
  const loaded = rawRecords === 0 || records.length > 0
  const findings = new Map<string, CoverageFinding>()

  if (loaded) {
    if (session.source === 'codex') codexAudit(raw as Session, records, findings)
    if (session.source === 'claude') claudeAudit(raw as ClaudeDetailSession, records, findings)
    for (const line of ((raw as SourceSession).parse_error_lines ?? [])) {
      addFinding(findings, 'parse_error', 'malformed JSONL', 'The indexer could not parse this source line, so no structured row can represent it.', line)
    }
  }

  return {
    rawRecords,
    structuredRows,
    loaded,
    findings: [...findings.values()].map((finding) => ({ ...finding, lines: finding.lines.sort((a, b) => a - b) })),
    notAvailable: audit?.not_available ?? [],
  }
}
