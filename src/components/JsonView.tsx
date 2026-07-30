import { useState } from 'react'
import { cn } from '../lib/cn'

// ---------------------------------------------------------------------------
// A readable rendering of an arbitrary JSON value — no braces, no quotes, no
// commas. Structure is carried by indentation and a faint guide rule; a key sits
// in its own muted column and its value reads as plain text next to it.
//
// The point is inspection, not fidelity: anything that needs exact bytes should
// use the raw toggle / Copy JSON, which every caller keeps alongside this view.
// ---------------------------------------------------------------------------

const KEY = 'shrink-0 font-mono text-[0.66rem] text-neutral-400 dark:text-neutral-500'
const VAL = 'min-w-0 font-mono text-[0.68rem] break-words text-neutral-700 dark:text-neutral-200'

// Long prose is the common case in transcripts, so it gets a block of its own
// rather than being squeezed into the value column.
const BLOCK_AT = 90
const CLAMP_AT = 1200

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// A key whose value is an ISO instant reads better with the wall-clock beside it.
function clockHint(key: string, v: string): string | null {
  if (!/(^|_)(timestamp|time|at)$/i.test(key)) return null
  const ms = Date.parse(v)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function Scalar({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined) return <span className="font-mono text-[0.68rem] text-neutral-300 dark:text-neutral-600">—</span>
  if (typeof v === 'boolean')
    return (
      <span className={cn('font-mono text-[0.68rem]', v ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-400 dark:text-neutral-500')}>
        {v ? 'yes' : 'no'}
      </span>
    )
  if (typeof v === 'number')
    return <span className="font-mono text-[0.68rem] tabular-nums text-sky-700 dark:text-sky-300">{v.toLocaleString()}</span>

  const s = String(v)
  const hint = clockHint(k, s)
  return (
    <span className={VAL}>
      {s || <span className="text-neutral-300 dark:text-neutral-600">(empty)</span>}
      {hint && <span className="ml-2 text-[0.62rem] text-neutral-400 dark:text-neutral-500">{hint}</span>}
    </span>
  )
}

// A multi-line / long string: shown as its own wrapped block, clamped so one
// 40 KB tool result can't bury the rest of the record.
function TextBlock({ text }: { text: string }) {
  const [full, setFull] = useState(false)
  const long = text.length > CLAMP_AT
  const shown = full || !long ? text : text.slice(0, CLAMP_AT)
  return (
    <div className="mt-0.5">
      <p className="whitespace-pre-wrap break-words font-mono text-[0.68rem] leading-relaxed text-neutral-700 dark:text-neutral-200">
        {shown}
        {long && !full && <span className="text-neutral-400 dark:text-neutral-500">…</span>}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setFull((f) => !f)}
          className="mt-0.5 text-[0.62rem] text-neutral-400 underline hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        >
          {full ? 'show less' : `show all ${text.length.toLocaleString()} chars`}
        </button>
      )}
    </div>
  )
}

// Index keys tell you nothing, so an array item borrows its own identifying field
// as a label when it has one ("tool_use", "assistant", …).
const ID_KEYS = ['name', 'type', 'kind', 'label', 'tool', 'role', 'id']

function itemLabel(item: unknown, i: number): string {
  if (isObj(item)) {
    for (const key of ID_KEYS) {
      const v = item[key]
      if (typeof v === 'string' && v.trim()) return `${i}. ${v.slice(0, 32)}`
    }
  }
  return `${i}.`
}

function branchLabel(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? 'empty' : `${v.length} ${v.length === 1 ? 'item' : 'items'}`
  const n = Object.keys(v as object).length
  return n === 0 ? 'empty' : `${n} ${n === 1 ? 'field' : 'fields'}`
}

