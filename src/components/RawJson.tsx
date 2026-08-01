import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/cn'
import { stripAnsi } from './JsonView'

// ---------------------------------------------------------------------------
// The RAW record, rendered as a JSON viewer rather than a `JSON.stringify` wall.
//
// Difference from JsonView: this one is faithful. Keys keep their exact source
// spelling, nothing is renamed, nothing is hidden, and no JSON-in-a-string is
// silently unwrapped — what you see is the record's own shape. What it drops is
// only the syntax you never needed to read: braces, commas, and quotes around
// keys and strings. Every branch collapses, so a 40 KB record opens as a dozen
// readable lines instead of a scroll.
//
// Exact bytes still live one click away behind each caller's Copy JSON.
// ---------------------------------------------------------------------------

// How deep the tree comes up expanded. Two levels shows a record's own fields
// and one step inside them — enough to orient, short enough to scan.
const OPEN_DEPTH = 2

// A string longer than this stops being a value on a line and becomes its own
// wrapped block underneath the key.
const BLOCK_AT = 80
const CLAMP_AT = 1600

const KEY = 'shrink-0 font-mono text-[0.66rem] text-violet-700/80 dark:text-violet-300/80'
const COUNT = 'shrink-0 font-mono text-[0.6rem] text-neutral-400 dark:text-neutral-500'

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isBranch(v: unknown): boolean {
  return Array.isArray(v) || isObj(v)
}

function count(v: unknown): number {
  return Array.isArray(v) ? v.length : Object.keys(v as object).length
}

function branchLabel(v: unknown): string {
  const n = count(v)
  if (Array.isArray(v)) return n === 0 ? '[ ]' : `${n} ${n === 1 ? 'item' : 'items'}`
  return n === 0 ? '{ }' : `${n} ${n === 1 ? 'field' : 'fields'}`
}

// What a collapsed branch shows on its own line, so you can often skip opening
// it: the field names for an object, the first values for an array.
function peek(v: unknown): string {
  if (Array.isArray(v)) {
    const parts = v.slice(0, 4).map((item) => (isBranch(item) ? branchLabel(item) : oneLine(item)))
    return parts.join(', ') + (v.length > 4 ? ', …' : '')
  }
  const keys = Object.keys(v as object)
  return keys.slice(0, 6).join(', ') + (keys.length > 6 ? ', …' : '')
}

function oneLine(v: unknown, max = 24): string {
  const s = stripAnsi(String(v)).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

// Scalars are typed by colour, not by punctuation — that is what earns dropping
// the quotes: a string still doesn't look like a number.
function Scalar({ v }: { v: unknown }) {
  if (v === null) return <span className="font-mono text-[0.68rem] italic text-neutral-400 dark:text-neutral-500">null</span>
  if (v === undefined) return <span className="font-mono text-[0.68rem] italic text-neutral-400 dark:text-neutral-500">undefined</span>
  if (typeof v === 'boolean')
    return (
      <span className={cn('font-mono text-[0.68rem]', v ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400')}>
        {String(v)}
      </span>
    )
  if (typeof v === 'number')
    return <span className="font-mono text-[0.68rem] tabular-nums text-sky-700 dark:text-sky-300">{v.toLocaleString()}</span>

  const s = stripAnsi(String(v))
  if (!s) return <span className="font-mono text-[0.68rem] italic text-neutral-400 dark:text-neutral-500">empty</span>
  return <span className="min-w-0 break-words font-mono text-[0.68rem] text-neutral-800 dark:text-neutral-100">{s}</span>
}

function TextBlock({ text }: { text: string }) {
  const [full, setFull] = useState(false)
  const clean = stripAnsi(text)
  const long = clean.length > CLAMP_AT
  return (
    <div className="mt-0.5 border-l border-neutral-200 pl-2 dark:border-neutral-800">
      <p className="whitespace-pre-wrap break-words font-mono text-[0.68rem] leading-relaxed text-neutral-800 dark:text-neutral-100">
        {full || !long ? clean : clean.slice(0, CLAMP_AT)}
        {long && !full && <span className="text-neutral-400 dark:text-neutral-500">…</span>}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setFull((f) => !f)}
          className="mt-0.5 font-mono text-[0.62rem] text-neutral-400 underline hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        >
          {full ? 'show less' : `show all ${clean.length.toLocaleString()} chars`}
        </button>
      )}
    </div>
  )
}

function Node({ k, v, depth }: { k: string; v: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < OPEN_DEPTH)

  if (isBranch(v)) {
    const empty = count(v) === 0
    const entries: Array<[string, unknown]> = Array.isArray(v)
      ? v.map((item, i) => [String(i), item] as [string, unknown])
      : Object.entries(v as Record<string, unknown>)
    return (
      <div>
        <button
          type="button"
          disabled={empty}
          onClick={() => setOpen((o) => !o)}
          className="group flex w-full min-w-0 items-baseline gap-1.5 rounded px-1 py-px text-left hover:bg-neutral-100/70 disabled:hover:bg-transparent dark:hover:bg-neutral-800/50"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 translate-y-0.5 text-neutral-400 transition-transform dark:text-neutral-500',
              open && 'rotate-90',
              empty && 'invisible',
            )}
          />
          <span className={KEY}>{k}</span>
          <span className={COUNT}>{branchLabel(v)}</span>
          {!open && !empty && (
            <span className="min-w-0 flex-1 truncate font-mono text-[0.62rem] text-neutral-400 dark:text-neutral-600">{peek(v)}</span>
          )}
        </button>
        {open && !empty && (
          <div className="ml-[0.6rem] border-l border-neutral-200 pl-2.5 dark:border-neutral-800">
            {entries.map(([ck, cv]) => (
              <Node key={ck} k={ck} v={cv} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // A long or multi-line string gets the key on its own line and the text below,
  // so prose is never squeezed into a narrow value column.
  if (typeof v === 'string' && (v.includes('\n') || v.length > BLOCK_AT)) {
    return (
      <div className="px-1 py-px">
        <div className="flex items-baseline gap-1.5 pl-[1.125rem]">
          <span className={KEY}>{k}</span>
          <span className={COUNT}>{v.length.toLocaleString()} chars</span>
        </div>
        <div className="ml-[1.125rem]">
          <TextBlock text={v} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-baseline gap-1.5 rounded px-1 py-px pl-[1.375rem] hover:bg-neutral-100/70 dark:hover:bg-neutral-800/50">
      <span className={KEY}>{k}</span>
      <Scalar v={v} />
    </div>
  )
}

export default function RawJson({ value }: { value: unknown }) {
  if (!isBranch(value)) {
    return (
      <div className="px-2 py-1.5">
        <Scalar v={value} />
      </div>
    )
  }
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, i) => [String(i), item] as [string, unknown])
    : Object.entries(value as Record<string, unknown>)

  if (entries.length === 0) {
    return <div className="px-2 py-1.5 font-mono text-[0.66rem] text-neutral-400 dark:text-neutral-500">{branchLabel(value)}</div>
  }

  return (
    <div className="px-1.5 py-1.5">
      {entries.map(([k, v]) => (
        <Node key={k} k={k} v={v} depth={0} />
      ))}
    </div>
  )
}
