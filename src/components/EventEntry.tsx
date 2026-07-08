import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
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
import { splitUsage, usageUnitTotal, type CurrencyMode, type TokenRates, type UsageUnitMode } from '../lib/pricing'
import UsageBar from './UsageBar'
import ToolResult from './ToolResult'
import DiffView from './DiffView'

interface UsageProps {
  usage?: EntryUsage
  rates: TokenRates | null
  unitMode: UsageUnitMode
  currency: CurrencyMode
  // Cycle total in the active unit, so each card's bar is its true fraction of the cycle.
  scaleMax?: number
}

// One tint per unified kind. Message tints split by role (Claude roles are only
// user/assistant; Codex may also carry 'system' → the neutral fallback).
function tintFor(entry: Entry): string {
  switch (entry.kind) {
    case 'message': {
      const role = (entry.item as Message | ClaudeMessage).role
      if (role === 'user') return 'border-l-2 border-sky-400 bg-sky-50/70 dark:bg-sky-950/25'
      if (role === 'assistant') return 'border-l-2 border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/25'
      return 'border-l-2 border-neutral-300 bg-neutral-50 dark:bg-neutral-900'
    }
    case 'thinking':
      return 'border-l-2 border-slate-400 bg-slate-50 dark:bg-slate-900/40'
    case 'tool':
      return 'border-l-2 border-amber-400 bg-amber-50/70 dark:bg-amber-950/25'
    case 'edit':
      return 'border-l-2 border-rose-400 bg-rose-50/70 dark:bg-rose-950/25'
    case 'usage':
      return 'border-l-2 border-blue-400 bg-blue-50/70 dark:bg-blue-950/25'
    case 'context':
      return 'border-l-2 border-neutral-300 bg-neutral-50/50 dark:border-neutral-700 dark:bg-neutral-900/40'
    case 'runtime':
      return 'border-l-2 border-zinc-400 bg-zinc-50 dark:bg-zinc-900'
    case 'subagent':
      return 'border-l-2 border-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/25'
  }
}

const cardBase = 'mb-1.5 overflow-hidden rounded-md border border-neutral-200/80 dark:border-neutral-800/80'
const summaryClass =
  'cursor-pointer select-none px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden hover:bg-white/55 dark:hover:bg-white/[0.03]'
const bodyClass = 'px-3 pb-3'
const preClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-300'

// Codex records some reasoning only as encrypted content — Karin can't show plaintext.
// The indexer emits this exact marker (see karin.py text_from_reasoning).
function isLockedReasoning(text: string | null | undefined): boolean {
  return !!text && text.startsWith('Encrypted reasoning content recorded by Codex')
}

function NumBadge({ n }: { n: number }) {
  return (
    <span className="shrink-0 rounded-sm bg-neutral-200/80 px-1.5 py-0.5 font-mono text-[0.6rem] leading-none text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      {n}
    </span>
  )
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm bg-neutral-200/80 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
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
        className="ml-auto shrink-0 whitespace-nowrap text-[0.6rem] font-normal italic text-violet-500 dark:text-violet-400"
        title="Time you spent answering — not counted as AI work"
      >
        waiting on you · {fmtDuration(step.ms)}
      </span>
    )
  }
  return (
    <span
      className="ml-auto shrink-0 whitespace-nowrap font-mono text-[0.6rem] font-normal text-neutral-400 dark:text-neutral-500"
      title="How long this step ran (until the next event)"
    >
      {fmtDuration(step.ms)}
    </span>
  )
}

function SummaryLine({
  num,
  title,
  meta,
  badge,
  footer,
  step,
}: {
  num: number
  title: string
  meta?: string
  badge?: ReactNode
  footer?: ReactNode
  step?: StepDuration
}) {
  return (
    <summary className={summaryClass}>
      <div className="flex items-center gap-2">
        <NumBadge n={num} />
        <span className="text-neutral-800 dark:text-neutral-100">{title}</span>
        {badge}
        {meta && <span className="min-w-0 truncate font-normal text-neutral-500 dark:text-neutral-400">{meta}</span>}
        <StepDur step={step} />
      </div>
      {footer}
    </summary>
  )
}

