import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Lock, ChevronRight, Braces, Check, Copy } from 'lucide-react'
import type { Entry, EntryUsage, StepDuration } from '../lib/unifiedCycles'
import type { Message, Reasoning, Tool, CodeEdit, ContextBlock, RuntimeEvent, TokenEvent } from '../types'
import type {
  ClaudeMessage,
  ClaudeThinking,
  ClaudeTool,
  ClaudeEdit,
  ClaudeContext,
  ClaudeUsageFrame,
  ClaudeSubagent,
} from '../lib/claudeModel'
import { fmtCompact, fmtCurrency, fmtDuration } from '../lib/format'
import {
  splitUsage,
  usageUnitTotal,
  TOKEN_UNIT_REF_LABELS,
  type CurrencyMode,
  type TokenRates,
  type TokenUnitRef,
  type UsageUnitMode,
} from '../lib/pricing'
import UsageBar from './UsageBar'
import ToolResult from './ToolResult'
import JsonView, { MaybeJson, stripAnsi } from './JsonView'
import RawJson from './RawJson'
import { parseToolInvocations, ReadableToolInput, ReadableToolOutput } from './ReadableToolPayload'
import DiffView from './DiffView'
import BaseInstructions, { isStructuredInstructionPayload, looksLikeStructuredContext } from './BaseInstructions'
import Markdown, { stripMarkdown } from './Markdown'
import MessageBody from './MessageBody'
import { shortenUserPrompt } from '../lib/localLlm'
import { hasInjected, injectedLabels, ownPromptText, splitPrompt } from '../lib/promptText'

interface UsageProps {
  usage?: EntryUsage
  rates: TokenRates | null
  unitMode: UsageUnitMode
  currency: CurrencyMode
  tokenRef: TokenUnitRef
  tokenMult?: number
  // Cycle total in the active unit, so each card's bar is its true fraction of the cycle.
  scaleMax?: number
}

// One accent per unified kind — now just a left border colour, no card box or fill.
// Message accents split by role (Claude roles are only user/assistant; Codex may also
// carry 'system' → the neutral fallback).
function tintFor(entry: Entry): string {
  switch (entry.kind) {
    case 'message': {
      const role = (entry.item as Message | ClaudeMessage).role
      if (role === 'user') return 'border-l-sky-400'
      if (role === 'assistant') return 'border-l-emerald-400'
      return 'border-l-neutral-300 dark:border-l-neutral-700'
    }
    case 'thinking':
      return 'border-l-slate-400'
    case 'tool':
      // No accent: tool rows are the bulk of a cycle, so an amber strip on each one
      // painted the whole column yellow. Only the assistant's green line stays loud.
      return 'border-l-transparent'
    case 'edit':
      return 'border-l-rose-400'
    case 'usage':
      return 'border-l-blue-400'
    case 'context':
      return 'border-l-neutral-300 dark:border-l-neutral-700'
    case 'runtime':
      return 'border-l-zinc-400'
    case 'subagent':
      return 'border-l-indigo-400'
  }
}

// Compact, borderless rows: a left accent strip + a hairline divider, no card padding.
const rowBase =
  'overflow-hidden border-l-2 border-b border-b-neutral-100 dark:border-b-neutral-900/70'
const summaryClass =
  'flex cursor-pointer select-none list-none items-center gap-1.5 px-2 py-1 text-xs marker:hidden [&::-webkit-details-marker]:hidden hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
// pl-2, not pl-7: the old indent reserved room for a chevron that no longer exists, so
// the body now lines up with the title above it.
const bodyClass = 'space-y-2 px-2 pb-2 pt-1 text-sm'
const preClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-300'

// Codex records some reasoning only as encrypted content — Karin can't show plaintext.
// The indexer emits this exact marker (see karin.py text_from_reasoning).
function isLockedReasoning(text: string | null | undefined): boolean {
  return !!text && text.startsWith('Encrypted reasoning content recorded by Codex')
}

// The record behind the currently-rendered step, so every expanded Row can offer the
// same "Raw JSON" switch the Raw tab's records have — without threading the item
// through a dozen Row call sites.
const RawItemContext = createContext<unknown>(undefined)

