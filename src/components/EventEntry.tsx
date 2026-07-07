import type { Entry } from '../lib/cycles'

function tintFor(entry: Entry): string {
  switch (entry.kind) {
    case 'message':
      if (entry.item.role === 'user') return 'border-l-4 border-sky-400 bg-sky-50 dark:bg-sky-950/40'
      if (entry.item.role === 'assistant')
        return 'border-l-4 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
      return 'border-l-4 border-neutral-300 bg-neutral-50 dark:bg-neutral-900'
    case 'reasoning':
      return 'border-l-4 border-slate-400 bg-slate-50 dark:bg-slate-900/60'
    case 'tool':
      return 'border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-950/40'
    case 'edit':
      return 'border-l-4 border-rose-400 bg-rose-50 dark:bg-rose-950/40'
    case 'token':
      return 'border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-950/40'
    case 'context':
      return 'border-l-4 border-violet-400 bg-violet-50 dark:bg-violet-950/40'
    case 'runtime':
      return 'border-l-4 border-zinc-400 bg-zinc-50 dark:bg-zinc-900'
  }
}

const cardBase = 'rounded-md border border-neutral-200 dark:border-neutral-800 mb-2 overflow-hidden'
const summaryClass = 'cursor-pointer select-none px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden'
const bodyClass = 'px-3 pb-3'
const preClass = 'bg-neutral-100 dark:bg-neutral-800 rounded-md text-xs p-2 overflow-x-auto'

export default function EventEntry({ entry }: { entry: Entry }) {
  const card = `${cardBase} ${tintFor(entry)}`

  switch (entry.kind) {
    case 'message': {
      const item = entry.item
      const phase = item.phase ? ' · ' + item.phase : ''
      return (
        <details className={card} open>
          <summary className={summaryClass}>{`${item.role}${phase} · line ${entry.line}`}</summary>
          <div className={bodyClass}>
            <div className="whitespace-pre-wrap break-words text-sm">{item.text}</div>
          </div>
        </details>
      )
    }
    case 'reasoning': {
      const item = entry.item
      const id = item.id ? ' · ' + item.id : ''
      return (
        <details className={card}>
          <summary className={summaryClass}>{`reasoning · line ${entry.line}${id}`}</summary>
          <div className={bodyClass}>
            <div className="whitespace-pre-wrap break-words text-sm">{item.text}</div>
          </div>
        </details>
      )
    }
    case 'tool': {
      const item = entry.item
      const callId = item.call_id ? ' · ' + item.call_id : ''
      return (
        <details className={card}>
          <summary className={summaryClass}>{`tool · ${item.name} · line ${entry.line}${callId}`}</summary>
          <div className={bodyClass}>
            <strong>Input</strong>
            <pre className={preClass}>{item.arguments}</pre>
            <strong>Output</strong>
            <pre className={preClass}>{item.output ?? ''}</pre>
          </div>
        </details>
      )
    }
    case 'edit': {
      const item = entry.item
      const failed = item.result?.success === false ? ' · failed' : ''
      return (
        <details className={card} open>
          <summary className={summaryClass}>{`edit · ${item.name} · line ${entry.line}${failed}`}</summary>
          <div className={bodyClass}>
            <strong>Patch</strong>
            <pre className={preClass}>{item.patch}</pre>
            {item.result && (
              <>
                <strong>Result</strong>
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
          <summary className={summaryClass}>
            {`token_count · line ${entry.line} · last ${item.last?.total_tokens ?? 'n/a'} tokens`}
          </summary>
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
          <summary className={summaryClass}>
            {`context · ${item.name} · line ${entry.line} · ${item.source} · ${item.chars} chars`}
          </summary>
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
          <summary className={summaryClass}>{`runtime · ${item.type} · line ${entry.line}`}</summary>
          <div className={bodyClass}>
            <pre className={preClass}>{item.text}</pre>
          </div>
        </details>
      )
    }
  }
}