// Per-card token bar. Drives BOTH sources off the attribution map: Codex content cards get
// an ESTIMATED (hatched, "≈ … est") bar, Codex token frames + every Claude usage frame get
// a MEASURED (solid, "… measured") bar, and cards with no entry in the map get none — which
// is exactly Claude's content-card behavior (no per-card bar).
function UsageMini({ usage, rates, unitMode, currency, scaleMax }: UsageProps) {
  if (!usage) return null
  const total = splitUsage(usage.usage).total
  if (total <= 0) return null
  const priced = unitMode === 'token_units' && rates != null
  const shown = priced ? fmtCurrency(usageUnitTotal(usage.usage, rates, unitMode), currency) : fmtCompact(total)
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <UsageBar usage={usage.usage} rates={rates} mode={unitMode} currency={currency} compact inlineLabels scaleMax={scaleMax} estimated={usage.estimated} />
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

export default function EventEntry({ entry, num, usage, rates, unitMode, currency, scaleMax, step }: { entry: Entry; num: number; step?: StepDuration } & UsageProps) {
  const card = `${cardBase} ${tintFor(entry)}`
  const bar = <UsageMini usage={usage} rates={rates} unitMode={unitMode} currency={currency} scaleMax={scaleMax} />

  switch (entry.kind) {
    case 'message': {
      const item = entry.item as Message | ClaudeMessage
      // Codex carries a phase (commentary/final); Claude carries the model.
      const meta = entry.source === 'codex' ? (item as Message).phase || undefined : (item as ClaudeMessage).model || undefined
      return (
        <details className={card}>
          <SummaryLine num={num} title={item.role} meta={meta} footer={bar} step={step} />
          <div className={bodyClass}>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.text}</div>
          </div>
        </details>
      )
    }
    case 'thinking': {
      const item = entry.item as Reasoning | ClaudeThinking
      const signature = (item as ClaudeThinking).signature
      // Codex encrypted reasoning: no plaintext exists → dashed, grayed, "locked".
      if (entry.source === 'codex' && isLockedReasoning(item.text)) {
        return (
          <details className="mb-1.5 overflow-hidden rounded-md border border-dashed border-neutral-300 bg-neutral-50/70 dark:border-neutral-700 dark:bg-neutral-900/40">
            <summary className={summaryClass}>
              <div className="flex items-center gap-2">
                <NumBadge n={num} />
                <Lock className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
                <span className="text-neutral-500 dark:text-neutral-400">reasoning</span>
                <Pill>locked</Pill>
                {item.id && <span className="min-w-0 truncate font-normal text-neutral-400 dark:text-neutral-500">{item.id}</span>}
                <StepDur step={step} />
              </div>
              {bar}
            </summary>
            <div className={bodyClass}>
              <div className="flex items-start gap-2 rounded-md border border-dashed border-neutral-300 bg-white/50 p-2 font-mono text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-950/40 dark:text-neutral-400">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-pre-wrap break-words">{item.text}</span>
              </div>
            </div>
          </details>
        )
      }
      return (
        <details className={card}>
          <SummaryLine
            num={num}
            title={entry.source === 'claude' ? 'thinking' : 'reasoning'}
            meta={item.id || undefined}
            badge={signature ? <Pill>signed</Pill> : undefined}
            footer={bar}
            step={step}
          />
          <div className={bodyClass}>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
              {item.text}
            </div>
          </div>
        </details>
      )
    }
    case 'tool': {
      // Claude tools carry a structured result → ToolResult dispatch; Codex tools have a
      // plain arguments/output pair.
      if (entry.source === 'claude') {
        const item = entry.item as ClaudeTool
        return (
          <details className={card}>
            <SummaryLine
              num={num}
              title={`tool / ${item.name}`}
              meta={item.call_id || undefined}
              badge={
                item.is_error ? (
                  <span className="rounded-sm bg-rose-200/80 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                    error
                  </span>
                ) : undefined
              }
              footer={bar}
              step={step}
            />
            <div className={`${bodyClass} space-y-2`}>
              <ToolResult tool={item} />
            </div>
          </details>
        )
      }
      const item = entry.item as Tool
      return (
        <details className={card}>
          <SummaryLine num={num} title={`tool / ${item.name}`} meta={item.call_id || undefined} footer={bar} step={step} />
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
      // Claude edits carry structured_patch → a colored diff; Codex edits have a patch
      // string + a PatchResult (rendered as its own diff fallback + JSON).
      if (entry.source === 'claude') {
        const item = entry.item as ClaudeEdit
        return (
          <details className={card}>
            <SummaryLine num={num} title={`edit / ${item.name}`} meta={item.file_path || undefined} footer={bar} step={step} />
            <div className={`${bodyClass} space-y-2`}>
              <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Diff</div>
              <DiffView structured={item.structured_patch} patch={item.patch} />
            </div>
          </details>
        )
      }
      const item = entry.item as CodeEdit
      const failed = item.result?.success === false ? 'failed' : undefined
      return (
        <details className={card}>
          <SummaryLine num={num} title={`edit / ${item.name}`} meta={failed} footer={bar} step={step} />
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
    case 'usage': {
      // Codex: a token_count frame (whole event body). Claude: a measured usage frame
      // (usage_raw body). The bar itself comes from the attribution map via `bar`.
      if (entry.source === 'claude') {
        const item = entry.item as ClaudeUsageFrame
        const parts = splitUsage(item.last)
        const meta = `in ${fmtCompact(parts.freshInput + parts.cachedInput + parts.cacheCreate)} / out ${fmtCompact(parts.output + parts.reasoning)}`
        return (
          <details className={card}>
            <SummaryLine num={num} title="usage" meta={meta} footer={bar} step={step} />
            <div className={bodyClass}>
              <pre className={preClass}>{JSON.stringify(item.usage_raw, null, 2)}</pre>
            </div>
          </details>
        )
      }
      const item = entry.item as TokenEvent
      return (
        <details className={card}>
          <SummaryLine num={num} title="token_count" meta={`last ${item.last?.total_tokens ?? 'n/a'} tokens`} footer={bar} step={step} />
          <div className={bodyClass}>
            <pre className={preClass}>{JSON.stringify(item, null, 2)}</pre>
          </div>
        </details>
      )
    }
    case 'context': {
      // Session context (injected files, environment, AGENTS.md / Claude system payloads) —
      // not part of the prompt/answer flow, so it recedes: indented, smaller, italic, gray.
      const item = entry.item as ContextBlock | ClaudeContext
      const detail =
        entry.source === 'claude'
          ? [(item as ClaudeContext).subtype || (item as ClaudeContext).attachment_type, `${item.chars} chars`].filter(Boolean).join(' / ')
          : `${(item as ContextBlock).source} / ${item.chars} chars`
      return (
        <details className={`${card} ml-5 opacity-70`}>
          <summary className="cursor-pointer select-none px-3 py-1.5 text-[0.68rem] font-normal italic text-neutral-400 [&::-webkit-details-marker]:hidden hover:bg-white/40 dark:text-neutral-500 dark:hover:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <NumBadge n={num} />
              <span>context / {item.name}</span>
              <span className="min-w-0 truncate">{detail}</span>
              <StepDur step={step} />
            </div>
            {bar}
          </summary>
          <div className={bodyClass}>
            <pre className={preClass}>{item.text}</pre>
          </div>
        </details>
      )
    }
    case 'runtime': {
      const item = entry.item as RuntimeEvent
      return (
        <details className={card}>
          <SummaryLine num={num} title={`runtime / ${item.type}`} footer={bar} step={step} />
          <div className={bodyClass}>
            <pre className={preClass}>{item.text}</pre>
          </div>
        </details>
      )
    }
    case 'subagent': {
      const item = entry.item as ClaudeSubagent
      const messages = item.session?.messages || []
      return (
        <details className={card}>
          <SummaryLine num={num} title={`agent / ${item.agent_type}`} meta={item.description || undefined} footer={bar} step={step} />
          <div className={`${bodyClass} space-y-1.5`}>
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
          </div>
        </details>
      )
    }
  }
}
