// Local LLM (Ollama) client.
//
// Karin's principle is that transcripts stay on the machine, which rules out sending a
// session to a hosted model just to summarize it. Ollama runs on this PC and speaks a
// small HTTP API on :11434, so the digest never leaves localhost.
//
// Everything here degrades quietly: if Ollama isn't running, `probe()` reports it and the
// UI hides its summarize affordances rather than erroring.

export const OLLAMA_URL = 'http://127.0.0.1:11434'
export const DEEPSEEK_URL = import.meta.env.VITE_DEEPSEEK_API_URL || '/api/deepseek'

// The model we install and default to (see CLAUDE.md). Any pulled model can be chosen
// instead — the picker lists whatever `/api/tags` reports.
export const DEFAULT_MODEL = 'qwen3.5:9b'
export const LOCAL_LLM_TIMEOUT_MS = 300_000

export type SimplifierProvider = 'qwen' | 'd-flash' | 'd-pro'

export const SIMPLIFIER_PROVIDERS: Array<{ id: SimplifierProvider; label: string; model: string }> = [
  { id: 'qwen', label: 'Qwen', model: DEFAULT_MODEL },
  { id: 'd-flash', label: 'D-Flash', model: 'deepseek-v4-flash' },
  { id: 'd-pro', label: 'D-Pro', model: 'deepseek-v4-pro' },
]

// Shortening, NOT titling. The owner has to read the preview and recognise it as their
// own sentence with some words removed — an invented six-word title fails that even when
// it is accurate, because it is the model's phrasing rather than theirs.
const USER_PROMPT_SHORTEN_SYSTEM = `
You shorten a message its own author will read back, so it must still sound like them.
Keep the author's exact words and word order. Delete filler, repetition, hedging and greetings.
Keep every concrete detail: filenames, identifiers, numbers, and the actual request.
Never paraphrase, never swap a word for a synonym, never add a word that is not already in the message.
Do not add a label, explanation, quotation marks, or markdown.
Return only the shortened message, at most 20 words.
`.trim()
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
  generatedTokens: number
  targetTokens: number
  elapsedMs: number
  etaMs: number | null
}

function estimatedTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

const DEFAULT_PERFORMANCE: Record<SimplifierProvider, { tokensPerSecond: number; firstTokenMs: number }> = {
  qwen: { tokensPerSecond: 24, firstTokenMs: 1_400 },
  'd-flash': { tokensPerSecond: 55, firstTokenMs: 700 },
  'd-pro': { tokensPerSecond: 38, firstTokenMs: 900 },
}

const performanceByProvider = new Map<SimplifierProvider, { tokensPerSecond: number; firstTokenMs: number }>()

