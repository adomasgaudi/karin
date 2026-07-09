// Mirrors the JSON emitted by bin/karin.py (window.KARIN_DATA / karin-data.js).

export interface TokenUsage {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
  // Claude-only: premium cache-write bucket (default absent for Codex).
  cache_creation_input_tokens?: number
  cache_creation_5m_input_tokens?: number
  cache_creation_1h_input_tokens?: number
}

export interface Message {
  timestamp: string | null
  line: number
  role: string // "user" | "assistant" | "system" | ...
  phase?: string | null // "commentary" | "final" | null
  text: string
}

export interface Tool {
  timestamp: string | null
  line: number
  call_id: string | null
  name: string
  arguments: string
  output: string | null
}

export interface Reasoning {
  timestamp: string | null
  line: number
  id?: string | null
  text: string
}

export interface ContextBlock {
  timestamp: string | null
  line: number
  name: string
  source: string
  visibility: string
  chars: number
  text: string
}

export interface TurnContext {
  timestamp: string | null
  line: number
  model: string | null
  effort: string | null
}

export interface RuntimeEvent {
  timestamp: string | null
  line: number
  type: string
  text: string
}

export interface TokenEvent {
  timestamp: string | null
  line: number
  last?: TokenUsage | null
  total?: TokenUsage | null
  context_window?: number | null
  rate_limits?: unknown
}

export interface PatchResult {
  timestamp: string | null
  line: number
  call_id: string | null
  success?: boolean | null
  status?: string | null
  changes?: unknown
  stdout: string
  stderr: string
}

export interface CodeEdit {
  timestamp: string | null
  line: number
  call_id: string | null
  name: string
  patch: string
  result: PatchResult | null
}

export interface Counts {
  user: number
  assistant: number
  tool_calls: number
  tool_outputs: number
  code_edits: number
  contexts?: number
  reasoning?: number
  runtime_events?: number
}

export interface Audit {
  visible: Array<{ name: string; count: number; source: string }>
  not_available: Array<{ name: string; reason: string }>
  record_counts?: Record<string, number>
  response_item_counts?: Record<string, number>
  role_counts?: Record<string, number>
  event_counts?: Record<string, number>
}

export interface Session {
  id: string
  title: string
  path: string
  cwd: string | null
  originator: string | null
  model: string | null
  cli_version: string | null
  reasoning_effort: string | null
  turn_contexts?: TurnContext[]
  models?: string[]
  efforts?: string[]
  fast_mode: boolean | null
  started_at: string | null
  updated_at: string
  messages: Message[]
  tools: Tool[]
  reasoning: Reasoning[]
  contexts: ContextBlock[]
  runtime_events: RuntimeEvent[]
  token_events: TokenEvent[]
  code_edits: CodeEdit[]
  counts: Counts
  audit: Audit
  latest_total_usage: TokenUsage | null
}

export interface KarinData {
  generated_at: string
  codex_home: string
  session_count: number
  last_checked_at?: string | null
  last_entry_at?: string | null
  session_file_count?: number | null
  sessions: Session[]
}

export interface KarinStatus {
  last_checked_at: string | null
  last_entry_at: string | null
  session_file_count: number | null
}

// --- Unified session model -------------------------------------------------
// One shape both pipelines (Codex `Session` + Claude `ClaudeDetailSession`) adapt into,
// so the sidebar/detail/cycle components read a single summary and never re-branch on
// `if 'records' in s`. Genuine divergence is captured as (a) a few optional fields here
// and (b) the small source-tagged `UnifiedEntry` union in lib/unifiedCycles.ts. The
// underlying enriched session is carried verbatim on `raw` for the cycle builder, which
// is the only place that dispatches on `source` to read source-specific arrays.

export type SessionSource = 'codex' | 'claude' | 'warp'

// Superset counts for a session summary row (Claude-only tallies optional).
export interface UnifiedCounts {
  user: number
  assistant: number
  tool_calls: number
  code_edits: number
  thinking?: number
  contexts?: number
  subagents?: number
}

// One label/value row rendered in the detail header's ⋮ metadata popover. The set of
// rows is source-specific (Codex: path/cli_version/fast_mode/effort; Claude:
// version/branch/entrypoint/service_tier/…), but the row shape is uniform.
export interface UnifiedMetaRow {
  label: string
  value: string | null
}

export interface UnifiedSession {
  uid: string // `${source}:${id}` — globally unique across both sources
  source: SessionSource
  id: string
  title: string
  subtitle: string | null // Claude first_prompt; null for Codex
  cwd: string | null
  model: string | null
  models: string[]
  started_at: string | null
  updated_at: string | null
  counts: UnifiedCounts
  latest_total_usage: TokenUsage | null
  // Turn state deduced from the last record (see lib/turnState.ts): whether the AI is
  // mid-turn ('working'), idle awaiting the human ('waiting'), or cut off ('interrupted').
  // Reflects the last INDEX, not live process state.
  turnState: import('./lib/turnState').TurnState
  // Grouping — Claude sessions live under a project; Codex is flat (null).
  projectSlug: string | null
  projectCwd: string | null
  haystack: string // precomputed lower-cased search blob
  meta: UnifiedMetaRow[] // ⋮ popover rows, source-specific
  // The enriched source session, read only by the cycle builder (dispatched on source).
  raw: unknown
  // Raw-tab extras. Claude fills these from its JSONL lines, Warp from its decoded
  // protobuf events; undefined for Codex, which has no raw view.
  rawRecords?: unknown[] // ClaudeRecord[] | WarpRecord[] — rows for the Raw toggle
  recordTypeCounts?: Record<string, number>
  recordCount?: number
  titleOps?: unknown[] // ClaudeSession[] — folded auto-title label sessions (Claude only)
}
