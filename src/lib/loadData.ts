// Turns a text blob into a KarinData object. Accepts either:
//   - plain JSON ( {"sessions":[...]} )
//   - the indexer's JS wrapper ( window.KARIN_DATA = {...}; )
import type { KarinData } from '../types'

export function parseKarinText(text: string): KarinData {
  let src = text.trim()
  // Strip the `window.KARIN_DATA = ` … `;` wrapper if present.
  const eq = src.indexOf('=')
  if (src.startsWith('window.KARIN_DATA') && eq !== -1) {
    src = src.slice(eq + 1).trim()
    if (src.endsWith(';')) src = src.slice(0, -1).trim()
  }
  const data = JSON.parse(src) as KarinData
  if (!data || !Array.isArray(data.sessions)) {
    throw new Error('Not a Karin dataset: missing "sessions" array.')
  }
  return data
}

export async function parseKarinFile(file: File): Promise<KarinData> {
  const text = await file.text()
  return parseKarinText(text)
}

// On local `pnpm dev`, data/karin-data.js sits next to index.html and is served,
// so we auto-load it. On the public Pages build that file is gitignored/absent → 404,
// and the caller falls back to the drop zone.
export async function fetchLocalData(): Promise<KarinData | null> {
  const base = import.meta.env.BASE_URL || '/'
  for (const name of ['data/karin-data.json', 'data/karin-data.js']) {
    try {
      const res = await fetch(base + name, { cache: 'no-store' })
      if (!res.ok) continue
      const text = await res.text()
      // A dev server may answer 404s with an HTML page; guard against that.
      if (/^\s*<(!doctype|html)/i.test(text)) continue
      return parseKarinText(text)
    } catch {
      // try next candidate
    }
  }
  return null
}
