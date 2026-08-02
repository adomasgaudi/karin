// Live filesystem access — the layer that replaces data/*.json entirely.
//
// This module is the whole premise of the branch: the renderer does not FETCH a feed that
// something else wrote, it reads ~/.claude and ~/.codex itself and watches them for change.
// There is no HTTP, no IPC, no indexer process and nothing on disk in between.
//
// Node is reached through the runtime `require` that Electron's nodeIntegration puts on
// window — NOT a static `import 'node:fs'`, which Vite would try to bundle for the browser
// and fail on. Everything below therefore degrades to "not live" in a plain browser tab,
// so `pnpm dev` in Chrome still opens without throwing.

type NodeFs = typeof import('node:fs')
type NodePath = typeof import('node:path')
type NodeOs = typeof import('node:os')

const nodeRequire = (globalThis as { require?: NodeRequire }).require

/** True inside the Electron shell, where the renderer may touch the filesystem. */
export const isLive = typeof nodeRequire === 'function'

const fs: NodeFs | null = isLive ? nodeRequire!('node:fs') : null
const path: NodePath | null = isLive ? nodeRequire!('node:path') : null
const os: NodeOs | null = isLive ? nodeRequire!('node:os') : null

export type LiveSource = 'claude' | 'codex'

/** Root directory per source. Overridable by env for testing against a copied tree. */
export function sourceRoot(source: LiveSource): string {
  if (!path || !os) return ''
  const home = os.homedir()
  if (source === 'claude') {
    const custom = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CLAUDE_HOME
    return path.join(custom || path.join(home, '.claude'), 'projects')
  }
  return path.join(home, '.codex', 'sessions')
}

export interface LiveFile {
  source: LiveSource
  /** Absolute path to the .jsonl transcript. */
  path: string
  /** Directory name directly under the root — Claude's project slug; '' for Codex. */
  slug: string
  /** Filename without the .jsonl extension. */
  stem: string
  mtimeMs: number
  size: number
}

// Codex nests transcripts under sessions/YYYY/MM/DD/, Claude keeps them one level down in
// projects/<slug>/. One recursive walk covers both; depth is capped so a stray symlink loop
// can't hang the boot scan.
function walk(dir: string, depth: number, out: string[]): void {
  if (!fs || !path || depth < 0) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, depth - 1, out)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full)
  }
}

/**
 * Every transcript under a source root, newest first.
 *
 * A file can vanish between the listing and the stat — Claude Code rewrites transcripts
 * constantly. That exact race is what kept killing the Python watcher, so here a missing
 * file is simply skipped instead of thrown.
 */
export function discover(source: LiveSource): LiveFile[] {
  if (!fs || !path) return []
  const root = sourceRoot(source)
  if (!root || !fs.existsSync(root)) return []

  const files: string[] = []
  walk(root, source === 'claude' ? 1 : 4, files)

  const out: LiveFile[] = []
  for (const full of files) {
    try {
      const st = fs.statSync(full)
      out.push({
        source,
        path: full,
        slug: source === 'claude' ? path.basename(path.dirname(full)) : '',
        stem: path.basename(full, '.jsonl'),
        mtimeMs: st.mtimeMs,
        size: st.size,
      })
    } catch {
      // Deleted mid-scan. Skip it; the watcher will report it if it comes back.
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/** Whole file as text, or '' if it disappeared. */
export function readText(file: string): string {
  if (!fs) return ''
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export interface Appended {
  /** Bytes appended since `from`. Empty when nothing was added. */
  text: string
  /** New end-of-file offset, to pass as `from` next time. */
  offset: number
  /** True when the file shrank or was replaced, so the caller must re-read from 0. */
  truncated: boolean
}

/**
 * Read only what was appended past `from`.
 *
 * Transcripts are append-only, so an update costs the new bytes rather than the whole
 * ~50 MB corpus. A file that got SHORTER was rewritten rather than appended to, which the
 * caller has to handle by discarding its parse and starting over.
 */
export function readAppended(file: string, from: number): Appended {
  if (!fs) return { text: '', offset: from, truncated: false }
  let size = 0
  try {
    size = fs.statSync(file).size
  } catch {
    return { text: '', offset: from, truncated: false }
  }
  if (size < from) return { text: readText(file), offset: size, truncated: true }
  if (size === from) return { text: '', offset: from, truncated: false }

  const length = size - from
  const buffer = Buffer.alloc(length)
  let handle: number | null = null
  try {
    handle = fs.openSync(file, 'r')
    const read = fs.readSync(handle, buffer, 0, length, from)
    return { text: buffer.toString('utf8', 0, read), offset: from + read, truncated: false }
  } catch {
    return { text: '', offset: from, truncated: false }
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle)
      } catch {
        // Nothing useful to do if the descriptor is already gone.
      }
    }
  }
}

/**
 * Watch both roots and report changed transcript paths.
 *
 * `fs.watch` with `recursive` is ReadDirectoryChangesW on Windows — OS-level events, the
 * same mechanism the retired Python watcher used, with no polling. Windows emits several
 * events for one write, so paths are coalesced over a short window and delivered as a batch.
 * Returns an unsubscribe function.
 */
export function watchSources(
  sources: LiveSource[],
  onChange: (changed: LiveFile[]) => void,
  debounceMs = 40,
): () => void {
  if (!fs || !path) return () => {}

  const pending = new Map<string, LiveSource>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    const batch: LiveFile[] = []
    for (const [full, source] of pending) {
      try {
        const st = fs.statSync(full)
        batch.push({
          source,
          path: full,
          slug: source === 'claude' ? path.basename(path.dirname(full)) : '',
          stem: path.basename(full, '.jsonl'),
          mtimeMs: st.mtimeMs,
          size: st.size,
        })
      } catch {
        // Deleted between the event and the stat — nothing to report.
      }
    }
    pending.clear()
    if (batch.length) onChange(batch)
  }

  const watchers: import('node:fs').FSWatcher[] = []
  for (const source of sources) {
    const root = sourceRoot(source)
    if (!root || !fs.existsSync(root)) continue
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const name = String(filename)
        if (!name.endsWith('.jsonl')) return
        pending.set(path.join(root, name), source)
        if (timer) clearTimeout(timer)
        timer = setTimeout(flush, debounceMs)
      })
      watchers.push(watcher)
    } catch {
      // A root that can't be watched (permissions, missing) simply contributes no events.
    }
  }

  return () => {
    if (timer) clearTimeout(timer)
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {
        // Already closed.
      }
    }
  }
}
