import { createContext, useContext, useState } from 'react'
import { cn } from '../lib/cn'

// ---------------------------------------------------------------------------
// A readable rendering of an arbitrary JSON value — no braces, no quotes, no
// commas. Structure is carried by indentation and a faint guide rule; a key sits
// in its own muted column and its value reads as plain text next to it.
//
// The point is inspection, not fidelity: anything that needs exact bytes should
// use the raw toggle / Copy JSON, which every caller keeps alongside this view.
// ---------------------------------------------------------------------------

// Contrast note: these trees often sit inside a dimmed context band, so the palette runs
// one step brighter than a normal label would — muted must still be READABLE.
const KEY = 'shrink-0 font-sans text-[0.66rem] text-neutral-500 dark:text-neutral-400'
const VAL = 'min-w-0 font-mono text-[0.68rem] break-words text-neutral-800 dark:text-neutral-100'

// Long prose is the common case in transcripts, so it gets a block of its own
// rather than being squeezed into the value column.
const BLOCK_AT = 90
const CLAMP_AT = 1200

// Terminal tools frequently return ANSI colour/cursor sequences. They are useful
// in a terminal but become visible control-code noise in a transcript.
const ANSI_ESCAPE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[ -/]*[@-~]))/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '')
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// The session's working directory, so paths inside the project can drop the part the
// owner already knows. Empty when unknown — then nothing is shortened.
export const WorkspaceRootContext = createContext<string | null>(null)

const normalizeSlashes = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * Shorten a path that lives inside the project: everything up to and including the
 * project directory is dropped, because it is the same for every file the owner sees.
 * A path OUTSIDE the project keeps every segment — there the location is the point.
 */
export function shortenPath(value: string, root: string | null): string {
  if (!root) return value
  const normalizedRoot = normalizeSlashes(root)
  if (!normalizedRoot) return value
  const normalizedValue = normalizeSlashes(value)
  // Windows paths differ in case between records (c:\ vs C:\), so compare case-insensitively.
  if (!normalizedValue.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) return value
  const relative = normalizedValue.slice(normalizedRoot.length + 1)
  return relative || value
}

// A value is treated as a path only when it looks like one AND resolves inside the
// project; anything else is left exactly as recorded.
function displayValue(raw: string, root: string | null): string {
  if (!root || raw.length < 3 || !/[\\/]/.test(raw)) return raw
  return shortenPath(raw, root)
}

// A LOT of the payload arrives as JSON stuffed inside a string — hook stdout,
// tool arguments, context attachments. Left alone it renders as one unbroken
// wall of braces and `\n` escapes, which is the least readable thing on screen.
// Parse it so it becomes a normal branch of the tree.
function asJson(v: unknown): unknown | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t.length < 2) return null
  const open = t[0]
  const close = t[t.length - 1]
  if (!((open === '{' && close === '}') || (open === '[' && close === ']'))) return null
  try {
    const parsed = JSON.parse(t) as unknown
    return isObj(parsed) || Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
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
  const root = useContext(WorkspaceRootContext)
  if (v === null || v === undefined) return <span className="font-mono text-[0.68rem] text-neutral-400 dark:text-neutral-500">—</span>
  // true/false stay true/false. Rewriting them as yes/no simplifies nothing — a boolean
  // is already plain English — and it quietly changes what the record actually said.
  if (typeof v === 'boolean')
    return (
      <span className={cn('font-mono text-[0.68rem]', v ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-400 dark:text-neutral-500')}>
        {String(v)}
      </span>
    )
  if (typeof v === 'number')
    return <span className="font-mono text-[0.68rem] tabular-nums text-sky-700 dark:text-sky-300">{v.toLocaleString()}</span>

  const raw = stripAnsi(String(v))
  const s = displayValue(raw, root)
  const hint = clockHint(k, raw)
  return (
    // A shortened path keeps its full value in the tooltip, so nothing is unrecoverable.
    <span className={VAL} title={s === raw ? undefined : raw}>
      {s || <span className="text-neutral-400 dark:text-neutral-500">(empty)</span>}
      {hint && <span className="ml-2 text-[0.62rem] text-neutral-400 dark:text-neutral-400">{hint}</span>}
    </span>
  )
}

// A multi-line / long string: shown as its own wrapped block, clamped so one
// 40 KB tool result can't bury the rest of the record.
function TextBlock({ text }: { text: string }) {
  const [full, setFull] = useState(false)
  const cleanText = stripAnsi(text)
  const long = cleanText.length > CLAMP_AT
  const shown = full || !long ? cleanText : cleanText.slice(0, CLAMP_AT)
  return (
    <div className="mt-0.5">
      <p className="whitespace-pre-wrap break-words font-mono text-[0.68rem] leading-relaxed text-neutral-800 dark:text-neutral-100">
        {shown}
        {long && !full && <span className="text-neutral-400 dark:text-neutral-500">…</span>}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setFull((f) => !f)}
          className="mt-0.5 text-[0.62rem] text-neutral-400 underline hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        >
          {full ? 'show less' : `show all ${cleanText.length.toLocaleString()} chars`}
        </button>
      )}
    </div>
  )
}