// Toggles a step's body between its structured rendering and the raw record. Raw
// REPLACES the structure rather than sitting beside it: the point is to see the
// untouched data, and two copies of the same thing is what made the old layout noisy.
function RawSwitch({ item, children }: { item: unknown; children: ReactNode }) {
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState(false)
  const json = useMemo(() => {
    try {
      return JSON.stringify(item, null, 2)
    } catch {
      return String(item)
    }
  }, [item])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  const btn =
    'inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[0.62rem] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
  return (
    <>
      <div className="flex items-center justify-end gap-1">
        {raw && (
          <button type="button" onClick={() => void copy()} className={btn}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setRaw((r) => !r)}
          title={raw ? 'Back to the readable view' : 'Replace this step with its raw JSON record'}
          className={btn}
        >
          <Braces className="h-3 w-3" />
          {raw ? 'Readable' : 'Raw JSON'}
        </button>
      </div>
      {raw ? (
        <div className="max-h-[28rem] overflow-y-auto rounded-md bg-neutral-50 dark:bg-neutral-900">
          <RawJson value={item} />
        </div>
      ) : (
        children
      )}
    </>
  )
}

// Inline disclosure chevron — rotates when its <details> ancestor is open. Replaces the
// native marker (killed via list-none / marker:hidden) so it sits on the title line.
function Chevron() {
  return (
    <ChevronRight className="h-3 w-3 shrink-0 text-neutral-400 transition-transform [[open]_&]:rotate-90 dark:text-neutral-500" />
  )
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm bg-neutral-200/80 px-1 py-0.5 text-[0.5rem] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      {children}
    </span>
  )
}

// Right-aligned per-card duration: how long this step ran (gap to the next
// event). The owner-deliberation step (answering an AskUserQuestion) is flagged
// `wait` and reads "waiting on you", not counted as AI work.
function StepDur({ step }: { step?: StepDuration }) {
  if (!step || step.ms == null) return null
  // A step that rounds to "0s" says nothing — the column is noise on every fast row.
  if (fmtDuration(step.ms) === '0s') return null
  if (step.wait) {
    return (
      <span
        className="ml-auto shrink-0 whitespace-nowrap pl-2 text-[0.6rem] font-normal italic text-violet-500 dark:text-violet-400"
        title="Time you spent answering — not counted as AI work"
      >
        waiting on you · {fmtDuration(step.ms)}
      </span>
    )
  }
  return (
    <span
      className="ml-auto shrink-0 whitespace-nowrap pl-2 font-mono text-[0.6rem] font-normal text-neutral-400 dark:text-neutral-500"
      title="How long this step ran (until the next event)"
    >
      {fmtDuration(step.ms)}
    </span>
  )
}

