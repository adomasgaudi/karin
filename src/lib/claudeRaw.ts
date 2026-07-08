// Types for the Claude Code raw-data feed (data/claude-raw.json, produced by
// `python bin/karin_claude.py`). Adapter INPUT types — consumed by lib/adapt.ts and the
// raw-mode / tool-result renderers. Moved here from src/components/claude/types.ts so the
// unified layer can depend on them without reaching into a component folder.

import type { TokenUsage } from '../types'

export interface ClaudeUsageTotals {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  total_tokens: number
}

// One line of the session JSONL, plus the indexer's `_line` / `_type` decorations.
// It's an open record: any Claude Code log line may carry arbitrary extra keys.
export type ClaudeRecord = Record<string, unknown> & {
  _line: number
  _type: string
  type?: string
  timestamp?: string
  uuid?: string
  message?: unknown
}

export interface ClaudeSession {
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
  records: ClaudeRecord[]
  // Enriched by the indexer (present on structured data; optional so the raw explorer
  // still type-checks against older files).
  counts?: {
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
  latest_total_usage?: TokenUsage
  // Claude-only meta from the indexer.
  entrypoint?: string | null
  session_kind?: string | null
  parent_session_id?: string | null
  // Full auto terminal-tab-label sessions folded under this real session
  // (records included, so the detail view can show each one's content).
  title_ops?: ClaudeSession[]
}

export interface ClaudeProject {
  slug: string
  cwd: string
  session_count: number
  sessions: ClaudeSession[]
}

export interface ClaudeRawData {
  generated_at: string
  claude_home: string
  project_count: number
  session_count: number
  projects: ClaudeProject[]
}

// Narrowing guard used by the loader — mirrors loadData.ts's shape check.
export function isClaudeRawData(value: unknown): value is ClaudeRawData {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as ClaudeRawData).projects)
  )
}
