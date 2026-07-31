// Local LLM (Ollama) client.
//
// Karin's principle is that transcripts stay on the machine, which rules out sending a
// session to a hosted model just to summarize it. Ollama runs on this PC and speaks a
// small HTTP API on :11434, so the digest never leaves localhost.
//
// Everything here degrades quietly: if Ollama isn't running, `probe()` reports it and the
// UI hides its summarize affordances rather than erroring.

export const OLLAMA_URL = 'http://127.0.0.1:11434'

// The model we install and default to (see CLAUDE.md). Any pulled model can be chosen
// instead — the picker lists whatever `/api/tags` reports.
export const DEFAULT_MODEL = 'qwen3.5:9b'

export interface LocalModel {
  name: string
  size: number
  family: string | null
}

export interface ProbeResult {
  up: boolean
  models: LocalModel[]
  error: string | null
}

// Is Ollama up, and what is installed? One call, no throw — the caller renders the result.
export async function probe(signal?: AbortSignal): Promise<ProbeResult> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal })
    if (!res.ok) return { up: false, models: [], error: `Ollama answered ${res.status}` }
    const body = (await res.json()) as { models?: Array<Record<string, unknown>> }
    const models: LocalModel[] = (body.models ?? []).map((m) => ({
      name: String(m.name ?? ''),
      size: typeof m.size === 'number' ? m.size : 0,
      family: ((m.details as Record<string, unknown> | undefined)?.family as string) ?? null,
    }))
    return { up: true, models, error: null }
  } catch (e) {
    // A CORS rejection and a dead server look the same from here; say so plainly.
    return { up: false, models: [], error: e instanceof Error ? e.message : 'unreachable' }
  }
}

export interface GenerateOptions {
  model?: string
  system?: string
  // Streamed token callback — the UI paints as it arrives, which matters at ~50 tok/s.
  onToken?: (chunk: string) => void
  signal?: AbortSignal
  // Qwen3.5 is a thinking model; summarization wants it off for speed.
  think?: boolean
  temperature?: number
  numPredict?: number
  // Ollama defaults to a 4096-token window regardless of what the model supports, which
  // would silently truncate a session digest. Set it explicitly — but not huge: the KV
  // cache competes with the weights for 8 GB of VRAM, and overflow spills to CPU.
  numCtx?: number
}

// Streams a completion, resolving with the full text. Rejects on transport failure so the
// caller can show the error next to the (empty) output.
export async function generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      prompt,
      system: opts.system,
      stream: true,
      think: opts.think ?? false,
      options: {
        temperature: opts.temperature ?? 0.3,
        num_predict: opts.numPredict ?? 700,
        num_ctx: opts.numCtx ?? 8192,
      },
    }),
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Ollama ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }

  // NDJSON: one JSON object per line, each carrying the next `response` fragment.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      try {
        const frame = JSON.parse(t) as { response?: string; error?: string; done?: boolean }
        if (frame.error) throw new Error(frame.error)
        if (frame.response) {
          full += frame.response
          opts.onToken?.(frame.response)
        }
      } catch (e) {
        // A half-line at the buffer edge is normal; a real error carries a message.
        if (e instanceof Error && e.message && !e.message.startsWith('Unexpected')) throw e
      }
    }
  }
  return full
}

export function fmtModelSize(bytes: number): string {
  if (!bytes) return ''
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}
