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

const USER_PROMPT_TITLE_SYSTEM = [
  'Create a short title for a user prompt in an AI session transcript.',
  'Return only one plain-text phrase with six words or fewer.',
  'Capture the main requested action or question, preserving important technical nouns.',
  'Do not add a label, explanation, quotation marks, markdown, or invented details.',
].join(' ')
const USER_PROMPT_TITLE_INPUT_LIMIT = 12_000
const userPromptTitleCache = new Map<string, string>()
const userPromptTitlePending = new Map<string, Promise<string>>()

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

function cleanUserPromptTitle(raw: string): string {
  const firstLine =
    raw
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ''
  const withoutWrapper = firstLine
    .replace(/^title\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^[-*]\s+/, '')
  return withoutWrapper.split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
}

function titlePromptInput(prompt: string): string {
  if (prompt.length <= USER_PROMPT_TITLE_INPUT_LIMIT) return prompt
  const head = Math.floor(USER_PROMPT_TITLE_INPUT_LIMIT * 0.72)
  return `${prompt.slice(0, head)}\n… [middle clipped for title generation] …\n${prompt.slice(-(USER_PROMPT_TITLE_INPUT_LIMIT - head))}`
}

// Summarize only when the title renderer has already measured an overflowing prompt.
// Results stay in memory for this page lifetime, so repeated prompts do not start another
// local model request.
export function summarizeUserPromptTitle(prompt: string): Promise<string> {
  const cached = userPromptTitleCache.get(prompt)
  if (cached) return Promise.resolve(cached)
  const pending = userPromptTitlePending.get(prompt)
  if (pending) return pending

  const request = generate(
    `Give this user prompt a concise transcript title.\n\n${titlePromptInput(prompt)}`,
    {
      model: DEFAULT_MODEL,
      system: USER_PROMPT_TITLE_SYSTEM,
      think: false,
      temperature: 0.1,
      numPredict: 24,
      numCtx: 4096,
    },
  )
    .then((raw) => {
      const title = cleanUserPromptTitle(raw)
      if (!title) throw new Error('Qwen returned no prompt title.')
      userPromptTitleCache.set(prompt, title)
      return title
    })
    .finally(() => userPromptTitlePending.delete(prompt))

  userPromptTitlePending.set(prompt, request)
  return request
}

export function fmtModelSize(bytes: number): string {
  if (!bytes) return ''
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}
