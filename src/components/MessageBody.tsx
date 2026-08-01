import { useEffect, useRef, useState } from 'react'
import Markdown from './Markdown'
import {
  generate,
  LOCAL_LLM_TIMEOUT_MS,
  SIMPLIFIER_PROVIDERS,
  type GenerateProgress,
  type SimplifierProvider,
} from '../lib/localLlm'

// The expanded body of a message — the owner's prompt or the AI's reply. Shows the text
// as rendered markdown, and offers the same provider row the tool simplifier has, so a
// long reply can be reduced without leaving the transcript.
//
// This SUMMARISES rather than simplifies: prose already reads as English, so the job is
// cutting length while keeping the facts, not rewriting syntax.

const SUMMARY_SYSTEM = `
You summarise one message from a coding session so it can be read at a glance.
Keep every concrete fact: filenames, numbers, versions, decisions, and anything stated as a result.
Drop pleasantries, restatements, and hedging.
Use short markdown bullets. No preamble, no closing remark, no invented detail.
Answer in at most 80 words.
`.trim()

const SUMMARY_INPUT_LIMIT = 14_000
const summaryCache = new Map<string, string>()

const cacheKey = (provider: SimplifierProvider, text: string) => `${provider}:${text}`

function clip(text: string): string {
  if (text.length <= SUMMARY_INPUT_LIMIT) return text
  const head = Math.floor(SUMMARY_INPUT_LIMIT * 0.72)
  return `${text.slice(0, head)}\n… [middle clipped for the summary] …\n${text.slice(-(SUMMARY_INPUT_LIMIT - head))}`
}

function etaLabel(progress: GenerateProgress | null): string {
  const etaMs = progress?.etaMs ?? null
  if (etaMs === null) return '…'
  return etaMs < 1000 ? '<1s' : `~${Math.ceil(etaMs / 1000)}s`
}

export default function MessageBody({ text }: { text: string }) {
  const [mode, setMode] = useState<'original' | 'summary'>('original')
  const [provider, setProvider] = useState<SimplifierProvider>('qwen')
  const [summary, setSummary] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<GenerateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    abort.current?.abort()
    setMode('original')
    setSummary('')
    setDraft('')
    setBusy(false)
    setError(null)
    return () => abort.current?.abort()
  }, [text])

  const summarise = async (next: SimplifierProvider) => {
    abort.current?.abort()
    setProvider(next)
    setMode('summary')
    setError(null)
    const cached = summaryCache.get(cacheKey(next, text))
    if (cached) {
      setSummary(cached)
      setDraft('')
      setBusy(false)
      return
    }
    const ac = new AbortController()
    abort.current = ac
    setBusy(true)
    setSummary('')
    setDraft('')
    try {
      const result = await generate(`Summarise this message.\n\n${clip(text)}`, {
        provider: next,
        system: SUMMARY_SYSTEM,
        signal: ac.signal,
        think: false,
        temperature: 0.2,
        numPredict: 220,
        numCtx: 4096,
        timeoutMs: LOCAL_LLM_TIMEOUT_MS,
        onProgress: setProgress,
        onToken: (chunk) => setDraft((prev) => prev + chunk),
      })
      const cleaned = result.trim()
      if (!cleaned) throw new Error('The model returned an empty summary.')
      summaryCache.set(cacheKey(next, text), cleaned)
      setSummary(cleaned)
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (abort.current === ac) {
        abort.current = null
        setBusy(false)
      }
    }
  }

  const plainBtn = (active: boolean) =>
    `rounded-sm px-1.5 py-0.5 text-[0.6rem] ${
      active
        ? 'bg-neutral-200 font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
        : 'text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300'
    }`

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end gap-1">
        <span className="mr-auto text-[0.58rem] text-neutral-400 dark:text-neutral-500">summarise</span>
        <button type="button" onClick={() => setMode('original')} className={plainBtn(mode === 'original')}>
          Original
        </button>
        <div className="flex overflow-hidden rounded-sm border border-neutral-200 dark:border-neutral-800" role="group" aria-label="Summarise with">
          {SIMPLIFIER_PROVIDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void summarise(item.id)}
              className={`border-r border-neutral-200 px-1.5 py-0.5 text-[0.6rem] last:border-r-0 dark:border-neutral-800 ${
                mode === 'summary' && provider === item.id
                  ? 'bg-amber-100 font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                  : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-900 dark:hover:text-neutral-300'
              }`}
            >
              {busy && provider === item.id ? `${item.label} ${etaLabel(progress)}` : item.label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'summary' ? (
        <div className="rounded-md border-l-2 border-amber-300/80 pl-2 dark:border-amber-700/60">
          <Markdown text={summary || draft || (busy ? '' : '(no summary)')} />
          {busy && <span className="animate-pulse text-neutral-400"> ▍</span>}
        </div>
      ) : (
        <Markdown text={text} />
      )}
      {error && <div className="text-[0.65rem] text-red-600 dark:text-red-400">{error}</div>}
    </div>
  )
}
