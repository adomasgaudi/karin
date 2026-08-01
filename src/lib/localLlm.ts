// Local LLM (Ollama) client.
//
// Karin's principle is that transcripts stay on the machine, which rules out sending a
// session to a hosted model just to summarize it. Ollama runs on this PC and speaks a
// small HTTP API on :11434, so the digest never leaves localhost.
//
// Everything here degrades quietly: if Ollama isn't running, `probe()` reports it and the
// UI hides its summarize affordances rather than erroring.

export const OLLAMA_URL = 'http://127.0.0.1:11434'
export const DEEPSEEK_URL = import.meta.env.VITE_DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions'

// The model we install and default to (see CLAUDE.md). Any pulled model can be chosen
// instead — the picker lists whatever `/api/tags` reports.
export const DEFAULT_MODEL = 'qwen3.5:9b'

export type SimplifierProvider = 'qwen' | 'd-flash' | 'd-pro'

export const SIMPLIFIER_PROVIDERS: Array<{ id: SimplifierProvider; label: string; model: string }> = [
  { id: 'qwen', label: 'Qwen', model: DEFAULT_MODEL },
  { id: 'd-flash', label: 'D-Flash', model: 'deepseek-v4-flash' },
  { id: 'd-pro', label: 'D-Pro', model: 'deepseek-v4-pro' },
]

const DEEPSEEK_KEYS: Record<Exclude<SimplifierProvider, 'qwen'>, string | undefined> = {
  'd-flash': import.meta.env.VITE_DEEPSEEK_FLASH_API_KEY,
  'd-pro': import.meta.env.VITE_DEEPSEEK_PRO_API_KEY,
}

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
  provider?: SimplifierProvider
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
  // Used only for the UI's honest progress estimate; the server still decides when to stop.
  expectedTokens?: number
  timeoutMs?: number
  onProgress?: (progress: GenerateProgress) => void
}

export interface GenerateProgress {
  percent: number
  generatedTokens: number
  targetTokens: number
  elapsedMs: number
  etaMs: number | null
}

function estimatedTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function progressReporter(prompt: string, opts: GenerateOptions) {
  const startedAt = Date.now()
  const targetTokens = Math.max(32, opts.expectedTokens ?? Math.min(opts.numPredict ?? 700, Math.max(96, Math.ceil(estimatedTokens(prompt) * 0.3))))
  let full = ''
  const report = () => {
    const generatedTokens = estimatedTokens(full)
    const elapsedMs = Date.now() - startedAt
    const speed = generatedTokens / Math.max(0.25, elapsedMs / 1000)
    const remainingTokens = Math.max(0, targetTokens - generatedTokens)
    opts.onProgress?.({
      percent: Math.min(96, Math.round((generatedTokens / targetTokens) * 100)),
      generatedTokens,
      targetTokens,
      elapsedMs,
      etaMs: speed > 0 ? Math.round((remainingTokens / speed) * 1000) : null,
    })
  }
  opts.onProgress?.({ percent: 0, generatedTokens: 0, targetTokens, elapsedMs: 0, etaMs: null })
  return {
    add(chunk: string) {
      full += chunk
      report()
    },
    finish() {
      const elapsedMs = Date.now() - startedAt
      opts.onProgress?.({ percent: 100, generatedTokens: estimatedTokens(full), targetTokens, elapsedMs, etaMs: 0 })
    },
  }
}

function requestSignal(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  external?.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      window.clearTimeout(timer)
      external?.removeEventListener('abort', abort)
    },
  }
}

async function readOllamaStream(res: Response, progress: ReturnType<typeof progressReporter>, onToken?: (chunk: string) => void): Promise<string> {
  if (!res.body) throw new Error('Ollama returned no response stream.')
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
      const frame = JSON.parse(t) as { response?: string; error?: string }
      if (frame.error) throw new Error(frame.error)
      if (frame.response) {
        full += frame.response
        progress.add(frame.response)
        onToken?.(frame.response)
      }
    }
  }
  return full
}

async function readDeepSeekStream(res: Response, progress: ReturnType<typeof progressReporter>, onToken?: (chunk: string) => void): Promise<string> {
  if (!res.body) throw new Error('DeepSeek returned no response stream.')
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
      if (!t || !t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') continue
      const frame = JSON.parse(data) as { error?: { message?: string }; choices?: Array<{ delta?: { content?: string } }> }
      if (frame.error) throw new Error(frame.error.message || 'DeepSeek request failed.')
      const chunk = frame.choices?.[0]?.delta?.content || ''
      if (chunk) {
        full += chunk
        progress.add(chunk)
        onToken?.(chunk)
      }
    }
  }
  return full
}

// Streams a completion, resolving with the full text. Rejects on transport failure so the
// caller can show the error next to the (empty) output.
export async function generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  const provider = opts.provider || 'qwen'
  const timeout = requestSignal(opts.signal, opts.timeoutMs ?? 90_000)
  const progress = progressReporter(prompt, opts)
  try {
    let res: Response
    let read: (response: Response) => Promise<string>
    if (provider === 'qwen') {
      res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: timeout.signal,
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
      read = (response) => readOllamaStream(response, progress, opts.onToken)
    } else {
      const apiKey = DEEPSEEK_KEYS[provider]
      if (!apiKey) throw new Error(`${provider === 'd-flash' ? 'D-Flash' : 'D-Pro'} is not configured. Add its API key to .env.local, then restart Karin.`)
      res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: timeout.signal,
        body: JSON.stringify({
          model: opts.model || SIMPLIFIER_PROVIDERS.find((item) => item.id === provider)?.model,
          messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: prompt },
          ],
          stream: true,
          thinking: { type: 'disabled' },
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.numPredict ?? 700,
        }),
      })
      read = (response) => readDeepSeekStream(response, progress, opts.onToken)
    }
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new Error(`${provider === 'qwen' ? 'Ollama' : 'DeepSeek'} ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    }
    const full = await read(res)
    progress.finish()
    return full
  } catch (e) {
    if (timeout.timedOut()) throw new Error(`Simplification timed out after ${Math.round((opts.timeoutMs ?? 90_000) / 1000)} seconds.`)
    throw e
  } finally {
    timeout.cleanup()
  }
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
