import { useState } from 'react'
import { Braces, Check, ChevronRight, Copy } from 'lucide-react'
import { cn } from '../lib/cn'
import { shortAge } from '../lib/format'
import TypeTag from './TypeTag'
import JsonView from './JsonView'
import RawJson from './RawJson'
import type { FeedRecord } from '../types'

// --- preview extraction ---------------------------------------------------
// Claude Code log lines vary a lot in shape. We pull a compact, human one-liner
// out of each without assuming a rigid schema — everything is defensively typed.

function firstText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (typeof b.text === 'string' && b.text.trim()) return b.text
    if (typeof b.thinking === 'string' && b.thinking.trim()) return b.thinking
    if (b.type === 'tool_use' && typeof b.name === 'string') return `→ ${b.name}`
    if (b.type === 'tool_result') {
      const c = b.content
      if (typeof c === 'string' && c.trim()) return c
      const inner = firstText(c)
      if (inner) return inner
    }
  }
  return null
}

function codexPayloadPreview(payload: Record<string, unknown>): string | null {
  const kind = typeof payload.type === 'string' ? payload.type : ''
  if (kind === 'message') {
    const text = firstText(payload.content)
    return text || (typeof payload.role === 'string' ? `${payload.role} message` : 'message')
  }
  if (kind === 'reasoning') {
    const summary = firstText(payload.summary)
    return summary || (payload.encrypted_content ? 'encrypted reasoning' : 'reasoning')
  }
  if (kind.endsWith('_call') || kind === 'function_call') {
    const name = typeof payload.name === 'string' ? payload.name : kind.replace(/_call$/, '')
    const args = payload.arguments ?? payload.input ?? payload.action
    const text = typeof args === 'string' ? args : args ? JSON.stringify(args) : ''
    return `→ ${name}${text ? ` ${text}` : ''}`
  }
  if (kind.endsWith('_output')) {
    const output = payload.output
    const text = typeof output === 'string' ? output : output ? JSON.stringify(output) : ''
    return text || kind.replace(/_/g, ' ')
  }
  if (typeof payload.type === 'string') return payload.type.replace(/_/g, ' ')
  return null
}

function recordPreview(rec: FeedRecord): string {
  const msg = rec.message as Record<string, unknown> | undefined
  if (msg && typeof msg === 'object') {
    const t = firstText(msg.content)
    if (t) return t
  }
  // Common non-message shapes.
  if (typeof rec.summary === 'string') return rec.summary
  if (typeof rec.content === 'string') return rec.content
  const t = firstText(rec.content)
  if (t) return t
  // Codex stores the source JSONL payload under a top-level `payload` object.
  // Treat it as a first-class record shape instead of falling back to `{ type, payload }`.
  if (rec.payload && typeof rec.payload === 'object' && !Array.isArray(rec.payload)) {
    const t = codexPayloadPreview(rec.payload as Record<string, unknown>)
    if (t) return t
  }
  // Warp events carry a flat `text` (assistant prose, reasoning, or a tool payload).
  if (typeof rec.text === 'string' && rec.text.trim()) {
    return typeof rec.tool === 'string' ? `→ ${rec.tool} ${rec.text}` : rec.text
  }
  // Fall back to a compact key list so the row is never blank.
  const keys = Object.keys(rec).filter((k) => k !== '_line' && k !== '_type')
  return keys.length ? `{ ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', …' : ''} }` : '(empty)'
}

function recordTypeLabel(record: FeedRecord): string {
  const payload = record.payload
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const subtype = (payload as Record<string, unknown>).type
    if (typeof subtype === 'string') return `${record._type}/${subtype}`
  }
  return record._type
}

function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

// --------------------------------------------------------------------------

export default function RecordRow({
  record,
  now,
  defaultRaw = false,
}: {
  record: FeedRecord
  now: Date
  // The JSON tab opens rows on the faithful view — its whole point is the stored
  // shape — while the Raw tab keeps the readable one. Same row either way.
  defaultRaw?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // Readable key/value tree by default; raw JSON stays one click away for when the
  // exact bytes matter.
  const [raw, setRaw] = useState(defaultRaw)

  const json = JSON.stringify(record, null, 2)
  const preview = oneLine(recordPreview(record))
  const ts = typeof record.timestamp === 'string' ? record.timestamp : null

  function copy() {
    void navigator.clipboard?.writeText(json).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform', open && 'rotate-90')}
        />
        <span className="w-8 shrink-0 text-right font-mono text-[0.62rem] tabular-nums text-neutral-400 dark:text-neutral-500">
          {record._line}
        </span>
        <TypeTag type={recordTypeLabel(record)} />
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-700 dark:text-neutral-300">{preview}</span>
        {ts && (
          <span className="shrink-0 font-mono text-[0.62rem] tabular-nums text-neutral-400 dark:text-neutral-500">
            {shortAge(ts, now)}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="font-mono text-[0.62rem] text-neutral-400 dark:text-neutral-500">
              line {record._line}
              {typeof record.uuid === 'string' ? ` · ${record.uuid.slice(0, 8)}` : ''}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRaw((r) => !r)}
                title={raw ? 'Back to the readable view' : 'Show the raw JSON line'}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[0.62rem] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Braces className="h-3 w-3" />
                {raw ? 'Readable' : 'Raw JSON'}
              </button>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[0.62rem] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
          </div>
          {raw ? (
            <div className="max-h-[28rem] overflow-y-auto bg-neutral-50 dark:bg-neutral-900">
              {/* Faithful shape and key names, collapsible — exact bytes are on Copy JSON. */}
              <RawJson value={record} />
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto bg-neutral-50 dark:bg-neutral-900">
              {/* _line and _type already sit in the row header — repeating them is noise. */}
              <JsonView value={record} hideKeys={['_line', '_type']} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
