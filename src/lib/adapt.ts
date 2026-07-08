// Adapters: Codex `Session` and Claude `ClaudeSession` → the shared `UnifiedSession`.
// The sidebar reads the flat summary produced here; the detail/cycle builder reads the
// enriched source session carried verbatim on `raw`. This is the ONE seam where the two
// data pipelines meet — everything downstream sees one shape.

import type { KarinData, Session, UnifiedSession, UnifiedMetaRow } from '../types'
import type { ClaudeProject, ClaudeRawData, ClaudeSession } from './claudeRaw'
import type { ClaudeDetailSession } from './claudeModel'
import { claudeTurnState, codexTurnState } from './turnState'

function metaRow(label: string, value: string | number | null | undefined): UnifiedMetaRow {
  return { label, value: value === null || value === undefined || value === '' ? null : String(value) }
}

// --- Codex -----------------------------------------------------------------

function codexHaystack(s: Session): string {
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

export function adaptCodexSession(s: Session): UnifiedSession {
  return {
    uid: `codex:${s.id}`,
    source: 'codex',
    id: s.id,
    title: s.title,
    subtitle: null,
    cwd: s.cwd,
    model: s.model,
    models: s.models ?? (s.model ? [s.model] : []),
    started_at: s.started_at,
    updated_at: s.updated_at,
    counts: {
      user: s.counts.user,
      assistant: s.counts.assistant,
      tool_calls: s.counts.tool_calls,
      code_edits: s.counts.code_edits,
      contexts: s.counts.contexts,
    },
    latest_total_usage: s.latest_total_usage,
    turnState: codexTurnState(s),
    projectSlug: null,
    projectCwd: null,
    haystack: codexHaystack(s),
    meta: [
      metaRow('model', s.models?.length ? s.models.join(', ') : s.model),
      metaRow('effort', s.efforts?.length ? s.efforts.join(', ') : s.reasoning_effort),
      metaRow('codex', s.cli_version),
      metaRow('fast', s.fast_mode == null ? null : s.fast_mode ? 'on' : 'off'),
      metaRow('cwd', s.cwd),
      metaRow('path', s.path),
    ],
    raw: s,
  }
}

export function adaptCodexData(d: KarinData | null): UnifiedSession[] {
  return (d?.sessions ?? []).map(adaptCodexSession)
}

// --- Claude ----------------------------------------------------------------

function claudeHaystack(s: ClaudeDetailSession): string {
  return [
    s.title,
    s.first_prompt,
    s.id,
    s.cwd,
    ...(s.messages || []).map((m) => m.text),
    ...(s.contexts || []).map((c) => c.text),
    ...(s.thinking || []).map((t) => t.text),
    ...(s.tools || []).map((t) => `${t.name} ${t.arguments}`),
    ...(s.code_edits || []).map((e) => `${e.name} ${e.patch}`),
  ]
    .join('\n')
    .toLowerCase()
}

// Tidy a raw label: collapse whitespace, strip wrapping quotes, clip to a sane width.
function cleanTitle(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim().replace(/^["'`]+|["'`]+$/g, '').trim()
  return t.length > 60 ? `${t.slice(0, 60)}…` : t
}

// The tab label Claude Code generated for this session: the assistant output of its newest
// terminal-tab-label op (title_ops are newest-first, folded in by the indexer). Because
// Claude regenerates that label as the conversation's topic shifts, it tracks the LATEST
// topic — a far better session name than the frozen first prompt.
function generatedLabel(session: ClaudeSession): string | null {
  const ops = (session as unknown as { title_ops?: Array<{ messages?: Array<{ role?: string; text?: string | null }> }> }).title_ops
  for (const op of ops || []) {
    const msgs = op.messages
    if (!Array.isArray(msgs)) continue
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m?.role === 'assistant' && m.text && m.text.trim()) return cleanTitle(m.text)
    }
  }
  return null
}

// Fallback when there is no generated label and no real ai-title: the LATEST substantive
// human prompt (skipping terse ones like "fix" / "ok" and injected environment blocks), so
// the name still reflects where the session went, not just where it started.
function latestHumanPrompt(s: ClaudeDetailSession): string | null {
  const msgs = s.messages || []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i] as { role?: string; origin_kind?: string; text?: string | null }
    if (m.role !== 'user' || (m.origin_kind && m.origin_kind !== 'human')) continue
    const t = (m.text || '').replace(/\s+/g, ' ').trim()
    if (t.length < 8 || t.includes('# AGENTS.md instructions') || t.includes('<environment_context>')) continue
    return cleanTitle(t)
  }
  return null
}

