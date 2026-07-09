// Types for the Warp raw-data feed (data/warp-raw.json, produced by
// `python bin/karin_warp.py`). Adapter INPUT types — consumed by lib/adapt.ts and the
// raw-mode renderer, mirroring lib/claudeRaw.ts.
//
// Warp is the owner's terminal agent. Unlike Codex and Claude it runs SEVERAL models in
// one conversation: a primary agent (the owner's custom DeepSeek endpoint, `v4-flash` /
// `v4-pro`) plus small built-in models for tool summarization and terminal use. So
// `model` is the primary agent and `models` lists everyone who spent tokens.
//
// The structured arrays reuse the Codex item shapes (Message/Tool/Reasoning/CodeEdit) on
// purpose: the indexer emits them in that shape so the unified cycle builder and event
// renderer need no Warp-specific item types.

import type { CodeEdit, Message, Reasoning, TokenUsage, Tool } from '../types'

// Warp reports ONE cumulative token scalar per model per bucket — never an input/output
// split, and never a per-turn frame. `total` is the sum of the three buckets.
//   warp_tokens            billed against the Warp subscription
//   byok_tokens            the user's own key, through Warp's provider integration
//   custom_endpoint_tokens the user's own endpoint (this is where DeepSeek lands)
export interface WarpModelUsage {
  model: string | null
  warp_tokens: number
  byok_tokens: number
  custom_endpoint_tokens: number
  total: number
  categories: {
    warp: Record<string, number>
    byok: Record<string, number>
    custom_endpoint: Record<string, number>
  }
}

// One decoded protobuf event, plus the indexer's `_line` / `_type` decorations. `tree`
// holds the generic wire-format decode, so fields we could not name still reach the Raw
// tab under their protobuf field number (`f7`, `f25`, …).
export type WarpRecord = Record<string, unknown> & {
  _line: number
  _type: string
  timestamp?: string | null
  uuid?: string | null
  turn_id?: string | null
  tool?: string
  text?: string
  tree?: unknown
}

// Tool calls additionally record which provider emitted the call id
// (`toolu_…` → anthropic, `call_…` → openai-compatible, which is what DeepSeek speaks).
export type WarpTool = Tool & { provider?: string | null }

export interface WarpSubagent {
  line: number
  timestamp: string | null
  description: string
}

export interface WarpSession {
  id: string
  title: string
  first_prompt: string
  agent_name: string | null
  run_id: string | null
  parent_conversation_id: string | null
  harness: string | null
  started_at: string | null
  updated_at: string | null
  model: string | null
  models: string[]
  cwd: string | null
  gitBranch: string | null
  repo: string | null
  shell: string | null
  context_window_usage: number | null
  credits_spent: number | null
  was_summarized: boolean | null
  model_usage: WarpModelUsage[]
  tool_usage_metadata: Record<string, unknown>
  latest_total_usage: TokenUsage
  record_count: number
  type_counts: Record<string, number>
  records: WarpRecord[]
  // Codex-shaped arrays — see the module comment.
  messages: Message[]
  reasoning: Reasoning[]
  tools: WarpTool[]
  code_edits: CodeEdit[]
  token_events: never[] // always empty: Warp has no per-turn usage frames
  contexts: never[]
  runtime_events: never[]
  subagents: WarpSubagent[]
  prompt_statuses: (string | null)[]
  counts: {
    user: number
    assistant: number
    tool_calls: number
    tool_outputs: number
    code_edits: number
    reasoning: number
    contexts: number
    usage_frames: number
    subagents: number
  }
}

export interface WarpRawData {
  generated_at: string
  warp_db: string
  session_count: number
  conversations: WarpSession[]
}

// Narrowing guard used by the loader. `conversations` is the distinguishing key:
// Codex feeds carry `sessions`, Claude feeds carry `projects`.
export function isWarpRawData(value: unknown): value is WarpRawData {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as WarpRawData).conversations)
  )
}

// The primary agent's token spend — what the owner's own API key actually paid for.
export function customEndpointTokens(s: WarpSession): number {
  return (s.model_usage || []).reduce((sum, row) => sum + (row.custom_endpoint_tokens || 0), 0)
}
