// Mirrors the JSON emitted by bin/karin.py (window.KARIN_DATA / karin-data.js).

export interface TokenUsage {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
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
