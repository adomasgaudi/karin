import type { ReactNode } from 'react'
import { Lock, ChevronRight } from 'lucide-react'
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
import DiffView from './DiffView'

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
      return 'border-l-amber-400'
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
const bodyClass = 'space-y-2 px-2 pb-2 pl-7 pt-1 text-sm'
const preClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-300'

// Codex records some reasoning only as encrypted content — Karin can't show plaintext.
// The indexer emits this exact marker (see karin.py text_from_reasoning).
function isLockedReasoning(text: string | null | undefined): boolean {
  return !!text && text.startsWith('Encrypted reasoning content recorded by Codex')
}

// Inline disclosure chevron — rotates when its <details> ancestor is open. Replaces the
// native marker (killed via list-none / marker:hidden) so it sits on the title line.
function Chevron() {
  return (
    <ChevronRight className="h-3 w-3 shrink-0 text-neutral-400 transition-transform [[open]_&]:rotate-90 dark:text-neutral-500" />
  )
}

function NumBadge({ n }: { n: number }) {
  return (
    <span className="shrink-0 rounded-sm bg-neutral-200/70 px-1 font-mono text-[0.55rem] leading-tight text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      {n}
    </span>
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
// inline flex line (chevron · number · title · badge · meta · duration); the body only
// exists once expanded and carries the optional usage bar plus the kind-specific content.
function Row({
  num,
  title,
  meta,
  badge,
  tint,
  step,
  bar,
  thin,
  clamp,
  dim,
  dashed,
  children,
}: {
  num: number
  title: ReactNode
  meta?: ReactNode
  badge?: ReactNode
  tint: string
  step?: StepDuration
  bar?: ReactNode
  // A thin (~4px) always-visible usage bar in the collapsed summary; the full labelled bar
  // lives in the body (expanded). Lets a step show its token weight without a header row.
  thin?: ReactNode
  // Render `title` as the row's body text, wrapping up to 3 lines (no separate label/meta) —
  // used for assistant replies, which show their own text instead of an "assistant:" label.
  clamp?: boolean
  dim?: boolean
  dashed?: boolean
  children: ReactNode
}) {
  return (
    <details className={`${rowBase} ${tint} ${dashed ? 'border-l-dashed' : ''} ${dim ? 'opacity-70' : ''}`}>
      <summary className="flex cursor-pointer select-none list-none flex-col gap-px px-2 py-1 text-xs marker:hidden [&::-webkit-details-marker]:hidden hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
        <div className={`flex gap-1.5 ${clamp ? 'items-start' : 'items-center'}`}>
          <Chevron />
          <NumBadge n={num} />
          {clamp ? (
            <span className="min-w-0 flex-1 line-clamp-3 font-normal leading-snug text-neutral-700 dark:text-neutral-200">{title}</span>
          ) : (
            <>
              <span className="shrink-0 font-medium text-neutral-800 dark:text-neutral-100">{title}</span>
              {badge}
              {meta != null && meta !== '' && (
                <span className="min-w-0 flex-1 truncate font-normal text-neutral-500 dark:text-neutral-400">{meta}</span>
              )}
            </>
          )}
          {clamp && badge}
          <StepDur step={step} />
        </div>
        {/* Thin token bar hugs the title from below — full width, ~4px, ~0 gap, so it adds
            almost no vertical space. The full labelled bar lives in the expanded body. */}
        {thin && <div className="pl-6">{thin}</div>}
      </summary>
      <div className={bodyClass}>
        {bar}
        {children}
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

// A kind tag ("tool" / "edit") + the action name — replaces the old "tool / Name" title.
function KindTitle({ kind, name }: { kind: string; name: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Pill>{kind}</Pill>
      <span className="font-semibold text-neutral-800 dark:text-neutral-100">{name}</span>
    </span>
  )
}

// The most informative one-liner for a tool call: its key argument (the command it ran, the
// file it touched, the pattern it searched) instead of the opaque call id.
function toolSummary(input: Record<string, unknown>): string {
  const str = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const clean = (v: string) => v.replace(/\s+/g, ' ').trim()
  if (str('command')) return clean(str('command'))
  const path = str('file_path') || str('path') || str('notebook_path')
  if (path) return path.split(/[/\\]/).slice(-2).join('/')
  const pattern = str('pattern')
  if (pattern) {
    const where = str('path') || str('glob')
    return clean(where ? `${pattern}  ·  ${where}` : pattern)
  }
  for (const k of ['query', 'url', 'description', 'prompt', 'todos']) if (str(k)) return clean(str(k))
  for (const v of Object.values(input)) if (typeof v === 'string' && v.trim()) return clean(v)
  return ''
}

// Codex tools carry arguments as a JSON string; parse then summarise, else show the raw args.
function toolSummaryCodex(argsJson: string): string {
  try {
    const o = JSON.parse(argsJson)
    if (o && typeof o === 'object') return toolSummary(o as Record<string, unknown>)
  } catch {
    // not JSON — fall through
  }
  return argsJson.replace(/\s+/g, ' ').trim()
}

// One-line preview of a message body for the collapsed title (whitespace collapsed).
function preview(text: string | null | undefined): string {
  return text ? text.replace(/\s+/g, ' ').trim() : ''
}

// Session-state Claude context blocks (last-prompt / mode / permission-mode / ai-title) —
// low-signal, repetitive, and grouped into one row (see SessionMetaGroup) rather than a
// card each. A readable label per entry.
function metaLabel(item: ClaudeContext): string {
  const n = item.name
  if (n === 'last-prompt') return 'last prompt'
  if (n === 'ai-title') return 'ai title'
  if (n.startsWith('mode/')) return `mode: ${n.slice(5)}`
  if (n.startsWith('permission-mode/')) return `permission: ${n.slice('permission-mode/'.length)}`
  return n
}

export function isSessionMeta(entry: Entry): boolean {
  if (entry.kind !== 'context' || entry.source !== 'claude') return false
  const n = (entry.item as ClaudeContext).name
  return n === 'last-prompt' || n === 'ai-title' || n.startsWith('mode/') || n.startsWith('permission-mode/')
}

// A run of consecutive session-state context blocks, collapsed into a single dropdown so
// the repetitive last-prompt / mode / permission / ai-title records stop taking four rows.
export function SessionMetaGroup({ entries, num }: { entries: Entry[]; num: number }) {
  const labels = entries.map((e) => metaLabel(e.item as ClaudeContext)).join(', ')
  return (
    <details className={`${rowBase} border-l-neutral-300 opacity-70 dark:border-l-neutral-700`}>
      <summary className={summaryClass}>
        <Chevron />
        <NumBadge n={num} />
        <span className="shrink-0 font-medium italic text-neutral-500 dark:text-neutral-400">session state</span>
        <span className="min-w-0 flex-1 truncate font-normal italic text-neutral-400 dark:text-neutral-500">
          {entries.length} · {labels}
        </span>
      </summary>
      <div className="space-y-2 px-2 pb-2 pl-7 pt-1">
        {entries.map((e, i) => {
          const item = e.item as ClaudeContext
          return (
            <div key={i}>
              <div className="mb-0.5 flex items-center gap-2 text-[0.6rem] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                <span>{metaLabel(item)}</span>
                <span className="font-normal normal-case">{item.chars} chars</span>
              </div>
              <pre className={preClass}>{item.text}</pre>
            </div>
          )
        })}
      </div>
    </details>
  )
}

export default function EventEntry({ entry, num, usage, rates, unitMode, currency, tokenRef, tokenMult, scaleMax, step, singleModel }: { entry: Entry; num: number; step?: StepDuration; singleModel?: boolean } & UsageProps) {
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
            num={num}
            clamp
            title={preview(item.text) || '(no text)'}
            badge={!singleModel && tag ? <Pill>{tag}</Pill> : undefined}
            tint={tint}
            step={step}
            bar={bar} thin={thin}
          >
            <div className="whitespace-pre-wrap break-words leading-relaxed">{item.text}</div>
          </Row>
        )
      }
      return (
        <Row
          num={num}
          title={`${item.role}:`}
          meta={preview(item.text)}
          badge={tag ? <Pill>{tag}</Pill> : undefined}
          tint={tint}
          step={step}
          bar={bar} thin={thin}
        >
          <div className="whitespace-pre-wrap break-words leading-relaxed">{item.text}</div>
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
            num={num}
            title="reasoning"
            meta={item.id || undefined}
            badge={
              <span className="flex shrink-0 items-center gap-1">
                <Lock className="h-3 w-3 text-neutral-400 dark:text-neutral-500" />
                <Pill>locked</Pill>
              </span>
            }
            tint="border-l-neutral-300 dark:border-l-neutral-700"
            step={step}
            bar={bar} thin={thin}
            dim
            dashed
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
          num={num}
          title={entry.source === 'claude' ? 'thinking' : 'reasoning'}
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
            num={num}
            title={<KindTitle kind="tool" name={item.name} />}
            meta={toolSummary(item.input) || undefined}
            badge={
              item.is_error ? (
                <span className="shrink-0 rounded-sm bg-rose-200/80 px-1 py-0.5 text-[0.5rem] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                  error
                </span>
              ) : undefined
            }
            tint={tint}
            step={step}
            bar={bar} thin={thin}
          >
            <ToolResult tool={item} />
          </Row>
        )
      }
      const item = entry.item as Tool
      return (
        <Row num={num} title={<KindTitle kind="tool" name={item.name} />} meta={toolSummaryCodex(item.arguments) || undefined} tint={tint} step={step} bar={bar} thin={thin}>
          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Input</div>
          <pre className={preClass}>{item.arguments}</pre>
          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Output</div>
          <pre className={preClass}>{item.output ?? ''}</pre>
        </Row>
      )
    }
    case 'edit': {
      // Claude edits carry structured_patch → a colored diff; Codex edits have a patch
      // string + a PatchResult (rendered as its own diff fallback + JSON).
      if (entry.source === 'claude') {
        const item = entry.item as ClaudeEdit
        return (
          <Row num={num} title={<KindTitle kind="edit" name={item.name} />} meta={item.file_path || undefined} tint={tint} step={step} bar={bar} thin={thin}>
            <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Diff</div>
            <DiffView structured={item.structured_patch} patch={item.patch} />
          </Row>
        )
      }
      const item = entry.item as CodeEdit
      const failed = item.result?.success === false ? 'failed' : undefined
      return (
        <Row num={num} title={<KindTitle kind="edit" name={item.name} />} meta={failed} tint={tint} step={step} bar={bar} thin={thin}>
          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Patch</div>
          <pre className={preClass}>{item.patch}</pre>
          {item.result && (
            <>
              <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Result</div>
              <pre className={preClass}>{JSON.stringify(item.result, null, 2)}</pre>
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
          <Row num={num} title="usage" meta={meta} tint={tint} step={step} bar={bar} thin={thin}>
            <pre className={preClass}>{JSON.stringify(item.usage_raw, null, 2)}</pre>
          </Row>
        )
      }
      const item = entry.item as TokenEvent
      return (
        <Row num={num} title="token_count" meta={`last ${item.last?.total_tokens ?? 'n/a'} tokens`} tint={tint} step={step} bar={bar} thin={thin}>
          <pre className={preClass}>{JSON.stringify(item, null, 2)}</pre>
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
        <Row num={num} title={label} meta={meta} tint={tint} step={step} bar={bar} thin={thin} dim>
          <pre className={preClass}>{item.text}</pre>
        </Row>
      )
    }
    case 'runtime': {
      const item = entry.item as RuntimeEvent
      return (
        <Row num={num} title={`runtime / ${item.type}`} tint={tint} step={step} bar={bar} thin={thin}>
          <pre className={preClass}>{item.text}</pre>
        </Row>
      )
    }
    case 'subagent': {
      const item = entry.item as ClaudeSubagent
      const messages = item.session?.messages || []
      return (
        <Row num={num} title={`agent / ${item.agent_type}`} meta={item.description || undefined} tint={tint} step={step} bar={bar} thin={thin}>
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