// The single compact row primitive every event kind renders through. The summary is one
// inline flex line (chevron · title · badge · meta · duration); the body only
// exists once expanded and carries the optional usage bar plus the kind-specific content.
function Row({
  title,
  overflowTitle,
  meta,
  badge,
  tint,
  step,
  bar,
  thin,
  hideBar,
  clamp,
  dim,
  dashed,
  disabled,
  expandable = true,
  children,
}: {
  title: ReactNode
  // Optional replacement for the collapsed title — a caller passes this when it has a
  // better line to show (e.g. a locally shortened prompt) and it simply wins.
  overflowTitle?: ReactNode
  meta?: ReactNode
  badge?: ReactNode
  tint: string
  step?: StepDuration
  bar?: ReactNode
  // A thin (~4px) always-visible usage bar in the collapsed summary; the full labelled bar
  // lives in the body (expanded). Lets a step show its token weight without a header row.
  thin?: ReactNode
  // The summary already shows the compact markers, so omit the duplicate expanded bar.
  hideBar?: boolean
  // Render `title` as the row's body text, wrapping up to 3 lines (no separate label/meta) —
  // used for assistant replies, which show their own text instead of an "assistant:" label.
  clamp?: boolean
  dim?: boolean
  dashed?: boolean
  disabled?: boolean
  expandable?: boolean
  children: ReactNode
}) {
  const rawItem = useContext(RawItemContext)
  const canExpand = expandable
  const hasTitle = title !== null && title !== undefined && title !== ''
  const shownTitle = overflowTitle !== undefined ? overflowTitle : title
  const header = (
    <div className={`flex gap-1.5 ${clamp ? 'items-start' : 'items-center'}`}>
      {/* No chevron: every step row expands, so the marker distinguished nothing and
          only stole width from the title on each of a cycle's dozens of rows. */}
      {/* Token markers sit before the text on EVERY row, the way tool rows always did.
          Rendering them under the text for some kinds made those rows read as a
          different shape and pushed their titles out of line with the rest. */}
      {thin}
      {/* No `block` on the clamped title: line-clamp needs display:-webkit-box, and
          `block` overrode it, which let a whitespace-collapsed preview render as a
          full-height wall instead of three lines. */}
      {clamp ? (
        <span className="line-clamp-3 min-w-0 flex-1 break-words font-normal leading-snug text-neutral-700 dark:text-neutral-200">
          {shownTitle}
        </span>
      ) : (
        <>
          {hasTitle && <span className="shrink-0 font-medium text-neutral-800 dark:text-neutral-100">{title}</span>}
          {badge}
          {meta != null && meta !== '' && (
            <span className={`min-w-0 truncate ${hasTitle ? 'flex-1 font-normal text-neutral-500 dark:text-neutral-400' : 'font-medium text-neutral-800 dark:text-neutral-100'}`}>{meta}</span>
          )}
        </>
      )}
      {clamp && badge}
      <StepDur step={step} />
    </div>
  )
  const summary = (
    <div className={`flex select-none flex-col gap-px px-2 py-1 text-xs ${disabled || !canExpand ? 'cursor-default' : 'cursor-pointer'}`}>
      {header}
    </div>
  )
  if (disabled) {
    return <div className={`${rowBase} ${tint} ${dashed ? 'border-l-dashed' : ''} opacity-60 grayscale`}>{summary}</div>
  }
  if (!canExpand) {
    return <div className={`${rowBase} ${tint} ${dashed ? 'border-l-dashed' : ''} ${dim ? 'opacity-90' : ''}`}>{summary}</div>
  }
  return (
    // data-step-row lets the cycle's accordion listener tell step rows apart from
    // nested disclosure widgets (raw toggles, "Raw payload" details) inside bodies.
    <details data-step-row="" className={`${rowBase} ${tint} ${dashed ? 'border-l-dashed' : ''} ${dim ? 'opacity-90' : ''}`}>
      <summary className="flex cursor-pointer select-none list-none flex-col gap-px px-2 py-1 text-xs marker:hidden [&::-webkit-details-marker]:hidden hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
        {summary}
      </summary>
      <div className={bodyClass}>
        {!hideBar && bar}
        {rawItem === undefined ? children : <RawSwitch item={rawItem}>{children}</RawSwitch>}
      </div>
    </details>
  )
}

// Per-card token bar. Drives BOTH sources off the attribution map: Codex content cards get
// an ESTIMATED (hatched, "≈ … est") bar, Codex token frames + every Claude usage frame get
// a MEASURED (solid, "… measured") bar, and cards with no entry in the map get none — which
// is exactly Claude's content-card behavior (no per-card bar).
function UsageMini({ usage, rates, unitMode, currency, tokenRef, tokenMult, scaleMax }: UsageProps) {
  if (!usage) return null
  const total = splitUsage(usage.usage).total
  if (total <= 0) return null
  const unitTotal = usageUnitTotal(usage.usage, rates, unitMode, tokenRef, tokenMult)
  const shown =
    unitMode === 'money' && rates != null
      ? fmtCurrency(unitTotal, currency)
      : unitMode === 'token_units' && rates != null
      ? `${fmtCompact(unitTotal)} ${TOKEN_UNIT_REF_LABELS[tokenRef]}`
      : fmtCompact(total)
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <UsageBar usage={usage.usage} rates={rates} mode={unitMode} currency={currency} tokenRef={tokenRef} compact inlineLabels scaleMax={scaleMax} estimated={usage.estimated} />
      </div>
      <span
        className={`shrink-0 font-mono text-[0.6rem] ${usage.estimated ? 'italic text-neutral-400/80 dark:text-neutral-500/80' : 'text-neutral-500 dark:text-neutral-400'}`}
        title={usage.estimated ? 'Estimated: this card’s share of its turn’s measured usage, weighted by text length' : 'Measured: this turn’s recorded token usage'}
      >
        {usage.estimated ? '≈ ' : ''}{shown}{usage.estimated ? ' est' : ' measured'}
      </span>
    </div>
  )
}

// Edit rows keep their kind tag; tool rows use the action name and purpose directly.
function KindTitle({ kind, name }: { kind: string; name: string }) {
  if (kind === 'tool' && name.toLowerCase() === 'exec') return null
  return (
    <span className="flex items-center gap-1.5">
      {kind !== 'tool' && <Pill>{kind}</Pill>}
      <span className="font-semibold text-neutral-800 dark:text-neutral-100">{name}</span>
    </span>
  )
}

