import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronsDown, ChevronsUp, Info, MoreVertical, PanelTopOpen } from 'lucide-react'
import type { Session, TokenUsage } from '../types'
import type { ClaudeDetailSession } from '../lib/claudeModel'
import type { ClaudeRecord, ClaudeSession } from '../lib/claudeRaw'
import { useKarin } from '../store/karin'
import { buildCycles, cycleUsage, cycleModelEffort } from '../lib/unifiedCycles'
import { fmtNum, shortAge } from '../lib/format'
import {
  CURRENCY_LABELS,
  TOKEN_UNIT_REF_LABELS,
  UNIT_MODE_LABELS,
  currencyModes,
  ratesForUnified,
  tokenUnitRefs,
  unitModes,
  usageUnitTotal,
} from '../lib/pricing'
import { cn } from '../lib/cn'
import { APP_VERSION } from '../lib/appVersion'
import AgeIndicator, { useLiveNow } from './AgeIndicator'
import Cycle from './Cycle'
import ContextAudit from './ContextAudit'
import UsageBar from './UsageBar'
import SourceBadge from './SourceBadge'
import RecordRow from './RecordRow'

type DetailMode = 'structured' | 'raw'
const DETAIL_MODES: DetailMode[] = ['structured', 'raw']
const DETAIL_MODE_LABELS: Record<DetailMode, string> = { structured: 'Structured', raw: 'Raw' }

