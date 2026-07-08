// TypeScript mirror of the ENRICHED CLAUDE SESSION SHAPE emitted per session by
// bin/karin_claude.py, ALONGSIDE the raw `records[]` (nothing removed). This is the
// structured data model the detail view renders — the Claude counterpart to the Codex
// `Session` in ../types. Moved here from src/components/claude/detail/model.ts so the
// unified layer (lib/adapt.ts, lib/unifiedCycles.ts) can depend on it.
//
// Every Claude record type stays reachable: structured cards here plus the raw
// `records[]`. Claude-only signal (thinking signature, cache-read vs cache-create incl
// 5m/1h, structured tool results, sub-agents, permission/mode, attribution,
// service_tier/speed) is preserved on these types — never dropped.

import type { TokenUsage } from '../types'
import type { ClaudeRecord, ClaudeUsageTotals } from './claudeRaw'

// --- Leaf records ----------------------------------------------------------

export interface ClaudeMessage {
  line: number
  timestamp: string | null
  role: 'user' | 'assistant'
  text: string
  uuid: string | null
  parent_uuid: string | null
  model: string | null
  stop_reason: string | null
  message_id: string | null
  is_sidechain: boolean
  is_meta: boolean
  is_compact_summary: boolean
  origin_kind: string | null // 'human' | 'agent' | 'compact' | ...
  prompt_source: string | null // 'typed' | 'queued' | 'tool' | ...
  phase: null // Claude has no Codex-style commentary/final phase
}

// A Claude thinking block. Unlike Codex reasoning, the text is VISIBLE plaintext; the
// `signature` (when present) attests it — render a "signed" pill, never "locked".
export interface ClaudeThinking {
  line: number
  timestamp: string | null
  id: string | null
  text: string
  signature: string | null
  model: string | null
}

// The result attached to a tool_use, harvested from the following user tool_result.
export interface ClaudeToolResult {
  raw: unknown // full structured tool_result content (structuredPatch, todos, etc.)
  text: string // flattened text form
  kind: string // dispatch hint: 'bash' | 'edit' | 'read' | 'grep' | ... | 'json'
}

// A tool_use call plus its result. `input` is the parsed object; `arguments` its JSON
// string form (mirrors the Codex `Tool.arguments` string for shared display code).
export interface ClaudeTool {
  line: number
  timestamp: string | null
  call_id: string // tool_use.id
  name: string
  input: Record<string, unknown>
  arguments: string
  caller: string | null // 'assistant' | agent id for sidechain callers
  result: ClaudeToolResult | null
  result_line: number | null
  is_error: boolean
  is_sidechain: boolean
}

// A file-mutating tool call (Edit / Write / MultiEdit / NotebookEdit …) surfaced as its
// own entry so diffs render as diffs. `result` is null: the outcome lives on the diff.
export interface ClaudeEdit {
  line: number
  timestamp: string | null
  call_id: string
  name: string
  file_path: string | null
  operation: string | null // 'edit' | 'write' | 'multi-edit' | ...
  patch: string
  structured_patch: unknown // structuredPatch hunks (context / +added / -removed)
  old_string: string | null
  new_string: string | null
  content: string | null // full new content for Write
  user_modified: boolean
  result: null
}

// One MEASURED usage frame (per assistant message that reports usage). `last` is this
// message's own usage; `total` the running total; `usage_raw` the untouched Claude usage
// object (cache_creation.ephemeral_5m/1h, service_tier, etc.) for lossless display.
export interface ClaudeUsageFrame {
  line: number
  timestamp: string | null
  model: string | null
  message_id: string | null
  last: TokenUsage
  total: TokenUsage
  context_window: null
  usage_raw: Record<string, unknown>
}

// Any non-conversational context payload — system / attachment / mode / permission-mode /
// bridge-session / file-history-snapshot / queue-operation / last-prompt / ai-title.
export interface ClaudeContext {
  line: number
  timestamp: string | null
  name: string
  source: string
  visibility: 'visible'
  chars: number
  text: string
  subtype: string | null // system subtype (hook / compact-boundary / ...)
  attachment_type: string | null
  raw: unknown // untouched source record for the raw disclosure
}

// One entry per model change — named `turn_contexts` for drop-in reuse with
// cycleModelEffort (mirrors the Codex TurnContext). Claude has no effort field.
export interface ClaudeTurnCtx {
  line: number
  timestamp: string | null
  model: string | null
  effort: null
}

// A spawned sub-agent (Task/Agent tool). `session` is a fully nested enriched session —
// its own messages/tools/usage — so sub-agent transcripts stay reachable.
export interface ClaudeSubagent {
  agent_id: string
  agent_type: string
  description: string
  tool_use_id: string
  spawn_depth: number
  parent_line: number
  session: ClaudeDetailSession
  usage_totals: ClaudeUsageTotals
}

// --- Aggregate metadata ----------------------------------------------------

export interface ClaudeCounts {
  user: number
  assistant: number
  tool_calls: number
  tool_outputs: number
  code_edits: number
  thinking: number
  contexts: number
  usage_frames: number
  subagents: number
}

// Data-loss ledger: what is shown as structured, and what genuinely has no data — plus
// the raw tallies that let the view prove every record type is accounted for.
export interface ClaudeAudit {
  visible: Array<{ name: string; count: number; source: string }>
  not_available: Array<{ name: string; reason: string }>
  record_type_counts: Record<string, number>
  content_block_counts: Record<string, number>
  role_counts: Record<string, number>
  system_subtype_counts: Record<string, number>
  attachment_type_counts: Record<string, number>
}

// Provider/plugin attribution for a session, when Claude records it.
export interface ClaudeAttribution {
  mcp_server: string | null
  mcp_tool: string | null
  skill: string | null
  plugin: string | null
}

// --- The enriched session --------------------------------------------------

export interface ClaudeDetailSession {
  // Existing raw meta (unchanged from the explorer's ClaudeSession) --------------
  id: string
  file: string
  slug: string
  title: string
  first_prompt: string
  started_at: string | null
  updated_at: string | null
  model: string | null
  models: string[]
  version: string | null
  gitBranch: string | null
  cwd: string | null
  record_count: number
  type_counts: Record<string, number>
  usage_totals: ClaudeUsageTotals
  records: ClaudeRecord[] // raw JSONL lines — kept for the Raw toggle

  // Enriched structured arrays ---------------------------------------------------
  messages: ClaudeMessage[]
  thinking: ClaudeThinking[]
  tools: ClaudeTool[]
  code_edits: ClaudeEdit[]
  usage_frames: ClaudeUsageFrame[]
  contexts: ClaudeContext[]
  turn_contexts: ClaudeTurnCtx[]
  subagents: ClaudeSubagent[]
  counts: ClaudeCounts
  audit: ClaudeAudit
  latest_total_usage: TokenUsage // running total of the last usage_frame

  // Claude-only session meta (carried when present) ------------------------------
  entrypoint?: string | null
  permission_modes?: string[]
  session_kind?: string | null
  service_tier?: string | null
  speed?: string | null
  bridge_session_id?: string | null
  attribution?: ClaudeAttribution
}