// One key → value line. Branches nest; scalars sit on the line; long strings drop
// to a block underneath the key.
function Node({ k, v }: { k: string; v: unknown }) {
  const branch = Array.isArray(v) || isObj(v)
  const empty = branch && (Array.isArray(v) ? v.length === 0 : Object.keys(v as object).length === 0)

  // An array of plain values (the common `["a","b"]` case) reads as a bullet list —
  // numeric index keys would be pure noise there.
  if (Array.isArray(v) && !empty && v.every((x) => !isObj(x) && !Array.isArray(x) && !(typeof x === 'string' && x.length > BLOCK_AT))) {
    return (
      <div className="mt-0.5">
        <div className="flex items-baseline gap-2">
          <span className={cn(KEY, 'text-neutral-500 dark:text-neutral-400')}>{k}</span>
          <span className="text-[0.6rem] text-neutral-300 dark:text-neutral-600">{branchLabel(v)}</span>
        </div>
        <div className="ml-[0.4rem] border-l border-neutral-200 pl-2.5 dark:border-neutral-800">
          {v.map((item, i) => (
            <div key={i} className="flex items-baseline gap-1.5">
              <span className="text-neutral-300 dark:text-neutral-600">·</span>
              <Scalar k={k} v={item} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (branch && !empty) {
    const entries: Array<[string, unknown]> = Array.isArray(v)
      ? v.map((item, i) => [itemLabel(item, i), item] as [string, unknown])
      : Object.entries(v as Record<string, unknown>)
    return (
      <div className="mt-0.5">
        <div className="flex items-baseline gap-2">
          <span className={cn(KEY, 'text-neutral-500 dark:text-neutral-400')}>{k}</span>
          <span className="text-[0.6rem] text-neutral-300 dark:text-neutral-600">{branchLabel(v)}</span>
        </div>
        <div className="ml-[0.4rem] border-l border-neutral-200 pl-2.5 dark:border-neutral-800">
          {entries.map(([ck, cv]) => (
            <Node key={ck} k={ck} v={cv} />
          ))}
        </div>
      </div>
    )
  }

  const asText = typeof v === 'string' && (v.includes('\n') || v.length > BLOCK_AT)
  if (asText) {
    return (
      <div className="mt-0.5">
        <span className={KEY}>{k}</span>
        <TextBlock text={v as string} />
      </div>
    )
  }

  return (
    <div className="flex items-baseline gap-2">
      <span className={cn(KEY, 'w-28 truncate text-right')} title={k}>
        {k}
      </span>
      {empty ? <span className="font-mono text-[0.66rem] text-neutral-300 dark:text-neutral-600">{branchLabel(v)}</span> : <Scalar k={k} v={v} />}
    </div>
  )
}

// Much of a transcript is JSON that arrives as a STRING — hook payloads, context
// attachments, Codex tool arguments. Render those as a tree too; anything that
// isn't JSON stays verbatim text.
export function MaybeJson({ text, className }: { text: string | null | undefined; className?: string }) {
  const body = text ?? ''
  const t = body.trim()
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      const parsed = JSON.parse(t) as unknown
      if (isObj(parsed) || Array.isArray(parsed)) {
        return (
          <div className="overflow-x-auto rounded-md bg-white/70 dark:bg-neutral-950/55">
            <JsonView value={parsed} />
          </div>
        )
      }
    } catch {
      // not JSON after all — fall through to plain text
    }
  }
  return <pre className={className}>{body}</pre>
}

export default function JsonView({ value, hideKeys = [] }: { value: unknown; hideKeys?: string[] }) {
  if (!isObj(value) && !Array.isArray(value)) {
    return (
      <div className="px-2 py-1.5">
        <Scalar k="" v={value} />
      </div>
    )
  }
  // Top-level list of plain values: bullets, not 0/1/2 keys.
  if (Array.isArray(value) && value.length > 0 && value.every((x) => !isObj(x) && !Array.isArray(x))) {
    return (
      <div className="px-2 py-1.5">
        {value.map((item, i) => (
          <div key={i} className="flex items-baseline gap-1.5">
            <span className="text-neutral-300 dark:text-neutral-600">·</span>
            <Scalar k="" v={item} />
          </div>
        ))}
      </div>
    )
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, i) => [itemLabel(item, i), item] as [string, unknown])
    : Object.entries(value as Record<string, unknown>).filter(([k]) => !hideKeys.includes(k))

  if (entries.length === 0) return <div className="px-2 py-1.5 text-[0.66rem] text-neutral-400">(empty)</div>

  return (
    <div className="px-2 py-1.5">
      {entries.map(([k, v]) => (
        <Node key={k} k={k} v={v} />
      ))}
    </div>
  )
}
