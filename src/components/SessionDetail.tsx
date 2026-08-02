import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpLeft, Braces, ChevronsDown, ChevronsUp, Info, ListTree, MoreVertical, PanelTopOpen, Rows3 } from 'lucide-react'
import type { FeedRecord, Session, TokenUsage } from '../types'
import type { ClaudeDetailSession } from '../lib/claudeModel'
import type { ClaudeSession } from '../lib/claudeRaw'
import { useKarin } from '../store/karin'
import { buildCycles, cycleModelEffort } from '../lib/unifiedCycles'
import { fmtClockTime, fmtNum, lastRecordTime, shortAge } from '../lib/format'
import {
  BLOCK_SCALE_LABELS,
  CURRENCY_LABELS,
  PRICE_BASIS_LABELS,
  TOKEN_UNIT_REF_LABELS,
  UNIT_MODE_LABELS,
  blockScales,
  currencyModes,
  effectiveRates,
  priceBasisModes,
  ratesForClaudeModel,
  ratesForUnified,
  stepTokenMult,
  tokenUnitRefs,
  unitModes,
} from '../lib/pricing'
import PriceModelPanel from './PriceModelPanel'
import AgeIndicator, { useLiveNow } from './AgeIndicator'
import Cycle from './Cycle'
import ContextAudit from './ContextAudit'
import LocalSummary from './LocalSummary'
import UsageBar from './UsageBar'
import SourceBadge from './SourceBadge'
import RecordRow from './RecordRow'
import { WorkspaceRootContext } from './JsonView'

// structured = the rendered cycles · raw = per-record rows, opened on the readable tree ·
// json = the same rows opened on the faithful stored shape, plus JSONL copy/download.
type DetailMode = 'structured' | 'raw' | 'json'
const DETAIL_MODES: DetailMode[] = ['structured', 'raw', 'json']
// One button cycles the three views, so the header carries an icon instead of a
// three-wide segmented control.
const DETAIL_MODE_META: Record<DetailMode, { label: string; Icon: typeof Braces }> = {
  structured: { label: 'Structured', Icon: ListTree },
  raw: { label: 'Raw', Icon: Rows3 },
  json: { label: 'JSON', Icon: Braces },
}

// The header's live clock, isolated so its one-second tick re-renders this span alone
// instead of the entire session body (see the `now` comment in SessionDetail).
function LiveClock() {
  const now = useLiveNow(1000)
  return (
    <span className="text-neutral-400 dark:text-neutral-500" title="Current time">
      {fmtClockTime(now)}
    </span>
  )
}

const selectClass =
  'h-8 min-w-0 max-w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 text-xs text-neutral-800 outline-none focus:border-neutral-400 focus:bg-white dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:focus:border-neutral-600 dark:focus:bg-neutral-950'

