import { useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { TokenUsage } from '../types'
import { useKarin } from '../store/karin'
import { fmtDate, fmtNum } from '../lib/format'
import { buildCycles } from '../lib/cycles'
import Cycle from './Cycle'
import ContextAudit from './ContextAudit'

function Pill({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="rounded-md border border-neutral-200 dark:border-neutral-800 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300">
      {label}: {value}
    </span>
  )
}

export default function SessionDetail() {
  const data = useKarin((s) => s.data)
  const selectedId = useKarin((s) => s.selectedId)
  const bodyRef = useRef<HTMLDivElement>(null)

  const s = data?.sessions.find((x) => x.id === selectedId)

  if (!s) {
    return (
      <div className="flex h-dvh flex-1 items-center justify-center p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a session to view its prompts, tools, tokens, and edits.
      </div>
    )
  }

  const u: TokenUsage = s.latest_total_usage || {}

  function setAllOpen(mode: 'all' | 'none' | 'cycles') {
    const root = bodyRef.current
    if (!root) return
    root.querySelectorAll('details').forEach((el) => {
      if (mode === 'all') el.open = true
      else if (mode === 'none') el.open = false
      else el.open = el.classList.contains('cycle')
    })
  }

  return (
    <div className="flex h-dvh flex-col min-w-0">
      <div className="shrink-0 border-b border-neutral-200 dark:border-neutral-800 p-3 md:p-4">
        <button
          type="button"
          onClick={() => useKarin.getState().select(null)}
          className="md:hidden mb-2 inline-flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <h1 className="text-lg font-semibold break-words text-neutral-900 dark:text-neutral-100">
          {s.title || s.id}
        </h1>
        <div className="text-xs text-neutral-500 dark:text-neutral-400 break-all">
          {`${s.id} · ${s.cwd || 'unknown cwd'}`}
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400 break-all">
          {`${s.model || 'model n/a'} · codex ${s.cli_version || 'n/a'} · ${s.path}`}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Pill label="updated" value={fmtDate(s.updated_at)} />
          <Pill label="input" value={fmtNum(u.input_tokens)} />
          <Pill label="cached" value={fmtNum(u.cached_input_tokens)} />
          <Pill label="output" value={fmtNum(u.output_tokens)} />
          <Pill label="reasoning" value={fmtNum(u.reasoning_output_tokens)} />
          <Pill label="total" value={fmtNum(u.total_tokens)} />
          <Pill label="tools" value={s.counts.tool_calls} />
          <Pill label="edits" value={s.counts.code_edits} />
          <Pill label="contexts" value={s.counts.contexts ?? 0} />
          <Pill label="runtime" value={s.counts.runtime_events ?? 0} />
        </div>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto p-3 md:p-4">
        <ContextAudit session={s} />

        <div className="mt-4 mb-2 text-xs uppercase tracking-wider text-neutral-500">
          Prompt / Answer Cycles
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => setAllOpen('all')}
            className="rounded-md border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setAllOpen('none')}
            className="rounded-md border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300"
          >
            Collapse all
          </button>
          <button
            type="button"
            onClick={() => setAllOpen('cycles')}
            className="rounded-md border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300"
          >
            Expand cycles only
          </button>
        </div>

        {buildCycles(s).map((cycle, i) => (
          <Cycle key={i} cycle={cycle} index={i} />
        ))}
      </div>
    </div>
  )
}
