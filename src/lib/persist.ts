// Tiny IndexedDB wrapper: remembers the last-loaded datasets (Codex + Claude) so a
// refresh re-opens them without re-picking files. Data stays in the browser, never
// uploaded. The `kv` object store is schemaless, so new keys need no DB version bump.
import type { KarinData } from '../types'
import type { ClaudeRawData } from './claudeRaw'

const DB_NAME = 'karin'
const STORE = 'kv'
const CODEX_KEY = 'codex-data'
const CLAUDE_KEY = 'claude-data'
const LEGACY_KEY = 'last-data' // pre-merge bare Codex payload — migrated to CODEX_KEY

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function put(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Non-fatal: persistence is a convenience, not a requirement.
  }
}

async function getKey<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb()
    const result = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return result
  } catch {
    return null
  }
}

async function del(key: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // ignore
  }
}

export function saveCodex(data: KarinData): Promise<void> {
  return put(CODEX_KEY, data)
}

export function saveClaude(data: ClaudeRawData): Promise<void> {
  return put(CLAUDE_KEY, data)
}

// Load both remembered datasets. A legacy bare Codex payload is migrated forward.
export async function loadSaved(): Promise<{ codex: KarinData | null; claude: ClaudeRawData | null }> {
  const [codex, legacy, claude] = await Promise.all([
    getKey<KarinData>(CODEX_KEY),
    getKey<KarinData>(LEGACY_KEY),
    getKey<ClaudeRawData>(CLAUDE_KEY),
  ])
  return { codex: codex ?? legacy, claude }
}

export async function clearSaved(): Promise<void> {
  await Promise.all([del(CODEX_KEY), del(CLAUDE_KEY), del(LEGACY_KEY)])
}
