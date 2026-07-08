// Deterministic "what happened" summary across the loaded sessions — the in-app version
// of handing the gist export to another AI. No model runs here: the items are
// reconstructed from session titles, counts and token totals.
//
// The LOG RULE decides the altitude: effort is measured per project (tokens), and the
// 10–20 item budget follows where the mass is. If ONE project dominates (≥ half the
// effort), it earns detail — its items name the individual pieces of work inside it —
// while every other project collapses to one line. If effort is spread out, NO project
// gets inside detail: every project is one line with a few title clues.

import type { UnifiedSession } from '../types'

export type SummaryRange = 'today' | 'week' | 'all'

export interface ProjectSummary {
  name: string
  sessions: UnifiedSession[]
  tokens: number
  share: number // 0..1 of total tokens in range
  wallMs: number // summed session spans (start → last activity)
  edits: number
  prompts: number
}

export interface SummaryItem {
  kind: 'detail' | 'group' // detail = inside the dominant project; group = whole project(s)
  project: string
  text: string // the work, reconstructed from titles
  sessions: number
  tokens: number
  wallMs: number
}

export interface SummaryData {
  projects: ProjectSummary[] // effort-desc
  items: SummaryItem[] // ≤ MAX_ITEMS, effort-desc
  dominant: string | null // project that earned inside-detail, if any
  totalTokens: number
  totalWallMs: number
  sessionCount: number
}

const MAX_ITEMS = 20
const MIN_ITEMS = 10
const DOMINANT_SHARE = 0.5

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function projectName(s: UnifiedSession): string {
  const p = s.projectCwd || s.cwd
  return p ? baseName(p) : `(${s.source})`
}

function sessionTokens(s: UnifiedSession): number {
  return s.latest_total_usage?.total_tokens || 0
}

function sessionWallMs(s: UnifiedSession): number {
  if (!s.started_at || !s.updated_at) return 0
  const ms = Date.parse(s.updated_at) - Date.parse(s.started_at)
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

// Auto-titles repeat with numeric suffixes ("…counter-that-3") and near-duplicates
// ("Add/Create skill usage counter"); normalize so retries fold into one work item.
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[-\s]\d+$/, '')
    .replace(/^(add|create|update|fix|build|make)\s+/, '')
    .trim()
}

export function inRange(s: UnifiedSession, range: SummaryRange, now: number): boolean {
  if (range === 'all') return true
  const t = Date.parse(s.updated_at || s.started_at || '')
  if (!Number.isFinite(t)) return false
  const d = new Date(now)
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return range === 'today' ? t >= dayStart : t >= now - 7 * 24 * 3600_000
}

function groupProjects(sessions: UnifiedSession[]): ProjectSummary[] {
  const map = new Map<string, UnifiedSession[]>()
  for (const s of sessions) {
    const key = projectName(s)
    const list = map.get(key)
    if (list) list.push(s)
    else map.set(key, [s])
  }
  const total = sessions.reduce((sum, s) => sum + sessionTokens(s), 0) || 1
  return [...map.entries()]
    .map(([name, list]) => ({
      name,
      sessions: list,
      tokens: list.reduce((sum, s) => sum + sessionTokens(s), 0),
      share: list.reduce((sum, s) => sum + sessionTokens(s), 0) / total,
      wallMs: list.reduce((sum, s) => sum + sessionWallMs(s), 0),
      edits: list.reduce((sum, s) => sum + s.counts.code_edits, 0),
      prompts: list.reduce((sum, s) => sum + s.counts.user, 0),
    }))
    .sort((a, b) => b.tokens - a.tokens)
}

