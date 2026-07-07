import type { Entry } from '../lib/cycles'

function tintFor(entry: Entry): string {
  switch (entry.kind) {
    case 'message':
      if (entry.item.role === 'user') return 'border-l-2 border-sky-400 bg-sky-50/70 dark:bg-sky-950/25'
      if (entry.item.role === 'assistant') return 'border-l-2 border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/25'
      return 'border-l-2 border-neutral-300 bg-neutral-50 dark:bg-neutral-900'
    case 'reasoning':
      return 'border-l-2 border-slate-400 bg-slate-50 dark:bg-slate-900/40'
    case 'tool':
      return 'border-l-2 border-amber-400 bg-amber-50/70 dark:bg-amber-950/25'
    case 'edit':
      return 'border-l-2 border-rose-400 bg-rose-50/70 dark:bg-rose-950/25'
    case 'token':
      return 'border-l-2 border-blue-400 bg-blue-50/70 dark:bg-blue-950/25'
    case 'context':
      return 'border-l-2 border-violet-400 bg-violet-50/70 dark:bg-violet-950/25'
    case 'runtime':
      return 'border-l-2 border-zinc-400 bg-zinc-50 dark:bg-zinc-900'
  }
}

const cardBase = 'mb-1.5 overflow-hidden rounded-md border border-neutral-200/80 dark:border-neutral-800/80'
const summaryClass =
  'cursor-pointer select-none px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden hover:bg-white/55 dark:hover:bg-white/[0.03]'
const bodyClass = 'px-3 pb-3'
const preClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-300'

function preview(text: string | null | undefined): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  return clean.length > 120 ? `${clean.slice(0, 120)}...` : clean
}

function SummaryLine({ title, meta, previewText }: { title: string; meta?: string; previewText?: string }) {
  return (
    <summary className={summaryClass}>
      <span className="text-neutral-800 dark:text-neutral-100">{title}</span>
      {meta && <span className="ml-2 font-normal text-neutral-500 dark:text-neutral-400">{meta}</span>}
      {previewText && <span className="ml-2 font-normal text-neutral-500 dark:text-neutral-400">{previewText}</span>}
    </summary>
  )
}

export default function EventEntry({ entry }: { entry: Entry }) {
  const card = `${cardBase} ${tintFor(entry)}`

  switch (entry.kind) {
    case 'message': {
      const item = entry.item
      const phase = item.phase ? ` / ${item.phase}` : ''
      return (
        <details className={card}>
          <SummaryLine title={item.role} meta={`line ${entry.line}${phase}`} previewText={preview(item.text)} />
          <div className={bodyClass}>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.text}</div>
          </div>
        </details>
      )
    }
    case 'reasoning': {
      const item = entry.item
      const id = item.id ? ` / ${item.id}` : ''
      return (
        <details className={card}>
          <SummaryLine title="reasoning" meta={`line ${entry.line}${id}`} previewText={preview(item.text)} />
          <div className={bodyClass}>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.text}</div>
          </div>
        </details>
      )
    }
    case 'tool': {
      const item = entry.item
      const callId = item.call_id ? ` / ${item.call_id}` : ''
      return (
        <details className={card}>
          <SummaryLine title={`tool / ${item.name}`} meta={`line ${entry.line}${callId}`} previewText={preview(item.arguments)} />
          <div className={`${bodyClass} space-y-2`}>
            <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Input</div>
            <pre className={preClass}>{item.arguments}</pre>
            <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Output</div>
            <pre className={preClass}>{item.output ?? ''}</pre>
          </div>
        </details>
      )
    }
    case 'edit': {
      const item = entry.item
      const failed = item.result?.success === false ? ' / failed' : ''
      return (
        <details className={card}>
          <SummaryLine title={`edit / ${item.name}`} meta={`line ${entry.line}${failed}`} previewText={preview(item.patch)} />
          <div className={`${bodyClass} space-y-2`}>
            <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Patch</div>
            <pre className={preClass}>{item.patch}</pre>
            {item.result && (
              <>
                <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Result</div>
                <pre className={preClass}>{JSON.stringify(item.result, null, 2)}</pre>
              </>
            )}
          </div>
        </details>
      )
    }
    case 'token': {
      const item = entry.item
      return (
        <details className={card}>
          <SummaryLine title="token_count" meta={`line ${entry.line} / last ${item.last?.total_tokens ?? 'n/a'} tokens`} />
          <div className={bodyClass}>
            <pre className={preClass}>{JSON.stringify(item, null, 2)}</pre>
          </div>
        </details>
      )
    }
    case 'context': {
      const item = entry.item
      return (
        <details className={card}>
          <SummaryLine title={`context / ${item.name}`} meta={`line ${entry.line} / ${item.source} / ${item.chars} chars`} />
          <div className={bodyClass}>
            <pre className={preClass}>{item.text}</pre>
          </div>
        </details>
      )
    }
    case 'runtime': {
      const item = entry.item
      return (
        <details className={card}>
          <SummaryLine title={`runtime / ${item.type}`} meta={`line ${entry.line}`} previewText={preview(item.text)} />
          <div className={bodyClass}>
            <pre className={preClass}>{item.text}</pre>
          </div>
        </details>
      )
    }
  }
}
