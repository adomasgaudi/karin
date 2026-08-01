import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Square } from 'lucide-react'
import type { UnifiedSession } from '../types'
import { buildSessionDigest } from '../lib/aiExport'
import { DEFAULT_MODEL, fmtModelSize, generate, probe, type LocalModel } from '../lib/localLlm'

// Summarize the open session with a model running on THIS machine (Ollama). Nothing
// leaves localhost, which is the only way a summary feature fits Karin's "transcripts
// stay on the machine" rule.
//
// The panel is self-hiding: with Ollama down (or no model pulled) it collapses to a single
// muted line instead of shouting an error at someone who never asked for a local model.

const MODEL_KEY = 'karin-local-model'

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
      // Fall back to whatever IS installed when the remembered model was removed.
      if (r.up && r.models.length && !r.models.some((m) => m.name === model)) {
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

  const run = useCallback(async () => {
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
        model,
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
  }, [session, model])

  if (up === null) return null
  if (!up) {
    return (
      <p className="mb-2 text-[0.68rem] text-neutral-400 dark:text-neutral-500">
        Local summary unavailable — Ollama isn’t responding on 127.0.0.1:11434.
      </p>
    )
  }

  return (
    <div className="mb-3 rounded-md border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        <Bot className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-200">Local summary</span>
        <select
          value={model}
          onChange={(e) => {
            setModel(e.target.value)
            localStorage.setItem(MODEL_KEY, e.target.value)
          }}
          disabled={busy}
          className="h-6 max-w-[14rem] rounded-md border border-neutral-200 bg-neutral-50 px-1 text-[0.68rem] text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
        >
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} {fmtModelSize(m.size) && `· ${fmtModelSize(m.size)}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={busy ? () => abort.current?.abort() : () => void run()}
          disabled={models.length === 0}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-[0.68rem] text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {busy ? <Square className="h-3 w-3" /> : <Loader2 className="h-3 w-3" />}
          {busy ? 'Stop' : out ? 'Again' : 'Summarize'}
        </button>
        {models.length === 0 && (
          <span className="text-[0.68rem] text-neutral-400 dark:text-neutral-500">
            no models pulled — run <code>ollama pull {DEFAULT_MODEL}</code>
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