// Index keys tell you nothing, so an array item borrows its own identifying field
// as a label when it has one ("tool_use", "assistant", …).
const ID_KEYS = ['name', 'type', 'kind', 'label', 'tool', 'role', 'id']

const FRIENDLY_KEYS: Record<string, string> = {
  cwd: 'working directory',
  file_path: 'file',
  old_string: 'find',
  new_string: 'replace with',
  subagent_type: 'agent type',
  run_in_background: 'background',
  max_output_chars: 'max output',
  replace_all: 'replace all',
  multiSelect: 'multiple choice',
}

function readableKey(key: string): string {
  if (!key) return ''
  const exact = FRIENDLY_KEYS[key]
  if (exact) return exact
  const indexed = /^(\d+\.)\s*(.*)$/.exec(key)
  const prefix = indexed ? `${indexed[1]} ` : ''
  const body = indexed ? indexed[2] : key
  return (
    prefix +
    body
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\w/, (char) => char.toUpperCase())
  )
}

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
function Node({ k, v: raw }: { k: string; v: unknown }) {
  // JSON-in-a-string is unwrapped and rendered as a real branch, tagged so it's
  // clear the nesting came from a string.
  const embedded = asJson(raw)
  const v = embedded ?? raw
  const tag = embedded !== null ? <span className="text-[0.58rem] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">json</span> : null

  const branch = Array.isArray(v) || isObj(v)
  const empty = branch && (Array.isArray(v) ? v.length === 0 : Object.keys(v as object).length === 0)
  const label = readableKey(k)

  // An array of plain values (the common `["a","b"]` case) reads as a bullet list —
  // numeric index keys would be pure noise there.
  if (Array.isArray(v) && !empty && v.every((x) => !isObj(x) && !Array.isArray(x) && !(typeof x === 'string' && x.length > BLOCK_AT))) {
    return (
      <div className="mt-0.5">
        <div className="flex items-baseline gap-2">
          <span className={cn(KEY, 'text-neutral-500 dark:text-neutral-400')}>{label}</span>
          <span className="text-[0.6rem] text-neutral-400 dark:text-neutral-500">{branchLabel(v)}</span>
          {tag}
        </div>
        <div className="ml-[0.4rem] border-l border-neutral-200 pl-2.5 dark:border-neutral-800">
          {v.map((item, i) => (
            <div key={i} className="flex items-baseline gap-1.5">
              <span className="text-neutral-400 dark:text-neutral-500">·</span>
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
          <span className={cn(KEY, 'text-neutral-500 dark:text-neutral-400')}>{label}</span>
          <span className="text-[0.6rem] text-neutral-400 dark:text-neutral-500">{branchLabel(v)}</span>
          {tag}
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
        <span className={KEY}>{label}</span>
        <TextBlock text={v as string} />
      </div>
    )
  }

  return (
    <div className="flex items-baseline gap-2">
      <span className={cn(KEY, 'w-28 truncate text-right')} title={label}>
        {label}
      </span>
      {empty ? <span className="font-mono text-[0.66rem] text-neutral-400 dark:text-neutral-500">{branchLabel(v)}</span> : <Scalar k={k} v={v} />}
    </div>
  )
}

// Much of a transcript is JSON that arrives as a STRING — hook payloads, context
// attachments, Codex tool arguments. Render those as a tree too; anything that
// isn't JSON stays verbatim text.
export function MaybeJson({ text, className }: { text: string | null | undefined; className?: string }) {
  const body = stripAnsi(text ?? '')
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
            <span className="text-neutral-400 dark:text-neutral-500">·</span>
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