// The feed's records, exactly as stored — `_line` / `_type` decorations kept, keys in
// their source spelling, nothing renamed or unwrapped. What changed is only the
// PRESENTATION: instead of a wall of `JSON.stringify` lines, each record is a row that
// opens into RawJson's collapsible key→value tree (the same one behind the Raw tab's
// "Raw JSON" toggle). The exact bytes are still one click away per record, and the whole
// dump still copies and downloads as real JSONL.
//
// Rows render their tree only when opened, so a big session costs a list of headers
// rather than every record's text. The JSONL string is likewise built only when Copy or
// Download is pressed — serialising a 40 MB transcript just to print a char count was
// work done on the chance you might want it.
function JsonDump({ records, uid, now }: { records: FeedRecord[]; uid: string; now: Date }) {
  const buildText = () => records.map((rec) => JSON.stringify(rec)).join('\n')
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([buildText()], { type: 'application/x-ndjson' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${uid}.jsonl`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[0.68rem] text-neutral-400 dark:text-neutral-500">
          {records.length} {records.length === 1 ? 'record' : 'records'} · exactly as stored in the feed
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="ml-auto shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {copied ? 'copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={download}
          className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Download .jsonl
        </button>
      </div>
      {records.length === 0 ? (
        <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No records match this filter.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {records.map((rec) => (
            <RecordRow key={`${rec._line}-${String(rec.uuid ?? '')}`} record={rec} now={now} defaultRaw />
          ))}
        </div>
      )}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-xs">
      <span className="text-neutral-400 dark:text-neutral-500">{label}</span>
      <span className="min-w-0 break-words text-neutral-700 dark:text-neutral-300">{value || 'n/a'}</span>
    </div>
  )
}

// Auto terminal-tab-label sessions (Claude only), shown inside the detail — collapsed by
// default; each expands to its raw records so throwaway namer calls stay inspectable.
function TitleOpsPanel({ ops, now }: { ops: ClaudeSession[] | undefined; now: Date }) {
  if (!ops || ops.length === 0) return null
  return (
    <details className="mb-2 rounded-md border border-amber-200/70 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300">
        {ops.length} auto-title label {ops.length === 1 ? 'session' : 'sessions'}
        <span className="ml-1 font-normal text-amber-700/70 dark:text-amber-400/60">
          — Claude Code's terminal-tab namer, not real work. Click to inspect.
        </span>
      </summary>
      <div className="flex flex-col gap-1 border-t border-amber-200/60 p-2 dark:border-amber-900/30">
        {ops.map((op) => (
          <details key={op.id} className="rounded border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/40">
            <summary className="flex cursor-pointer select-none flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1 text-[0.7rem] text-neutral-600 dark:text-neutral-300">
              <span className="font-mono text-neutral-400 dark:text-neutral-500">{op.id.slice(0, 8)}</span>
              <span>label: “{op.title}”</span>
              <span className="text-neutral-400 dark:text-neutral-500">
                {fmtNum(op.usage_totals?.total_tokens ?? 0)} tok · {op.record_count} records · {shortAge(op.started_at, now)} ago
              </span>
            </summary>
            <div className="flex flex-col gap-1 border-t border-neutral-200 p-2 dark:border-neutral-800">
              {op.records.map((rec) => (
                <RecordRow key={`${rec._line}-${String(rec.uuid ?? '')}`} record={rec} now={now} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

export default function SessionDetail() {
  const sessions = useKarin((st) => st.sessions)
  const selectedUid = useKarin((st) => st.selectedUid)
  // 15s, not 1s. This `now` is threaded into every cycle and event for ages and durations,
  // so each tick re-renders the WHOLE detail body — at one second that was a full re-render
  // of thousands of nodes every second, and it made every click feel a beat late. Nothing
  // here needs sub-minute resolution ("4m ago"); the one thing that does, the header clock,
  // runs its own 1s timer in LiveClock below.
  const now = useLiveNow(15_000)
  const bodyRef = useRef<HTMLDivElement>(null)
  // The scrolling element itself — the pinned title scrolls it back to the top on click.
  const scrollRef = useRef<HTMLDivElement>(null)
  // Shared global toggle (see the sidebar) so switching units re-expresses every
  // token display across both panes at once.
  const unitMode = useKarin((st) => st.unitMode)
  const setUnitMode = useKarin((st) => st.setUnitMode)
  const tokenRef = useKarin((st) => st.tokenRef)
  const setTokenRef = useKarin((st) => st.setTokenRef)
  const tokenMult = useKarin((st) => st.tokenMult)
  const setTokenMult = useKarin((st) => st.setTokenMult)
  const currency = useKarin((st) => st.currency)
  const setCurrency = useKarin((st) => st.setCurrency)
  const blockScale = useKarin((st) => st.blockScale)
  const setBlockScale = useKarin((st) => st.setBlockScale)
  const priceBasis = useKarin((st) => st.priceBasis)
  const setPriceBasis = useKarin((st) => st.setPriceBasis)
  const subDivisors = useKarin((st) => st.subDivisors)
  const setSubDivisor = useKarin((st) => st.setSubDivisor)
  const [metaOpen, setMetaOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [priceInfoOpen, setPriceInfoOpen] = useState(false)
  const [rawModeByUid, setRawModeByUid] = useState<Record<string, DetailMode>>({})
  const [typeFilter, setTypeFilter] = useState('all')

  const s = sessions.find((x) => x.uid === selectedUid)
  const parentSession = s?.parentId
    ? sessions.find((candidate) =>
        candidate.source === s.source &&
        !candidate.isSubagent &&
        (candidate.id === s.parentId || candidate.logicalId === s.parentId),
      )
    : null
  const cycles = useMemo(() => (s ? buildCycles(s) : []), [s])
  // apiRates = published API list rates (shown verbatim in the pricing panel for tracing);
  // rates = those rates after the active price basis (÷divisor for the plan estimate), used
  // for every bar/label so money figures reflect the chosen basis.
  const apiRates = s ? ratesForUnified(s) : null
  // Plan-estimate divisor is per source — this session's own plan.
  const subDivisor = s ? subDivisors[s.source] : 20
  const rates = effectiveRates(apiRates, priceBasis, subDivisor)
  const u: TokenUsage = s?.latest_total_usage || {}
  const turnContexts = s
    ? s.source === 'claude'
      ? (s.raw as ClaudeDetailSession).turn_contexts
      : (s.raw as Session).turn_contexts
    : undefined
  // A mid-session model switch changes what every later token COSTS, so each cycle must
  // price with ITS OWN model's rates, not the session-level model — with one shared rate
  // table, money mode couldn't re-weigh a fable cycle against a sonnet one (all Claude
  // rate tables are proportional, so only the per-cycle absolute rate distinguishes them).
  const cycleInfos = cycles.map((cycle) => {
    const { model, effort } = cycleModelEffort(cycle, turnContexts)
    const own = s?.source === 'claude' ? ratesForClaudeModel(model) : null
    return { cycle, model, effort, rates: effectiveRates(own ?? apiRates, priceBasis, subDivisor) }
  })

  // Reset the raw-mode type filter whenever the selected session changes.
  useEffect(() => {
    setTypeFilter('all')
  }, [selectedUid])

  if (!s) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a session to view its prompts, tools, and token usage.
      </div>
    )
  }

  const isClaude = s.source === 'claude'
  // The Raw tab belongs to every source that ships decorated feed records. Codex and
  // Claude keep JSONL lines; Warp keeps decoded protobuf events. The controls stay here,
  // in the one shared detail page, rather than splitting into source-specific pages.
  const hasRaw = Array.isArray(s.rawRecords)
  const mode: DetailMode = hasRaw ? rawModeByUid[s.uid] || 'structured' : 'structured'
  const nextMode = DETAIL_MODES[(DETAIL_MODES.indexOf(mode) + 1) % DETAIL_MODES.length]
  const ModeIcon = DETAIL_MODE_META[mode].Icon
  const records: FeedRecord[] = hasRaw ? s.rawRecords ?? [] : []
  // Prefer the last step's own timestamp; updated_at is the transcript file's mtime.
  const lastStepClock = fmtClockTime(lastRecordTime(records) ?? s.updated_at)
  const typeCounts = s.recordTypeCounts ?? {}
  const typeKeys = Object.keys(typeCounts)
  const shownRecords = typeFilter === 'all' ? records : records.filter((r) => r._type === typeFilter)

  // Clicking the pinned title is the way back out of a deep session: shut every cycle and
  // return to the top in one action.
  function collapseAllAndScrollTop() {
    setAllOpen('none')
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function setAllOpen(m: 'all' | 'none' | 'cycles') {
    const root = bodyRef.current
    if (!root) return
    root.querySelectorAll('details').forEach((el) => {
      if (m === 'all') el.open = true
      else if (m === 'none') el.open = false
      else el.open = el.classList.contains('cycle')
    })
  }

  return (
    // Publishing this session's working directory lets every value tree drop the project
    // prefix from paths inside it, while paths elsewhere on disk stay complete.
    <WorkspaceRootContext.Provider value={s.cwd}>
    <div ref={scrollRef} className="flex h-full min-w-0 flex-col overflow-y-auto">
      {/* ONLY the title is pinned. It is the one line that still answers "which session am
          I in?" thirty screens into a transcript; pinning the whole header would eat the
          viewport. Sticky works here because this bar is a direct child of the scroller, so
          its containing block is the full scroll height rather than the header box. */}
      <div className="sticky top-0 z-30 flex min-w-0 items-baseline gap-2 border-b border-neutral-200/80 bg-white/90 px-3 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/85">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
          <button
            type="button"
            onClick={collapseAllAndScrollTop}
            title="Collapse all cycles and scroll to top"
            className="min-w-0 max-w-full cursor-pointer truncate text-left text-neutral-950 hover:text-sky-700 dark:text-neutral-50 dark:hover:text-sky-300"
          >
            {s.title || s.id}
          </button>
        </h1>
        {/* Two clocks, both h:MM:ss: when the session's LAST step ran, then the time right
            now (ticking every second off the shared live clock). Reading them together is
            the same information as the "Xm ago" beside them, stated absolutely. */}
        <span className="shrink-0 font-mono text-xs tabular-nums">
          {lastStepClock && (
            <span className="text-neutral-500 dark:text-neutral-400" title="Time of the last step in this session">
              {lastStepClock}
            </span>
          )}
          {lastStepClock && <span className="px-1 text-neutral-300 dark:text-neutral-700">·</span>}
          <LiveClock />
        </span>
        {/* The version lives in the nav bar — repeating it in every session header was noise. */}
        <AgeIndicator value={s.updated_at} now={now} className="shrink-0 text-xs" />
      </div>
      <div className="shrink-0 border-b border-neutral-200/80 bg-white/90 p-3 shadow-sm shadow-neutral-950/[0.03] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/85">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <SourceBadge source={s.source} className="px-1 py-0.5 text-[0.5rem]" />
            {s.isSubagent && (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.68rem] text-neutral-500 dark:text-neutral-400">
                <span className="shrink-0">Parallel child · inherited fork context hidden</span>
                {parentSession ? (
                  <button
                    type="button"
                    onClick={() => useKarin.getState().select(parentSession.uid)}
                    className="inline-flex min-w-0 items-center gap-0.5 truncate font-medium text-sky-700 hover:underline dark:text-sky-300"
                    title={`Open original session: ${parentSession.title || parentSession.id}`}
                  >
                    <ArrowUpLeft className="h-3 w-3 shrink-0" />
                    <span className="truncate">Open original · {parentSession.title || parentSession.id}</span>
                  </button>
                ) : (
                  <span className="text-neutral-400 dark:text-neutral-500">original session unavailable</span>
                )}
              </div>
            )}
          </div>

          {hasRaw && (
            <button
              type="button"
              onClick={() => setRawModeByUid((prev) => ({ ...prev, [s.uid]: nextMode }))}
              aria-label={`View: ${DETAIL_MODE_META[mode].label}`}
              title={`View: ${DETAIL_MODE_META[mode].label} — click for ${DETAIL_MODE_META[nextMode].label}`}
              className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <ModeIcon className="h-4 w-4" />
            </button>
          )}
          {hasRaw && mode !== 'structured' && (
            <select className={`${selectClass} shrink-0`} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types ({records.length})</option>
              {typeKeys.map((k) => (
                <option key={k} value={k}>
                  {k} ({typeCounts[k]})
                </option>
              ))}
            </select>
          )}

          <div className="relative ml-auto shrink-0">
            <button
              type="button"
              onClick={() => setMetaOpen((o) => !o)}
              aria-label="Session metadata"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {metaOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMetaOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-80 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="mb-1 px-1 text-[0.65rem] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    Usage units
                  </div>
          <div className="mb-2 flex flex-wrap items-center justify-start gap-1.5">
          {/* One pill cycling tokens → token units → money. */}
          <button
            type="button"
            onClick={() => setUnitMode(unitModes[(unitModes.indexOf(unitMode) + 1) % unitModes.length])}
            title="Cycle usage unit: tokens → token units → money"
            className="shrink-0 rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
          >
            {UNIT_MODE_LABELS[unitMode]}
          </button>
          {/* token units → pick the reference token type; money → pick the currency. */}
          {unitMode === 'token_units' && (
            <button
              type="button"
              onClick={() => setTokenRef(tokenUnitRefs[(tokenUnitRefs.indexOf(tokenRef) + 1) % tokenUnitRefs.length])}
              title="Reference token type: every segment is shown as the equivalent number of these tokens"
              className="shrink-0 rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
            >
              {TOKEN_UNIT_REF_LABELS[tokenRef]}
            </button>
          )}
          {/* scaled ref → ± multiplier stepper to tune the total near the raw token count. */}
          {unitMode === 'token_units' && tokenRef === 'scaled' && (
            <div className="inline-flex shrink-0 items-center rounded-md border border-neutral-300 bg-neutral-100 text-xs font-medium text-neutral-800 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
              <button
                type="button"
                onClick={() => setTokenMult(stepTokenMult(tokenMult, -1))}
                title="Lower the token-unit multiplier"
                className="px-1.5 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-700"
              >
                −
              </button>
              <span className="min-w-[2.5rem] px-1 text-center tabular-nums" title="Token-unit multiplier">×{tokenMult}</span>
              <button
                type="button"
                onClick={() => setTokenMult(stepTokenMult(tokenMult, 1))}
                title="Raise the token-unit multiplier"
                className="px-1.5 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-700"
              >
                +
              </button>
            </div>
          )}
          {unitMode === 'money' && (
            <button
              type="button"
              onClick={() => setCurrency(currencyModes[(currencyModes.indexOf(currency) + 1) % currencyModes.length])}
              title="How money is written: $ · ¢ · € · €¢, then coin modes that count denominations instead of printing a decimal — 10c, 1c+10c, 0.1c+1c+10c (always US cents)."
              className="shrink-0 rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
            >
              {CURRENCY_LABELS[currency]}
            </button>
          )}
          {/* Block denomination — its own control, not part of the currency cycle: it sizes
              the usage SQUARES, which are always cents no matter which unit the labels use. */}
          <button
            type="button"
            onClick={() => setBlockScale(blockScales[(blockScales.indexOf(blockScale) + 1) % blockScales.length])}
            title="What one usage square is worth. 10c: every bar uses ten-cent boxes, so a small session is one box partly filled rather than a row of tiny dots. Adding 1c and 0.1c lets small bars use finer marks."
            className="shrink-0 rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
          >
            {BLOCK_SCALE_LABELS[blockScale]}
          </button>
          {/* money → which price: theoretical API list vs the subscription plan estimate. */}
          {unitMode === 'money' && (
            <button
              type="button"
              onClick={() => setPriceBasis(priceBasisModes[(priceBasisModes.indexOf(priceBasis) + 1) % priceBasisModes.length])}
              title="Which price: API list (theoretical pay-as-you-go) vs plan estimate (subscription). Tap ? for the pricing model."
              className="shrink-0 rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
            >
              {PRICE_BASIS_LABELS[priceBasis]}
            </button>
          )}
          {/* money → "?" opens the full pricing model: basis explainer, per-source
              plan-estimate divisors, and the API rate table for traceability. */}
          {unitMode === 'money' && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setPriceInfoOpen((o) => !o)}
                aria-label="How this price is computed"
                title="How this price is computed — pricing model, per-plan divisor, rate table, source"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-300 bg-neutral-100 text-xs font-semibold text-neutral-600 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                ?
              </button>
              {priceInfoOpen && (
                <PriceModelPanel
                  basis={priceBasis}
                  subDivisors={subDivisors}
                  onSetDivisor={setSubDivisor}
                  activeSource={s.source}
                  apiRates={apiRates}
                  currency={currency}
                  model={s.model}
                  onClose={() => setPriceInfoOpen(false)}
                />
              )}
            </div>
          )}
            <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setInfoOpen((o) => !o)}
              aria-label="What the bar colors mean"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-300 bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <Info className="h-4 w-4" />
            </button>
            {infoOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setInfoOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-neutral-200 bg-white p-3 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="mb-2 font-semibold text-neutral-700 dark:text-neutral-200">What the bar colors mean</div>
                  <div className="grid gap-1.5">
                    {[
                      { c: 'bg-sky-500', label: 'input', desc: 'fresh prompt tokens sent' },
                      { c: 'bg-emerald-500', label: 'cached', desc: 'reused context (cheaper)' },
                      { c: 'bg-violet-500', label: 'cache write', desc: 'writing context to cache (Claude)' },
                      { c: 'bg-amber-500', label: 'output', desc: 'answer text produced' },
                      { c: 'bg-fuchsia-500', label: 'reasoning', desc: 'model thinking (Codex)' },
                    ].map((r) => (
                      <div key={r.label} className="flex items-start gap-2">
                        <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm ${r.c}`} />
                        <span className="text-neutral-700 dark:text-neutral-300">
                          <span className="font-medium">{r.label}</span> — {r.desc}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 border-t border-neutral-100 pt-2 text-[0.68rem] leading-relaxed text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    Codex per-card bars are <span className="font-medium">estimates</span> (marked ≈), split from the
                    turn's measured total by text length. Claude records usage per message, so its bars are measured.
                  </div>
                </div>
              </>
            )}
            </div>
          </div>
                  <div className="mb-1 border-t border-neutral-100 px-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-wide text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                    Session metadata
                  </div>
                  <div className="grid gap-1">
                    {s.meta.map((row) => (
                      <Meta key={row.label} label={row.label} value={row.value} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-1.5 flex min-w-0 flex-col gap-1">
          <UsageBar usage={u} rates={rates} mode={unitMode} currency={currency} tokenRef={tokenRef} tokenMult={tokenMult} inlineLabels />
        </div>
        {/* Persistent basis caption so money figures are never ambiguous — states which
            price this is and points to the traceable pricing model. */}
        {unitMode === 'money' && s.source === 'warp' && (
          <p className="mt-1.5 text-[0.68rem] leading-snug text-neutral-500 dark:text-neutral-400">
            <span className="font-medium text-neutral-600 dark:text-neutral-300">Not priced</span>
            {` — Warp records one cumulative token total per model, with no input/output split, and the two bill at very different rates. Any cost here would be a guess, so Karin shows tokens only.`}
          </p>
        )}
      </div>

      {/* pb-48 (3× the old pb-16): enough room below the last cycle to scroll it up to
          the middle of the screen instead of leaving it pinned to the bottom edge. */}
      <div ref={bodyRef} className="p-1 pb-48 md:p-[5px] md:pb-48">
        {isClaude && <TitleOpsPanel ops={s.titleOps as ClaudeSession[] | undefined} now={now} />}

        {mode === 'json' ? (
          <JsonDump records={shownRecords} uid={s.uid} now={now} />
        ) : mode === 'raw' ? (
          <>
            <div className="mb-2 px-1 text-[0.68rem] text-neutral-400 dark:text-neutral-500">
              {shownRecords.length} {shownRecords.length === 1 ? 'record' : 'records'}
              {typeFilter !== 'all' ? ` of type ${typeFilter}` : ''}
            </div>
            {shownRecords.length === 0 ? (
              <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No records match this filter.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {shownRecords.map((rec) => (
                  <RecordRow key={`${rec._line}-${String(rec.uuid ?? '')}`} record={rec} now={now} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <LocalSummary session={s} />
            <ContextAudit session={s} />

            {/* Icon-only: three labelled buttons were a sentence-wide toolbar for three
                actions whose icons already say it. Titles carry the wording. */}
            <div className="mb-2 mt-4 flex justify-end gap-1">
              {[
                { m: 'all' as const, Icon: ChevronsDown, title: 'Expand all' },
                { m: 'none' as const, Icon: ChevronsUp, title: 'Collapse all' },
                { m: 'cycles' as const, Icon: PanelTopOpen, title: 'Cycles only' },
              ].map(({ m, Icon, title }) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAllOpen(m)}
                  title={title}
                  aria-label={title}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>

            {cycles.length === 0 ? (
              <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No structured cycles for this session.</p>
            ) : (
              cycleInfos.map(({ cycle, model, effort, rates: cycleRates }, i) => {
                const modelChanged = i === 0 || model !== cycleInfos[i - 1]?.model || effort !== cycleInfos[i - 1]?.effort
                return (
                  <div key={`c${cycle.startLine}`}>
                    {modelChanged && (model || effort) && (
                      <div className="flex items-center gap-2 px-1 py-1 text-[0.65rem] text-neutral-400 dark:text-neutral-500">
                        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                        <span className="shrink-0">{model || 'model n/a'}{effort && ` · ${effort}`}</span>
                        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                      </div>
                    )}
                    <Cycle
                      // Keyed by the cycle's first raw line, NOT its position: a cycle
                      // appearing earlier in the transcript must not renumber the DOM and
                      // collapse the cycle the owner is reading (<details> open state lives
                      // on the element).
                      cycle={cycle}
                      source={s.source}
                      rates={cycleRates}
                      unitMode={unitMode}
                      currency={currency}
                      tokenRef={tokenRef}
                      tokenMult={tokenMult}
                      singleModel={(s.models?.length ?? 0) <= 1}
                    />
                  </div>
                )
              })
            )}
          </>
        )}
      </div>
    </div>
    </WorkspaceRootContext.Provider>
  )
}