// The most informative one-liner for a tool call: its key argument (the command it ran, the
// file it touched, the pattern it searched) instead of the opaque call id.
function toolSummary(input: Record<string, unknown>, toolName = ''): string {
  const str = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '')
  if (str('command')) return conciseToolPurpose(str('command'))
  const path = str('file_path') || str('path') || str('notebook_path')
  if (path) {
    // File tools (Read/Edit/Write) aren't shell calls, and the row already names the
    // tool — so the useful half is WHICH file, not a re-worded verb. The old
    // action/operation sniff never matched these inputs and labelled every one
    // "Inspect project file".
    const lower = `${toolName} ${str('action')} ${str('operation')}`.toLowerCase()
    const tail = path.replace(/\\/g, '/').split('/').slice(-2).join('/')
    return /write|create|save/.test(lower) ? `wrote ${tail}` : tail
  }
  const pattern = str('pattern')
  if (pattern) return 'Search project text'
  if (str('query')) return 'Search project information'
  if (str('url')) return 'Fetch web resource'
  if (str('todos')) return 'Update task checklist'
  if (str('description') || str('prompt')) return 'Process task request'
  return ''
}

// Keep collapsed rows useful without making a model request for every tool in a session.
// The expanded input still contains the exact command, and the local Qwen toggle can
// explain it in depth when the owner wants that view.
function conciseToolPurpose(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  if (/apply[_ -]?patch|tools\.apply_patch|patch\s*=/.test(lower)) return 'Edit source files'
  if (/pnpm\s+(?:run\s+)?(?:build|typecheck)|npm\s+(?:run\s+)?(?:build|test)|vite\s+build/.test(lower)) return 'Build project bundle'
  if (/\b(?:vitest|jest|pytest|npm\s+test|pnpm\s+test)\b/.test(lower)) return 'Run project tests'
  if (/\bgit\s+status\b/.test(lower)) return 'Check git status'
  if (/\bgit\s+diff\b/.test(lower)) return 'Review code changes'
  if (/\bgit\s+(?:commit|push)\b/.test(lower)) return 'Publish repository changes'
  if (/\bgit\s+log\b/.test(lower)) return 'Review commit history'
  if (/select-string|\brg(?:\.exe)?\b|\bgrep\b|\bfindstr\b/.test(lower)) return 'Search project code'
  if (/get-content|\bcat\b|\btype\s+[^=]|read(file|all|_file)|open\(/.test(lower)) {
    if (/skill\.md|agents?\.md|claude\.md|instructions|roster/.test(lower)) return 'Read project instructions'
    return 'Read project files'
  }
  if (/get-childitem|\bdir\b|\bls(?:\.exe)?\b|readdir|file_glob/.test(lower)) return 'List project files'
  if (/invoke-webrequest|invoke-restmethod|\bcurl\b|\bwget\b|fetch\(/.test(lower)) return 'Check web endpoint'
  if (/start-process|vite\s+preview|localhost:\d+/.test(lower)) return 'Start local server'
  if (/python(?:\.exe)?\s+/.test(lower)) return 'Run Python script'
  if (/remove-item|\brm\s+|delete|unlink/.test(lower)) return 'Remove generated files'
  if (/copy-item|\bcp\s+|copyfile|cpsync/.test(lower)) return 'Copy project files'
  if (/move-item|\bmv\s+|rename-item/.test(lower)) return 'Move project files'
  if (/mkdir|new-item.*directory|createdirectory/.test(lower)) return 'Create project directory'
  return 'Run shell command'
}

function conciseInvocationPurpose(name: string, input: unknown, rawArgs: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('apply_patch')) return 'Edit source files'
  if (lower.includes('update_plan')) return 'Update task plan'
  if (lower.includes('request_user_input')) return 'Ask for clarification'
  if (lower.includes('view_image')) return 'Inspect screenshot'
  if (input && typeof input === 'object' && !Array.isArray(input)) return toolSummary(input as Record<string, unknown>) || conciseToolPurpose(rawArgs)
  return conciseToolPurpose(`${name} ${rawArgs}`)
}

// Codex tools carry arguments as a JSON string; parse then summarise, else show the raw args.
function toolSummaryCodex(argsJson: string): string {
  try {
    const o = JSON.parse(argsJson)
    if (o && typeof o === 'object') return toolSummary(o as Record<string, unknown>)
  } catch {
    // Wrapper-style source is handled below.
  }
  const invocations = parseToolInvocations(argsJson)
  if (invocations.length > 0) {
    const purposes = invocations.map((invocation) => conciseInvocationPurpose(invocation.name, invocation.input, invocation.rawArgs))
    if (purposes.some((purpose) => purpose === 'Edit source files')) return 'Edit source files'
    if (purposes.some((purpose) => purpose === 'Build project bundle')) return 'Build project bundle'
    if (purposes.some((purpose) => purpose === 'Search project code')) return 'Search project code'
    if (purposes.some((purpose) => purpose === 'Read project instructions')) return 'Read project instructions'
    if (purposes.some((purpose) => purpose === 'Read project files')) return 'Read project files'
    return purposes[0] || 'Run shell command'
  }
  return conciseToolPurpose(argsJson)
}

// One-line preview of a message body for the collapsed title (whitespace collapsed).
function preview(text: string | null | undefined): string {
  return text ? text.replace(/\s+/g, ' ').trim() : ''
}

// A small faint chip naming something the harness attached to the message — an IDE
// selection, a system reminder, a slash-command expansion. Keeps attached content
// visible without letting it masquerade as the owner's own sentence.
function AttachedChip({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null
  return (
    <span
      className="shrink-0 rounded-sm bg-neutral-100 px-1 py-px text-[0.55rem] font-normal text-neutral-400 dark:bg-neutral-800/70 dark:text-neutral-500"
      title={`Attached by the tool, not typed by you: ${labels.join(', ')}`}
    >
      +{labels.join(' +')}
    </span>
  )
}

// The collapsed title for a user turn. Shows ONLY what the owner typed; anything the
// harness attached becomes a chip instead of filling the line. When their own words
// are still too long, Qwen shortens them locally — keeping their wording, so the line
// reads as their sentence with words removed, and says so.
function UserPromptTitle({ prompt, fallback }: { prompt: string; fallback: string }) {
  const own = ownPromptText(prompt)
  const labels = injectedLabels(prompt)
  const [summary, setSummary] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setSummary('')
    setFailed(false)
    void shortenUserPrompt(own)
      .then((short) => {
        if (active) setSummary(short)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [own])

  if (summary) {
    return (
      <>
        {summary}{' '}
        <span className="text-[0.6rem] font-normal text-neutral-400 dark:text-neutral-500" title="Your own words, shortened locally by Qwen — expand for the full text">
          (shortened)
        </span>{' '}
        <AttachedChip labels={labels} />
      </>
    )
  }
  if (!failed) {
    return (
      <span className="text-neutral-400 dark:text-neutral-500">
        {preview(own).slice(0, 90)}… <span className="text-[0.6rem]">shortening…</span>
      </span>
    )
  }
  // Qwen unavailable: the owner's own words unshortened still beat the injected wall.
  return (
    <>
      {own ? preview(own) : fallback} <AttachedChip labels={labels} />
    </>
  )
}

// The expanded body of a user turn, rendered as it was actually sent: the owner's own
// words at full weight, each attached block faint and labelled behind a disclosure.
// The visual split is the whole point — the owner must be able to tell, at a glance,
// which words are theirs.
function UserPromptBody({ text }: { text: string }) {
  const segments = splitPrompt(text)
  if (segments.length === 0) return <div className="whitespace-pre-wrap break-words leading-relaxed">{text}</div>
  return (
    <div className="space-y-1.5">
      {segments.map((segment, index) =>
        segment.kind === 'own' ? (
          <div key={index} className="break-words text-neutral-800 dark:text-neutral-100">
            <Markdown text={segment.text} />
          </div>
        ) : (
          <details key={index} className="rounded-md border border-dashed border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-900/40">
            <summary className="cursor-pointer list-none px-2 py-1 text-[0.62rem] text-neutral-400 marker:hidden [&::-webkit-details-marker]:hidden hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">
              {segment.label} — attached, not typed by you ({segment.text.length.toLocaleString()} chars)
            </summary>
            <div className="whitespace-pre-wrap break-words border-t border-neutral-200 px-2 py-1 font-mono text-[0.68rem] leading-relaxed text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              {segment.text}
            </div>
          </details>
        ),
      )}
    </div>
  )
}

// Session-state Claude context blocks (last-prompt / mode / permission-mode / ai-title) —
// low-signal, repetitive, and grouped into one row (see SessionMetaGroup) rather than a
// card each. A readable label per entry.
function metaLabel(item: ClaudeContext | ContextBlock): string {
  const n = item.name
  if ('visibility' in item) {
    if (n === 'session_meta_summary') return 'session meta'
    if (n === 'turn_context') return 'turn context'
    if (n === 'base_instructions') return 'base instructions'
    if (n === 'dynamic_tools') return 'dynamic tools'
  }
  if (n === 'last-prompt') return 'last prompt'
  if (n === 'ai-title') return 'ai title'
  if (n.startsWith('mode/')) return `mode: ${n.slice(5)}`
  if (n.startsWith('permission-mode/')) return `permission: ${n.slice('permission-mode/'.length)}`
  return n
}

export function isSessionMeta(entry: Entry): boolean {
  if (entry.kind !== 'context') return false
  const n = (entry.item as ClaudeContext | ContextBlock).name
  if (entry.source === 'codex') {
    return n === 'session_meta_summary' || n === 'turn_context' || n === 'base_instructions' || n === 'dynamic_tools'
  }
  return n === 'last-prompt' || n === 'ai-title' || n.startsWith('mode/') || n.startsWith('permission-mode/')
}

// A run of consecutive session-state context blocks, collapsed into a single dropdown so
// the repetitive last-prompt / mode / permission / ai-title records stop taking four rows.
export function SessionMetaGroup({ entries }: { entries: Entry[] }) {
  const labels = entries.map((e) => metaLabel(e.item as ClaudeContext | ContextBlock)).join(', ')
  return (
    <details className={`${rowBase} border-l-neutral-300 dark:border-l-neutral-700`}>
      <summary className={summaryClass}>
        <Chevron />
        <span className="shrink-0 font-medium italic text-neutral-500 dark:text-neutral-400">session state</span>
        <span className="min-w-0 flex-1 truncate font-normal italic text-neutral-400 dark:text-neutral-500">
          {entries.length} · {labels}
        </span>
      </summary>
      <div className="space-y-2 px-2 pb-2 pl-7 pt-1">
        {entries.map((e, i) => {
          const item = e.item as ClaudeContext | ContextBlock
          return (
            <div key={i}>
              <div className="mb-0.5 flex items-center gap-2 text-[0.6rem] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                <span>{metaLabel(item)}</span>
                <span className="font-normal normal-case">{item.chars} chars</span>
              </div>
              <MaybeJson text={item.text} className={preClass} />
            </div>
          )
        })}
      </div>
    </details>
  )
}

function EventEntryBody({ entry, usage, rates, unitMode, currency, tokenRef, tokenMult, scaleMax, step, singleModel }: { entry: Entry; step?: StepDuration; singleModel?: boolean } & UsageProps) {
  const tint = tintFor(entry)
  const bar = <UsageMini usage={usage} rates={rates} unitMode={unitMode} currency={currency} tokenRef={tokenRef} tokenMult={tokenMult} scaleMax={scaleMax} />
  // Thin collapsed indicator: the same usage as a ~4px unlabelled bar, shown in the summary.
  const thin =
    usage && splitUsage(usage.usage).total > 0 ? (
      <UsageBar usage={usage.usage} rates={rates} mode={unitMode} currency={currency} tokenRef={tokenRef} tokenMult={tokenMult} scaleMax={scaleMax} estimated={usage.estimated} thin compact showLegend={false} />
    ) : undefined

  switch (entry.kind) {
    case 'message': {
      const item = entry.item as Message | ClaudeMessage
      // Codex and Warp carry a phase (commentary/final); Claude carries the model.
      const tag =
        entry.source === 'claude'
          ? (item as ClaudeMessage).model || undefined
          : (item as Message).phase || undefined
      // Assistant replies: when the session has a single model there's no "assistant" /
      // model to disambiguate, so drop both and just show the reply text (up to 3 lines).
      if (item.role === 'assistant') {
        return (
          <Row
            clamp
            // Always expandable: the body now carries rendered markdown, the summariser
            // and the raw record, so there is something worth opening even for one line.
            // It also drops a height measurement that silently failed inside a collapsed
            // cycle, leaving long replies with no chevron at all.
            expandable={Boolean(item.text?.trim())}
            title={stripMarkdown(preview(item.text)) || '(no text)'}
            badge={!singleModel && tag ? <Pill>{tag}</Pill> : undefined}
            tint={tint}
            step={step}
            bar={bar} thin={thin}
          >
            {/* Replies are written in markdown; shown raw, fenced ASCII diagrams and
                ** ** emphasis are what make a long answer unreadable. */}
            <MessageBody text={item.text || ''} />
          </Row>
        )
      }
      const structuredMessage = item.role === 'user' && looksLikeStructuredContext(item.text)
      // A user turn with attached blocks renders as segments, so the owner's words stay
      // visually separate from what the harness stapled on.
      const segmentedUser = item.role === 'user' && !structuredMessage && hasInjected(item.text || '')
      const messageBody = structuredMessage ? (
        <BaseInstructions text={item.text} />
      ) : segmentedUser ? (
        <UserPromptBody text={item.text || ''} />
      ) : (
        <MessageBody text={item.text || ''} />
      )
      // Even before it overflows, a user title shows the owner's own words rather than
      // whatever injected block happened to come first.
      // No "user:" prefix — the blue left accent already says whose turn this is, and the
      // label pushed the actual prompt right on every single one.
      const userTitle =
        item.role === 'user'
          ? stripMarkdown(preview(ownPromptText(item.text || '')))
          : `${item.role}: ${stripMarkdown(preview(item.text))}`
      return (
        <Row
          clamp
          // Always expandable, for the same reason as an assistant reply — see above.
          expandable={Boolean(item.text?.trim())}
          title={userTitle}
          // Shortening is worth a local model request only once the prompt is long
          // enough that three clamped lines would cut it off anyway.
          overflowTitle={
            item.role === 'user' && ownPromptText(item.text || '').length > 220 ? (
              <UserPromptTitle prompt={item.text} fallback={userTitle} />
            ) : undefined
          }
          badge={tag ? <Pill>{tag}</Pill> : undefined}
          tint={tint}
          step={step}
          bar={bar} thin={thin}
        >
          {messageBody}
        </Row>
      )
    }
    case 'thinking': {
      const item = entry.item as Reasoning | ClaudeThinking
      const signature = (item as ClaudeThinking).signature
      // Codex encrypted reasoning: no plaintext exists → dashed accent, "locked".
      if (entry.source === 'codex' && isLockedReasoning(item.text)) {
        return (
          <Row
            title={null}
            badge={
              <span className="flex shrink-0 items-center gap-1">
                <Lock className="h-3 w-3 text-neutral-400 dark:text-neutral-500" />
              </span>
            }
            tint="border-l-neutral-300 dark:border-l-neutral-700"
            step={step}
            bar={bar} thin={thin}
            dim
            dashed
            disabled
          >
            <div className="flex items-start gap-2 rounded-md border border-dashed border-neutral-300 bg-white/50 p-2 font-mono text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-950/40 dark:text-neutral-400">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-pre-wrap break-words">{item.text}</span>
            </div>
          </Row>
        )
      }
      return (
        <Row
          title={entry.source === 'claude' ? 'thinking' : 'reasoning'}
          expandable={Boolean(item.text?.trim())}
          meta={item.id || undefined}
          badge={signature ? <Pill>signed</Pill> : undefined}
          tint={tint}
          step={step}
          bar={bar} thin={thin}
        >
          <div className="whitespace-pre-wrap break-words leading-relaxed text-neutral-700 dark:text-neutral-300">
            {item.text}
          </div>
        </Row>
      )
    }
    case 'tool': {
      // Claude tools carry a structured result → ToolResult dispatch; Codex tools have a
      // plain arguments/output pair.
      if (entry.source === 'claude') {
        const item = entry.item as ClaudeTool
        return (
          <Row
            title={<KindTitle kind="tool" name={item.name} />}
            meta={toolSummary(item.input, item.name) || undefined}
            badge={
              item.is_error ? (
                <span className="shrink-0 rounded-sm bg-rose-200/80 px-1 py-0.5 text-[0.5rem] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                  error
                </span>
              ) : undefined
            }
            tint={tint}
            step={step}
            bar={bar} thin={thin} hideBar
          >
            <ToolResult tool={item} />
          </Row>
        )
      }
      const item = entry.item as Tool
      return (
        <Row title={<KindTitle kind="tool" name={item.name} />} meta={toolSummaryCodex(item.arguments) || undefined} tint={tint} step={step} bar={bar} thin={thin} hideBar>
          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Input</div>
          <ReadableToolInput toolName={item.name} argumentsText={item.arguments} />
          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Output</div>
          <ReadableToolOutput output={item.output} />
        </Row>
      )
    }
    case 'edit': {
      // Claude edits carry structured_patch → a colored diff; Codex edits have a patch
      // string + a PatchResult (rendered as its own diff fallback + JSON).
      if (entry.source === 'claude') {
        const item = entry.item as ClaudeEdit
        return (
          <Row title={<KindTitle kind="edit" name={item.name} />} meta={item.file_path || undefined} tint={tint} step={step} bar={bar} thin={thin}>
            <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Diff</div>
            <DiffView structured={item.structured_patch} patch={item.patch} />
          </Row>
        )
      }
      const item = entry.item as CodeEdit
      const failed = item.result?.success === false ? 'failed' : undefined
      return (
        <Row title={<KindTitle kind="edit" name={item.name} />} meta={failed} tint={tint} step={step} bar={bar} thin={thin}>
          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Patch</div>
          <DiffView structured={null} patch={stripAnsi(item.patch)} />
          {item.result && (
            <>
              <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Result</div>
              <JsonView value={item.result} />
            </>
          )}
        </Row>
      )
    }
    case 'usage': {
      // Codex: a token_count frame (whole event body). Claude: a measured usage frame
      // (usage_raw body). The bar itself comes from the attribution map via `bar`.
      if (entry.source === 'claude') {
        const item = entry.item as ClaudeUsageFrame
        const parts = splitUsage(item.last)
        const meta = `in ${fmtCompact(parts.freshInput + parts.cachedInput + parts.cacheCreate)} / out ${fmtCompact(parts.output + parts.reasoning)}`
        return (
          <Row title="usage" meta={meta} expandable={Boolean(item.usage_raw)} tint={tint} step={step} bar={bar} thin={thin}>
            <JsonView value={item.usage_raw} />
          </Row>
        )
      }
      const item = entry.item as TokenEvent
      return (
        <Row title="token_count" meta={`last ${item.last?.total_tokens ?? 'n/a'} tokens`} expandable={Boolean(item.last)} tint={tint} step={step} bar={bar} thin={thin}>
          <JsonView value={item} />
        </Row>
      )
    }
    case 'context': {
      // Session context (injected files, environment, AGENTS.md / Claude system payloads).
      // Title is just the payload subtype (e.g. deferred_tools_delta) — no "context /" noise.
      const item = entry.item as ContextBlock | ClaudeContext
      const label =
        entry.source === 'claude'
          ? (item as ClaudeContext).attachment_type || (item as ClaudeContext).subtype || (item as ClaudeContext).name
          : (item as ContextBlock).name
      const meta =
        entry.source === 'claude'
          ? `${item.chars} chars`
          : `${(item as ContextBlock).source} / ${item.chars} chars`
      return (
        <Row title={label} meta={meta} expandable={Boolean(item.text?.trim())} tint={tint} step={step} bar={bar} thin={thin} dim>
          {isStructuredInstructionPayload((item as ContextBlock | ClaudeContext).name, item.text) ? (
            <BaseInstructions text={item.text} />
          ) : (
            <MaybeJson text={item.text} className={preClass} />
          )}
        </Row>
      )
    }
    case 'runtime': {
      const item = entry.item as RuntimeEvent
      return (
        <Row title={`runtime / ${item.type}`} expandable={Boolean(item.text?.trim())} tint={tint} step={step} bar={bar} thin={thin}>
          <MaybeJson text={item.text} className={preClass} />
        </Row>
      )
    }
    case 'subagent': {
      const item = entry.item as ClaudeSubagent
      const messages = item.session?.messages || []
      return (
        <Row title={`agent / ${item.agent_type}`} meta={item.description || undefined} expandable={messages.length > 0} tint={tint} step={step} bar={bar} thin={thin}>
          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">
            {messages.length} message{messages.length === 1 ? '' : 's'}
          </div>
          <ul className="space-y-1">
            {messages.map((m, mi) => (
              <li key={mi} className="flex items-start gap-2 text-xs">
                <span
                  className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide ${
                    m.role === 'user'
                      ? 'bg-sky-200/70 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
                      : 'bg-emerald-200/70 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  }`}
                >
                  {m.role}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-400">
                  {m.text?.replace(/\s+/g, ' ').trim() || '(empty)'}
                </span>
              </li>
            ))}
          </ul>
        </Row>
      )
    }
  }
}

// Publishes this step's underlying record so any Row inside it can offer the Raw JSON
// switch. One provider per step keeps the switch showing THIS step's data.
export default function EventEntry(props: { entry: Entry; step?: StepDuration; singleModel?: boolean } & UsageProps) {
  return (
    <RawItemContext.Provider value={props.entry.raw ?? props.entry.item}>
      <EventEntryBody {...props} />
    </RawItemContext.Provider>
  )
}