// Best session name, in priority order: Claude's own latest generated tab label → a real
// ai-title record → the latest substantive prompt → the indexer title → the id.
function bestClaudeTitle(s: ClaudeDetailSession, session: ClaudeSession): string {
  const generated = generatedLabel(session)
  if (generated) return generated
  // s.title = `ai_title or first_prompt[:80]`; if it differs from the first prompt it is a
  // real ai-title, which beats a raw prompt.
  const firstClip = (s.first_prompt || '').slice(0, 80).trim()
  const t = (s.title || '').trim()
  if (t && t !== firstClip) return cleanTitle(t)
  return latestHumanPrompt(s) || t || s.id
}

// A raw ClaudeSession from the feed is already enriched (bin/karin_claude.py emits the
// structured arrays alongside `records`); the raw type just doesn't declare them.
export function adaptClaudeSession(session: ClaudeSession, project: ClaudeProject): UnifiedSession {
  const s = session as unknown as ClaudeDetailSession
  const c = session.counts
  const attribution = s.attribution
  return {
    uid: `claude:${s.id}`,
    source: 'claude',
    id: s.id,
    title: bestClaudeTitle(s, session),
    subtitle: s.first_prompt || null,
    cwd: s.cwd,
    model: s.model,
    models: s.models ?? (s.model ? [s.model] : []),
    started_at: s.started_at,
    updated_at: s.updated_at,
    counts: {
      user: c?.user ?? 0,
      assistant: c?.assistant ?? 0,
      tool_calls: c?.tool_calls ?? 0,
      code_edits: c?.code_edits ?? 0,
      thinking: c?.thinking,
      contexts: c?.contexts,
      subagents: c?.subagents,
    },
    latest_total_usage: s.latest_total_usage ?? session.latest_total_usage ?? null,
    turnState: claudeTurnState(s),
    projectSlug: project.slug,
    projectCwd: project.cwd,
    haystack: claudeHaystack(s),
    meta: [
      metaRow('model', s.models?.length ? s.models.join(', ') : s.model),
      metaRow('version', s.version),
      metaRow('branch', s.gitBranch),
      metaRow('entry', s.entrypoint),
      metaRow('tier', s.service_tier),
      metaRow('modes', s.permission_modes?.length ? s.permission_modes.join(', ') : null),
      metaRow('skill', attribution?.skill),
      metaRow('cwd', s.cwd),
    ],
    raw: s,
    rawRecords: session.records,
    recordTypeCounts: session.type_counts,
    recordCount: session.record_count,
    titleOps: session.title_ops,
  }
}

export function adaptClaudeData(d: ClaudeRawData | null): UnifiedSession[] {
  return (d?.projects ?? []).flatMap((p) => (p.sessions ?? []).map((s) => adaptClaudeSession(s, p)))
}

// --- Merge -----------------------------------------------------------------

// Both sources, most-recent first — the combined list backing the unified sidebar.
export function mergeSessions(codex: KarinData | null, claude: ClaudeRawData | null): UnifiedSession[] {
  return [...adaptCodexData(codex), ...adaptClaudeData(claude)].sort(
    (a, b) => Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? ''),
  )
}
