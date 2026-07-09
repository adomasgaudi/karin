// AI-handoff export: turns every loaded session (every source) into ONE markdown file
// meant to be fed to another AI, which can then summarize what was done across all the
// sessions. The file leads with instructions for that AI, then lists sessions
// chronologically as prompt → work → result digests. Transcript text is clipped hard —
// this is a digest for summarization, not a lossless archive (the JSON feeds are that).

import type { UnifiedSession, Message, Tool, CodeEdit, SessionSource, TokenUsage } from '../types'
import type { ClaudeMessage, ClaudeTool, ClaudeEdit } from './claudeModel'

// Two-letter source tag used in the compact per-session lines.
const SOURCE_ABBR: Record<SessionSource, string> = { codex: 'cx', claude: 'cl', warp: 'wp' }
import { buildCycles, cyclePrompt, cycleOrigin, type Cycle, type UnifiedEntry } from './unifiedCycles'

const PROMPT_MAX = 400
const RESULT_MAX = 600

// One line of readable text: collapse whitespace, clip with an ellipsis.
function clip(raw: string | null | undefined, max: number): string | null {
  const t = (raw || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function fmtTokens(n: number | null | undefined): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtDay(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '?'
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '?'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '?'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// The full text of the human touchpoint that opened the cycle (cyclePrompt clips to 40
// chars for row labels; the export wants more). Falls back to the short label.
function promptText(cycle: Cycle): string | null {
  const head = cycle.items[0]
  if (head?.kind === 'message') {
    const t = clip((head.item as Message | ClaudeMessage).text, PROMPT_MAX)
    if (t) return t
  }
  const label = cyclePrompt(cycle)
  return label === 'context only' ? null : clip(label, PROMPT_MAX)
}

// The last substantive assistant reply of the cycle — the "what came of it" line.
function resultText(cycle: Cycle): string | null {
  for (let i = cycle.items.length - 1; i >= 0; i--) {
    const e = cycle.items[i]
    if (e.kind !== 'message') continue
    const m = e.item as Message | ClaudeMessage
    if (m.role !== 'assistant') continue
    const t = clip(m.text, RESULT_MAX)
    if (t) return t
  }
  return null
}

// Tool usage of a cycle as `Name×count` chips, most-used first.
function toolChips(cycle: Cycle): string | null {
  const counts = new Map<string, number>()
  for (const e of cycle.items) {
    if (e.kind !== 'tool' && e.kind !== 'edit') continue
    const name = (e.item as Tool | ClaudeTool | CodeEdit | ClaudeEdit).name || 'tool'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  if (counts.size === 0) return null
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name}×${n}` : name))
    .join(', ')
}

// Files touched by a cycle's edits. Claude edits carry file_path; Codex apply_patch
// patches name their files in `*** Add|Update|Delete File:` headers.
function editedFiles(entries: UnifiedEntry[]): string[] {
  const files = new Set<string>()
  for (const e of entries) {
    if (e.kind !== 'edit') continue
    const item = e.item as CodeEdit | ClaudeEdit
    const claudePath = (item as ClaudeEdit).file_path
    if (claudePath) {
      files.add(claudePath)
      continue
    }
    const patch = (item as CodeEdit).patch || ''
    for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      files.add(m[1].trim())
    }
  }
  return [...files]
}

function sessionHeader(s: UnifiedSession, index: number): string[] {
  const usage: TokenUsage = s.latest_total_usage || {}
  const project = s.projectCwd || s.cwd
  const models = s.models.length > 1 ? s.models.join(', ') : s.model || '?'
  const lines = [
    `## ${index}. [${s.source}] ${s.title || s.id}`,
    '',
    `- When: ${fmtDay(s.started_at)} ${fmtTime(s.started_at)} → ${fmtDay(s.updated_at)} ${fmtTime(s.updated_at)}`,
    `- Where: ${project || 'unknown directory'}`,
    `- Model: ${models}`,
    `- Activity: ${s.counts.user} user prompts, ${s.counts.assistant} assistant replies, ${s.counts.tool_calls} tool calls, ${s.counts.code_edits} file edits`,
    `- Tokens: ${fmtTokens(usage.total_tokens)} total (${fmtTokens(usage.output_tokens)} output)`,
  ]
  if (s.subtitle) {
    const first = clip(s.subtitle, PROMPT_MAX)
    if (first) lines.push(`- First prompt: ${first}`)
  }
  return lines
}

function sessionBody(s: UnifiedSession): string[] {
  const lines: string[] = []
  const cycles = buildCycles(s)
  const workCycles = cycles.filter((c) => cycleOrigin(c) !== 'context')
  let n = 0
  for (const cycle of workCycles) {
    const prompt = promptText(cycle)
    if (!prompt) continue
    n++
    const origin = cycleOrigin(cycle)
    const tag = origin === 'prompt' ? 'prompt' : origin // 'interjection' | 'answer'
    lines.push(`${n}. **${fmtTime((cycle.items[0]?.item as { timestamp?: string | null })?.timestamp)}** ${tag}: ${prompt}`)
    const tools = toolChips(cycle)
    if (tools) lines.push(`   - tools: ${tools}`)
    const files = editedFiles(cycle.items)
    if (files.length) lines.push(`   - edited: ${files.join(', ')}`)
    const result = resultText(cycle)
    if (result) lines.push(`   - result: ${result}`)
  }
  if (lines.length === 0) lines.push('_No human prompts recorded (context/automation only)._')
  return lines
}

export function buildAiExport(sessions: UnifiedSession[]): string {
  // Chronological (oldest first) so the reading AI gets a narrative of the work.
  const ordered = [...sessions].sort((a, b) =>
    (a.started_at || a.updated_at || '').localeCompare(b.started_at || b.updated_at || ''),
  )
  const codex = ordered.filter((s) => s.source === 'codex').length
  const claude = ordered.filter((s) => s.source === 'claude').length
  const warp = ordered.filter((s) => s.source === 'warp').length
  const totalTokens = ordered.reduce((sum, s) => sum + (s.latest_total_usage?.total_tokens || 0), 0)
  const span =
    ordered.length > 0
      ? `${fmtDay(ordered[0].started_at || ordered[0].updated_at)} → ${fmtDay(ordered[ordered.length - 1].updated_at)}`
      : 'n/a'

  const out: string[] = [
    '# Karin session export — AI handoff',
    '',
    `Generated ${new Date().toISOString()} · ${ordered.length} sessions (${codex} codex, ${claude} claude, ${warp} warp) · ${fmtTokens(totalTokens)} tokens · span ${span}`,
    '',
    '## Instructions for the reading AI',
    '',
    'This file is a chronological digest of AI coding sessions (Codex CLI and Claude Code)',
    'recorded by Karin, a local session viewer. Each session lists the human prompts',
    '(cycles), the tools used, the files edited, and a clipped excerpt of the final reply.',
    'Your job: **summarize what was done across all the sessions** — the projects touched,',
    'the goals pursued, what was actually accomplished, recurring themes or problems, and',
    'how effort (tokens, tool calls, edits) was distributed. Group by project/directory',
    'where sensible and keep the summary chronological at the top level. Text excerpts are',
    'truncated with … — do not treat truncation as missing work.',
    '',
    '---',
    '',
  ]

  ordered.forEach((s, i) => {
    out.push(...sessionHeader(s, i + 1), '', '### Cycles', '', ...sessionBody(s), '', '---', '')
  })

  return out.join('\n')
}

// --- Gist export -------------------------------------------------------------
// The full export above runs ~2000 lines for a day of work; this one aims at ~20.
// One line per session: enough CLUES (title, prompt fragments, top edited files,
// effort) for an AI to reconstruct the gist of what happened — approximate on
// purpose, not complete or exact.

// Keep the start AND end of a long text — the ask usually opens it, the constraint
// usually closes it — and drop the middle.
function gistClip(raw: string | null | undefined, head = 48, tail = 20): string | null {
  const t = (raw || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (t.length <= head + tail + 1) return t
  return `${t.slice(0, head)}…${t.slice(-tail)}`
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

// Up to `max` prompts sampled across the session (first, spread, last) — the arc of
// the conversation rather than an exhaustive list.
function samplePrompts(cycles: Cycle[], max: number): string[] {
  const prompts = cycles
    .filter((c) => cycleOrigin(c) === 'prompt' || cycleOrigin(c) === 'interjection')
    .map((c) => promptText(c))
    .filter((p): p is string => !!p)
  if (prompts.length <= max) return prompts.map((p) => gistClip(p)!).filter(Boolean)
  const picks: string[] = []
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (prompts.length - 1)) / (max - 1))
    picks.push(gistClip(prompts[idx])!)
  }
  return picks
}

function gistSessionLine(s: UnifiedSession): string {
  const cycles = buildCycles(s)
  const prompts = samplePrompts(cycles, 3)
  const files = editedFiles(cycles.flatMap((c) => c.items))
  const fileCounts = new Map<string, number>()
  for (const f of files) fileCounts.set(baseName(f), (fileCounts.get(baseName(f)) || 0) + 1)
  const topFiles = [...fileCounts.keys()].slice(0, 3)
  const moreFiles = fileCounts.size - topFiles.length

  const project = baseName(s.projectCwd || s.cwd || '') || null
  const day = fmtDay(s.started_at || s.updated_at)
  const time = fmtTime(s.started_at || s.updated_at)
  const src = SOURCE_ABBR[s.source]
  const usage = s.latest_total_usage || {}

  const bits: string[] = [
    `- ${day} ${time} [${src}${project ? ` ${project}` : ''}] ${gistClip(s.title || s.id, 40, 0) || s.id}`,
  ]
  if (prompts.length) bits.push(`  asks: ${prompts.map((p) => `"${p}"`).join(' · ')}`)
  const work: string[] = []
  if (topFiles.length) work.push(`edited ${topFiles.join(', ')}${moreFiles > 0 ? ` +${moreFiles}` : ''}`)
  work.push(`${s.counts.user}p/${s.counts.tool_calls}t/${s.counts.code_edits}e`, `${fmtTokens(usage.total_tokens)} tok`)
  bits.push(`  work: ${work.join(' · ')}`)
  return bits.join('\n')
}

export function buildGistExport(sessions: UnifiedSession[]): string {
  const ordered = [...sessions].sort((a, b) =>
    (a.started_at || a.updated_at || '').localeCompare(b.started_at || b.updated_at || ''),
  )
  const totalTokens = ordered.reduce((sum, s) => sum + (s.latest_total_usage?.total_tokens || 0), 0)
  const out: string[] = [
    '# Karin gist — AI coding sessions, most vital clues only',
    `# ${ordered.length} sessions · ${fmtTokens(totalTokens)} tokens · cx=Codex cl=Claude · Np/Nt/Ne = prompts/tools/edits`,
    '# Reconstruct the gist of what was worked on and roughly accomplished. Texts are',
    '# fragments (start…end of longer prompts) — infer, approximate, do not expect completeness.',
    '',
  ]
  for (const s of ordered) out.push(gistSessionLine(s))
  return out.join('\n')
}

// Browser download helper shared by both exports.
function downloadMd(md: string, stem: string): void {
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${stem}-${new Date().toISOString().slice(0, 10)}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Full digest — every prompt cycle with tools/files/result excerpts.
export function downloadAiExport(sessions: UnifiedSession[]): void {
  downloadMd(buildAiExport(sessions), 'karin-ai-export')
}

// Gist digest — ~1–3 lines per session, clues only.
export function downloadGistExport(sessions: UnifiedSession[]): void {
  downloadMd(buildGistExport(sessions), 'karin-ai-gist')
}
