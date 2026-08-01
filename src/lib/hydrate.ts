// Lazy session bodies.
//
// The feeds used to ship every session's full event arrays up front: 63 MB of Codex and
// 59 MB of Claude, downloaded and parsed before the sidebar could render, when opening one
// session needs one session's events. The indexers now split each feed into a small index
// (metadata, counts, usage, precomputed search text) plus one body file per session, and
// this module fetches a body on demand and merges it back into the session object.
//
// The merged shape is IDENTICAL to the old all-in-one shape, so everything downstream —
// the cycle builder, the renderer, the Raw tab — is unchanged; it just receives the arrays
// later. `split: false` / absent on a feed means an old un-split file that needs no work.

import type { Session, SessionSource } from '../types'
import type { ClaudeDetailSession } from './claudeModel'

// Kept in step with BODY_FIELDS in bin/karin.py and bin/karin_claude.py.
const BODY_FIELDS: Record<'codex' | 'claude', string[]> = {
  codex: ['records', 'runtime_events', 'tools', 'contexts', 'code_edits'],
  claude: ['records', 'subagents', 'usage_frames', 'tools', 'contexts', 'code_edits'],
}

// Mirrors safe_file_stem() in the indexers: ids are used as filenames, so anything that
// isn't filename-safe collapses to '-'. Must stay identical or lookups miss.
function safeStem(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_')
}

// A session is hydrated once; repeat opens (and the 5s refresh) reuse the cached body
// rather than re-fetching. Keyed by `${source}:${id}` — the same uid the store uses.
//
// `stamp` is the session's updated_at at fetch time. The 5s poll replaces a whole feed
// with a fresh (body-less) index, so without this cache every refresh would blank the
// open session for a moment — cycles unmount, the view re-collapses, and whatever the
// owner was reading vanishes. The store re-applies cached bodies SYNCHRONOUSLY on every
// refresh, and only re-fetches the ones whose stamp moved.
interface CachedBody {
  body: Record<string, unknown>
  stamp: string
}
const cache = new Map<string, CachedBody>()
const inFlight = new Map<string, Promise<Record<string, unknown> | null>>()

function stampOf(s: Record<string, unknown>): string {
  return String(s.updated_at ?? '')
}

function toolKey(tool: Record<string, unknown>): string {
  const callId = String(tool.call_id ?? '')
  return callId ? `call:${callId}` : `line:${String(tool.line ?? '')}:${String(tool.name ?? '')}`
}

// A cached body may trail the live index during an active turn. Preserve every fresh
// call-only preview, then let a matching full body record replace it with arguments/output.
function mergeCodexTools(bodyTools: unknown, previews: unknown): unknown[] {
  const byKey = new Map<string, Record<string, unknown>>()
  if (Array.isArray(previews)) {
    for (const tool of previews) {
      if (tool && typeof tool === 'object') byKey.set(toolKey(tool as Record<string, unknown>), tool as Record<string, unknown>)
    }
  }
  if (Array.isArray(bodyTools)) {
    for (const tool of bodyTools) {
      if (tool && typeof tool === 'object') byKey.set(toolKey(tool as Record<string, unknown>), tool as Record<string, unknown>)
    }
  }
  return [...byKey.values()].sort((a, b) => Number(a.line ?? 0) - Number(b.line ?? 0))
}

function merge(session: Record<string, unknown>, body: Record<string, unknown>, source: 'codex' | 'claude'): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...session }
  for (const field of BODY_FIELDS[source]) {
    if (source === 'codex' && field === 'tools') {
      merged[field] = mergeCodexTools(body[field], session.tool_previews)
    } else if (Array.isArray(body[field])) {
      merged[field] = body[field]
    }
  }
  return merged
}

async function fetchBody(source: 'codex' | 'claude', id: string, stamp: string): Promise<Record<string, unknown> | null> {
  const key = `${source}:${id}`
  const cached = cache.get(key)
  if (cached && cached.stamp === stamp) return cached.body
  const pending = inFlight.get(key)
  if (pending) return pending
  const base = import.meta.env.BASE_URL || '/'
  const url = `${base}data/sessions/${source}/${encodeURIComponent(safeStem(id))}.json`
  const task = (async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return null
      const text = await res.text()
      // A dev server may answer 404s with an HTML page; same guard as the feed loaders.
      if (/^\s*<(!doctype|html)/i.test(text)) return null
      const body = JSON.parse(text) as Record<string, unknown>
      cache.set(key, { body, stamp })
      return body
    } catch {
      return null
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, task)
  return task
}

// True when this session still needs a fetch: either it has never been hydrated and its
// heavy fields are empty, or the cached body predates the session's current updated_at.
// A session with no events at all reads as hydrated — there is nothing to fetch.
export function needsHydration(source: SessionSource, s: Record<string, unknown>): boolean {
  if (source === 'warp') return false // Warp's feed is small and never split
  const cached = cache.get(`${source}:${String(s.id)}`)
  if (cached) return cached.stamp !== stampOf(s)
  return BODY_FIELDS[source].every((f) => Array.isArray(s[f]) && (s[f] as unknown[]).length === 0)
}

// Synchronous re-merge of a body we already have. Used the instant a fresh feed lands so
// an already-open session never flickers back to "no events" while the (possibly newer)
// body is re-fetched in the background.
export function applyCachedBody<T extends Session | ClaudeDetailSession>(source: SessionSource, session: T): T {
  if (source === 'warp') return session
  const raw = session as unknown as Record<string, unknown>
  const cached = cache.get(`${source}:${session.id}`)
  if (!cached) return session
  // Nothing to do when the feed already carries the arrays (un-split feed).
  if (!BODY_FIELDS[source].every((f) => Array.isArray(raw[f]) && (raw[f] as unknown[]).length === 0)) return session
  return merge(raw, cached.body, source) as unknown as T
}

// Returns a NEW session object with its body fields filled in, or the original when there
// is nothing to fetch. Never mutates the input — the store swaps the object in, so React
// sees a changed reference and re-renders.
export async function hydrateSession<T extends Session | ClaudeDetailSession>(
  source: 'codex' | 'claude',
  session: T,
): Promise<T> {
  const raw = session as unknown as Record<string, unknown>
  const stamp = stampOf(raw)
  const cached = cache.get(`${source}:${session.id}`)
  // Already carrying its own arrays and no newer body to pull → nothing to do.
  if (!needsHydration(source, raw) && !cached) return session
  const body = await fetchBody(source, session.id, stamp)
  if (!body) {
    if (cached) return merge(raw, cached.body, source) as unknown as T
    return session
  }
  return merge(raw, body, source) as unknown as T
}
