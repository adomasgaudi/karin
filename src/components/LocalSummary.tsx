import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Sparkles, Square } from 'lucide-react'
import type { UnifiedSession } from '../types'
import { buildSessionDigest } from '../lib/aiExport'
import {
  DEFAULT_MODEL,
  SIMPLIFIER_PROVIDERS,
  fmtModelSize,
  generate,
  probe,
  type LocalModel,
  type SimplifierProvider,
} from '../lib/localLlm'

// Summarize the open session with a model running on THIS machine (Ollama). Nothing
// leaves localhost, which is the only way a summary feature fits Karin's "transcripts
// stay on the machine" rule.
//
// The panel is self-hiding: with Ollama down (or no model pulled) it collapses to a single
// muted line instead of shouting an error at someone who never asked for a local model.

const MODEL_KEY = 'karin-local-model'
const PROVIDER_KEY = 'karin-summary-provider'

// One choice = a provider plus the concrete model it runs. Ollama contributes whatever is
// pulled locally; DeepSeek contributes its two hosted endpoints.
interface Choice {
  provider: SimplifierProvider
  model: string
  label: string
  note: string
}

const DEEPSEEK_CHOICES: Choice[] = SIMPLIFIER_PROVIDERS.filter((p) => p.id !== 'qwen').map((p) => ({
  provider: p.id,
  model: p.model,
  label: p.label,
  note: 'DeepSeek',
}))

const SYSTEM = `
You summarize logs of AI coding sessions for the developer who ran them.
Be concrete and short. No preamble, no restating the question, no flattery.
Write one line on what the session was for.
Then write 3-6 bullets of what actually happened (changes made, files touched, problems hit).
Then write one line on where it ended up.
Name real files and real decisions; skip anything you cannot see.
`.trim()

export default function LocalSummary({ session }: { session: UnifiedSession }) {
  const [models, setModels] = useState<LocalModel[]>([])
  const [up, setUp] = useState<boolean | null>(null)
  const [model, setModel] = useState<string>(() => localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL)
  const [provider, setProvider] = useState<SimplifierProvider>(
    () => (localStorage.getItem(PROVIDER_KEY) as SimplifierProvider) || 'qwen',
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)

  // One probe on mount; Ollama either answers instantly or isn't there.
  useEffect(() => {
    const ac = new AbortController()
    void probe(ac.signal).then((r) => {
      setUp(r.up)
      setModels(r.models)
      // Fall back to whatever IS installed when the remembered Ollama model was removed.
      // A remembered DeepSeek choice is untouched — it isn't in this list by design.
      if (provider === 'qwen' && r.up && r.models.length && !r.models.some((m) => m.name === model)) {
        setModel(r.models[0].name)
      }
    })
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new session invalidates the old summary — showing session A's text under
  // session B's header would be a lie.
  useEffect(() => {
    setOut('')
    setError(null)
    setElapsed(null)
  }, [session.uid])

  const run = useCallback(async (choice: Choice) => {
    setProvider(choice.provider)
    setModel(choice.model)
    localStorage.setItem(PROVIDER_KEY, choice.provider)
    localStorage.setItem(MODEL_KEY, choice.model)
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setBusy(true)
    setOut('')
    setError(null)
    setElapsed(null)
    const started = performance.now()
    try {
      // ~12k chars ≈ 3k tokens, leaving room in the 8k window for the system prompt and
      // a 700-token answer. Bigger windows spill the KV cache off an 8 GB card.
      const digest = buildSessionDigest(session, 12_000)
      await generate(`Summarize this session.\n\n${digest}`, {
        provider: choice.provider,
        model: choice.model,
        system: SYSTEM,
        signal: ac.signal,
        onToken: (chunk) => setOut((prev) => prev + chunk),
      })
      setElapsed(performance.now() - started)
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (abort.current === ac) abort.current = null
      setBusy(false)
    }
  }, [session])

  // Ollama being down no longer hides the panel: the DeepSeek endpoints don't need it.
  if (up === null) return null
  const ollamaChoices: Choice[] = models.map((m) => ({
    provider: 'qwen',
    model: m.name,
    label: m.name,
    note: fmtModelSize(m.size) ? `Ollama · ${fmtModelSize(m.size)}` : 'Ollama',
  }))
  const choices = [...ollamaChoices, ...DEEPSEEK_CHOICES]
  if (choices.length === 0) return null
  const current = choices.find((c) => c.provider === provider && c.model === model) ?? choices[0]

  return (
    <div className="mb-3 rounded-md border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        {/* The model choice IS the Summarize action — one button opens the list and
            picking a model starts that run, instead of a separate picker nobody
            re-reads before clicking. */}
        <div className="relative">
          <button
            type="button"
            onClick={busy ? () => abort.current?.abort() : () => setMenuOpen((o) => !o)}
            title={busy ? 'Stop this run' : `Summarize with… (last used: ${current.label})`}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[0.68rem] text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {busy ? <Square className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
            {busy ? 'Stop' : out ? 'Again' : 'Summarize'}
            {!busy && <ChevronDown className="h-3 w-3 text-neutral-400" />}
          </button>
          {menuOpen && !busy && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 z-50 mt-1 w-60 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
                {choices.map((c) => (
                  <button
                    key={`${c.provider}:${c.model}`}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      void run(c)
                    }}
                    className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-[0.7rem] hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      c === current ? 'font-semibold text-neutral-950 dark:text-neutral-50' : 'text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <span className="truncate">{c.label}</span>
                    <span className="shrink-0 text-[0.62rem] text-neutral-400 dark:text-neutral-500">{c.note}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {busy && <Loader2 className="h-3 w-3 animate-spin text-neutral-400" />}
        {models.length === 0 && (
          <span className="text-[0.68rem] text-neutral-400 dark:text-neutral-500">
            Ollama offline — run <code>ollama pull {DEFAULT_MODEL}</code> for local models
          </span>
        )}
        {elapsed != null && (
          <span className="ml-auto font-mono text-[0.62rem] text-neutral-400 dark:text-neutral-500">
            {(elapsed / 1000).toFixed(1)}s · {Math.round(out.length / 4 / (elapsed / 1000))} tok/s
          </span>
        )}
      </div>
      {(out || busy || error) && (
        <div className="border-t border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
          {error ? (
            <p className="text-[0.7rem] text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-800 dark:text-neutral-100">
              {out}
              {busy && <span className="ml-0.5 animate-pulse text-neutral-400">▍</span>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