const selectClass =
  'h-8 min-w-0 max-w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 text-xs text-neutral-800 outline-none focus:border-neutral-400 focus:bg-white dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:focus:border-neutral-600 dark:focus:bg-neutral-950'

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
  const now = useLiveNow()
  const bodyRef = useRef<HTMLDivElement>(null)
  // Shared global toggle (see the sidebar) so switching units re-expresses every
  // token display across both panes at once.
  const unitMode = useKarin((st) => st.unitMode)
  const setUnitMode = useKarin((st) => st.setUnitMode)
  const tokenRef = useKarin((st) => st.tokenRef)
  const setTokenRef = useKarin((st) => st.setTokenRef)
  const currency = useKarin((st) => st.currency)
  const setCurrency = useKarin((st) => st.setCurrency)
  const [metaOpen, setMetaOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [rawModeByUid, setRawModeByUid] = useState<Record<string, DetailMode>>({})
  const [typeFilter, setTypeFilter] = useState('all')

  const s = sessions.find((x) => x.uid === selectedUid)
  const cycles = useMemo(() => (s ? buildCycles(s) : []), [s])
  const rates = s ? ratesForUnified(s) : null
  const u: TokenUsage = s?.latest_total_usage || {}
  // One shared ruler for the top session-total bar AND every cycle bar.
  const scaleMax = Math.max(
    usageUnitTotal(u, rates, unitMode, tokenRef),
    ...cycles.map((c) => usageUnitTotal(cycleUsage(c), rates, unitMode, tokenRef)),
  )

  // Reset the raw-mode type filter whenever the selected session changes.
  useEffect(() => {
    setTypeFilter('all')
  }, [selectedUid])

  if (!s) {
    return (
      <div className="flex h-dvh flex-1 items-center justify-center p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a session to view its prompts, tools, and token usage.
      </div>
    )
  }

  const isClaude = s.source === 'claude'
  const mode: DetailMode = isClaude ? rawModeByUid[s.uid] || 'structured' : 'structured'
  const turnContexts = isClaude ? (s.raw as ClaudeDetailSession).turn_contexts : (s.raw as Session).turn_contexts
  const records: ClaudeRecord[] = isClaude ? (s.rawRecords as ClaudeRecord[]) ?? [] : []
  const typeCounts = s.recordTypeCounts ?? {}
  const typeKeys = Object.keys(typeCounts)
  const shownRecords = typeFilter === 'all' ? records : records.filter((r) => r._type === typeFilter)

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
    <div className="flex h-dvh min-w-0 flex-col">
      <div className="shrink-0 border-b border-neutral-200/80 bg-white/90 p-3 shadow-sm shadow-neutral-950/[0.03] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/85">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => useKarin.getState().select(null)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 md:hidden"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <SourceBadge source={s.source} />
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
            {s.title || s.id}
          </h1>
          <span className="shrink-0 text-[0.68rem] font-medium text-neutral-400 dark:text-neutral-500">Karin {APP_VERSION}</span>
          <AgeIndicator value={s.updated_at} now={now} className="shrink-0 text-xs" />

          {isClaude && (
            <div className="ml-auto inline-flex shrink-0 rounded-md border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
              {DETAIL_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRawModeByUid((prev) => ({ ...prev, [s.uid]: m }))}
                  className={`shrink-0 rounded-sm px-2 py-0.5 text-[0.68rem] ${
                    mode === m
                      ? 'bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-50'
                      : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100'
                  }`}
                >
                  {DETAIL_MODE_LABELS[m]}
                </button>
              ))}
            </div>
          )}
          {isClaude && mode === 'raw' && (
            <select className={`${selectClass} shrink-0`} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types ({records.length})</option>
              {typeKeys.map((k) => (
                <option key={k} value={k}>
                  {k} ({typeCounts[k]})
                </option>
              ))}
            </select>
          )}

          <div className={`relative shrink-0 ${isClaude ? '' : 'ml-auto'}`}>
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
                <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="mb-1 px-1 text-[0.65rem] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
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

        <div className="mt-2 flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <UsageBar usage={u} rates={rates} mode={unitMode} currency={currency} tokenRef={tokenRef} scaleMax={scaleMax} inlineLabels />
          </div>
          {/* Mode pill group: tokens / token units / money. */}
          <div className="inline-flex shrink-0 rounded-md border border-neutral-300 bg-neutral-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-800">
            {unitModes.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setUnitMode(m)}
                className={cn(
                  'rounded-sm px-2 py-0.5 text-xs font-medium',
                  unitMode === m
                    ? 'bg-white text-neutral-950 shadow-sm dark:bg-neutral-950 dark:text-neutral-50'
                    : 'text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100',
                )}
              >
                {UNIT_MODE_LABELS[m]}
              </button>
            ))}
          </div>
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
          {unitMode === 'money' && (
            <button
              type="button"
              onClick={() => setCurrency(currencyModes[(currencyModes.indexOf(currency) + 1) % currencyModes.length])}
              className="shrink-0 rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
            >
              {CURRENCY_LABELS[currency]}
            </button>
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
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto p-3 md:p-4">
        {isClaude && <TitleOpsPanel ops={s.titleOps as ClaudeSession[] | undefined} now={now} />}

        {mode === 'raw' ? (
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
            <ContextAudit session={s} />

            <div className="mb-2 mt-4 flex justify-end">
              <div className="flex max-w-full flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAllOpen('all')}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <ChevronsDown className="h-3.5 w-3.5" />
                  Expand all
                </button>
                <button
                  type="button"
                  onClick={() => setAllOpen('none')}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <ChevronsUp className="h-3.5 w-3.5" />
                  Collapse
                </button>
                <button
                  type="button"
                  onClick={() => setAllOpen('cycles')}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <PanelTopOpen className="h-3.5 w-3.5" />
                  Cycles only
                </button>
              </div>
            </div>

            {cycles.length === 0 ? (
              <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No structured cycles for this session.</p>
            ) : (
              cycles.map((cycle, i) => {
                const { model, effort } = cycleModelEffort(cycle, turnContexts)
                return (
                  <Cycle
                    key={i}
                    cycle={cycle}
                    index={i}
                    source={s.source}
                    rates={rates}
                    unitMode={unitMode}
                    currency={currency}
                    tokenRef={tokenRef}
                    scaleMax={scaleMax}
                    model={model}
                    effort={effort}
                  />
                )
              })
            )}
          </>
        )}
      </div>
    </div>
  )
}