function progressReporter(prompt: string, opts: GenerateOptions) {
  const startedAt = Date.now()
  const provider = opts.provider ?? 'qwen'
  const remembered = performanceByProvider.get(provider) ?? DEFAULT_PERFORMANCE[provider]
  // Output size is tied to the input size, capped by the server request limit.
  // This gives the first ETA a meaningful target before any token has arrived.
  const promptTokens = estimatedTokens(prompt)
  const defaultTargetTokens = Math.max(96, Math.ceil(promptTokens * 0.3))
  const requestedTargetTokens = opts.expectedTokens ?? Math.min(opts.numPredict ?? 700, defaultTargetTokens)
  const targetTokens = Math.max(48, requestedTargetTokens)
  let speed = remembered.tokensPerSecond
  let firstTokenMs: number | null = null
  let full = ''
  const estimate = (generatedTokens: number, elapsedMs: number): number => {
    if (generatedTokens <= 0) {
      const estimatedGenerationMs = (targetTokens / speed) * 1000
      return Math.round(remembered.firstTokenMs + estimatedGenerationMs)
    }
    const generationMs = Math.max(250, elapsedMs - (firstTokenMs ?? 0))
    const observedSpeed = generatedTokens / (generationMs / 1000)
    // Wait for a useful sample, then blend it into the provider estimate so one
    // unusually large first chunk cannot make the remaining time jump wildly.
    if (generatedTokens >= 8 && Number.isFinite(observedSpeed) && observedSpeed > 0) {
      speed = speed * 0.35 + observedSpeed * 0.65
      performanceByProvider.set(provider, {
        tokensPerSecond: speed,
        firstTokenMs: firstTokenMs ?? remembered.firstTokenMs,
      })
    }
    return Math.round((Math.max(0, targetTokens - generatedTokens) / speed) * 1000)
  }
  const report = () => {
    const generatedTokens = estimatedTokens(full)
    const elapsedMs = Date.now() - startedAt
    if (generatedTokens > 0 && firstTokenMs === null) firstTokenMs = elapsedMs
    opts.onProgress?.({
      generatedTokens,
      targetTokens,
      elapsedMs,
      etaMs: estimate(generatedTokens, elapsedMs),
    })
  }
  opts.onProgress?.({ generatedTokens: 0, targetTokens, elapsedMs: 0, etaMs: Math.round(remembered.firstTokenMs + (targetTokens / speed) * 1000) })
  return {
    add(chunk: string) {
      full += chunk
      report()
    },
    finish() {
      const elapsedMs = Date.now() - startedAt
      const generatedTokens = estimatedTokens(full)
      if (generatedTokens > 0 && firstTokenMs === null) firstTokenMs = elapsedMs
      const generationMs = Math.max(250, elapsedMs - (firstTokenMs ?? 0))
      const observedSpeed = generatedTokens / (generationMs / 1000)
      if (Number.isFinite(observedSpeed) && observedSpeed > 0) {
        const blendedSpeed = speed * 0.35 + observedSpeed * 0.65
        const firstTokenEstimate = firstTokenMs ?? remembered.firstTokenMs
        performanceByProvider.set(provider, {
          tokensPerSecond: blendedSpeed,
          firstTokenMs: firstTokenEstimate,
        })
      }
      opts.onProgress?.({ generatedTokens, targetTokens, elapsedMs, etaMs: 0 })
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
  const timeout = requestSignal(opts.signal, opts.timeoutMs ?? LOCAL_LLM_TIMEOUT_MS)
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
      res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const providerName = provider === 'qwen' ? 'Ollama' : 'DeepSeek'
      const detailSuffix = detail ? `: ${detail.slice(0, 200)}` : ''
      throw new Error(`${providerName} ${res.status}${detailSuffix}`)
    }
    const full = await read(res)
    progress.finish()
    return full
  } catch (e) {
    if (timeout.timedOut()) throw new Error(`Simplification timed out after ${Math.round((opts.timeoutMs ?? LOCAL_LLM_TIMEOUT_MS) / 1000)} seconds.`)
    throw e
  } finally {
    timeout.cleanup()
  }
}

function cleanShortenedPrompt(raw: string): string {
  const firstLine =
    raw
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ''
  const withoutWrapper = firstLine
    .replace(/^(?:shortened|title)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^[-*]\s+/, '')
  // A model that ignores the word limit gets cut rather than allowed to fill the row.
  return withoutWrapper.split(/\s+/).filter(Boolean).slice(0, 24).join(' ')
}

function titlePromptInput(prompt: string): string {
  if (prompt.length <= USER_PROMPT_TITLE_INPUT_LIMIT) return prompt
  const head = Math.floor(USER_PROMPT_TITLE_INPUT_LIMIT * 0.72)
  return `${prompt.slice(0, head)}\n… [middle clipped for title generation] …\n${prompt.slice(-(USER_PROMPT_TITLE_INPUT_LIMIT - head))}`
}

// Shorten only when the title renderer has already measured an overflowing prompt.
// Results stay in memory for this page lifetime, so repeated prompts do not start another
// local model request.
export function shortenUserPrompt(prompt: string): Promise<string> {
  const cached = userPromptTitleCache.get(prompt)
  if (cached) return Promise.resolve(cached)
  const pending = userPromptTitlePending.get(prompt)
  if (pending) return pending

  const request = generate(
    `Shorten this message, keeping the author's own words.\n\n${titlePromptInput(prompt)}`,
    {
      model: DEFAULT_MODEL,
      system: USER_PROMPT_SHORTEN_SYSTEM,
      think: false,
      temperature: 0.1,
      numPredict: 64,
      numCtx: 4096,
    },
  )
    .then((raw) => {
      const title = cleanShortenedPrompt(raw)
      if (!title) throw new Error('Qwen returned no shortened prompt.')
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