// Inside-detail items for the dominant project: sessions folded by normalized title,
// effort-desc, each item naming the actual piece of work.
function detailItems(p: ProjectSummary, budget: number): SummaryItem[] {
  const folded = new Map<string, { title: string; sessions: UnifiedSession[] }>()
  for (const s of p.sessions) {
    const key = titleKey(s.title || s.id)
    const cur = folded.get(key)
    if (cur) cur.sessions.push(s)
    else folded.set(key, { title: s.title || s.id, sessions: [s] })
  }
  const groups = [...folded.values()]
    .map((g) => ({
      ...g,
      tokens: g.sessions.reduce((sum, s) => sum + sessionTokens(s), 0),
      wallMs: g.sessions.reduce((sum, s) => sum + sessionWallMs(s), 0),
    }))
    .sort((a, b) => b.tokens - a.tokens)
  const kept = groups.slice(0, budget)
  const rest = groups.slice(budget)
  const items: SummaryItem[] = kept.map((g) => ({
    kind: 'detail',
    project: p.name,
    text: g.title,
    sessions: g.sessions.length,
    tokens: g.tokens,
    wallMs: g.wallMs,
  }))
  if (rest.length > 0) {
    items.push({
      kind: 'detail',
      project: p.name,
      text: `${rest.length} smaller ${p.name} tasks (${rest
        .slice(0, 3)
        .map((g) => g.title)
        .join('; ')}…)`,
      sessions: rest.reduce((sum, g) => sum + g.sessions.length, 0),
      tokens: rest.reduce((sum, g) => sum + g.tokens, 0),
      wallMs: rest.reduce((sum, g) => sum + g.wallMs, 0),
    })
  }
  return items
}

// One line for a whole project: name + a few distinct title clues.
function groupItem(p: ProjectSummary): SummaryItem {
  const titles: string[] = []
  const seen = new Set<string>()
  for (const s of [...p.sessions].sort((a, b) => sessionTokens(b) - sessionTokens(a))) {
    const key = titleKey(s.title || s.id)
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(s.title || s.id)
    if (titles.length >= 3) break
  }
  return {
    kind: 'group',
    project: p.name,
    text: titles.join('; '),
    sessions: p.sessions.length,
    tokens: p.tokens,
    wallMs: p.wallMs,
  }
}

export function buildSummary(sessions: UnifiedSession[], range: SummaryRange, now: number): SummaryData {
  const scoped = sessions.filter((s) => inRange(s, range, now))
  const projects = groupProjects(scoped)
  const totalTokens = projects.reduce((sum, p) => sum + p.tokens, 0)
  const totalWallMs = projects.reduce((sum, p) => sum + p.wallMs, 0)

  const dominant = projects[0] && projects[0].share >= DOMINANT_SHARE ? projects[0] : null
  let items: SummaryItem[] = []

  if (dominant) {
    // Log rule, concentrated case: the dominant project gets the leftover budget as
    // inside detail; every other project is one line (tail merged if too many).
    const others = projects.slice(1)
    const otherBudget = Math.min(others.length, MAX_ITEMS - MIN_ITEMS + 2)
    const keptOthers = others.slice(0, otherBudget)
    const tail = others.slice(otherBudget)
    items = detailItems(dominant, MAX_ITEMS - keptOthers.length - (tail.length ? 1 : 0))
    items.push(...keptOthers.map(groupItem))
    if (tail.length > 0) {
      items.push({
        kind: 'group',
        project: `${tail.length} more projects`,
        text: tail.map((p) => p.name).join(', '),
        sessions: tail.reduce((sum, p) => sum + p.sessions.length, 0),
        tokens: tail.reduce((sum, p) => sum + p.tokens, 0),
        wallMs: tail.reduce((sum, p) => sum + p.wallMs, 0),
      })
    }
  } else {
    // Spread-out case: no project gets inside detail — one line each.
    const kept = projects.slice(0, MAX_ITEMS - (projects.length > MAX_ITEMS ? 1 : 0))
    items = kept.map(groupItem)
    const tail = projects.slice(kept.length)
    if (tail.length > 0) {
      items.push({
        kind: 'group',
        project: `${tail.length} more projects`,
        text: tail.map((p) => p.name).join(', '),
        sessions: tail.reduce((sum, p) => sum + p.sessions.length, 0),
        tokens: tail.reduce((sum, p) => sum + p.tokens, 0),
        wallMs: tail.reduce((sum, p) => sum + p.wallMs, 0),
      })
    }
  }

  items.sort((a, b) => b.tokens - a.tokens)
  return {
    projects,
    items: items.slice(0, MAX_ITEMS),
    dominant: dominant?.name ?? null,
    totalTokens,
    totalWallMs,
    sessionCount: scoped.length,
  }
}
