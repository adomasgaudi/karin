import { useState } from 'react'
import { Search } from 'lucide-react'
import { useKarin } from '../store/karin'
import { sessionMatchesUnified, sessionTotalLabel } from '../lib/format'
import { cn } from '../lib/cn'
import {
  CURRENCY_LABELS,
  PRICE_BASIS_LABELS,
  TOKEN_UNIT_REF_LABELS,
  UNIT_MODE_LABELS,
  currencyModes,
  effectiveRates,
  priceBasisModes,
  ratesForUnified,
  stepTokenMult,
  tokenUnitRefs,
  unitModes,
  usageUnitTotal,
} from '../lib/pricing'
import PriceModelPanel from './PriceModelPanel'
import UsageBar from './UsageBar'
import SourceCycle from './SourceCycle'
import SourceBadge from './SourceBadge'
import TurnDot from './TurnDot'

interface SidebarProps {
  className?: string
}

// Last path segment of a Claude session's project cwd (fallback: the slug) — shown inline
// so Claude rows carry their project without a separate grouping column.
function projectLabel(cwd: string | null, slug: string | null): string | null {
  if (cwd) {
    const parts = cwd.split(/[\\/]/).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return slug
}

export default function Sidebar({ className }: SidebarProps) {
  const sessions = useKarin((s) => s.sessions)
  const selectedUid = useKarin((s) => s.selectedUid)
  const search = useKarin((s) => s.search)
  const setSearch = useKarin((s) => s.setSearch)
  const sourceFilter = useKarin((s) => s.sourceFilter)
  // Global usage-unit toggle (shared with the session detail) so it re-expresses
  // every token display at once, not just this pane's bars.
  const unitMode = useKarin((s) => s.unitMode)
  const setUnitMode = useKarin((s) => s.setUnitMode)
  const tokenRef = useKarin((s) => s.tokenRef)
  const setTokenRef = useKarin((s) => s.setTokenRef)
  const tokenMult = useKarin((s) => s.tokenMult)
  const setTokenMult = useKarin((s) => s.setTokenMult)
  const currency = useKarin((s) => s.currency)
  const setCurrency = useKarin((s) => s.setCurrency)
  const priceBasis = useKarin((s) => s.priceBasis)
  const setPriceBasis = useKarin((s) => s.setPriceBasis)
  const subDivisors = useKarin((s) => s.subDivisors)
  const setSubDivisor = useKarin((s) => s.setSubDivisor)
  const [priceInfoOpen, setPriceInfoOpen] = useState(false)

  const list = sessions.filter(
    (s) => (sourceFilter === 'all' || s.source === sourceFilter) && sessionMatchesUnified(s, search),
  )
  // Each session's bar is drawn against the largest visible session's total (in the active
  // unit), so every session's input/cached/output bar is proportional to the others.
  const rows = list.map((s) => {
    // Apply the active price basis (÷divisor for the plan estimate) at the rates level so
    // row totals and bars reflect the chosen basis. Divisor is per source — each row's
    // own plan (Codex vs Claude).
    const rates = effectiveRates(ratesForUnified(s), priceBasis, subDivisors[s.source])
    return { session: s, rates, unitTotal: usageUnitTotal(s.latest_total_usage, rates, unitMode, tokenRef, tokenMult) }
  })
  const scaleMax = Math.max(0, ...rows.map((r) => r.unitTotal))

  return (
    <aside
      className={cn(
        'flex h-full w-full min-w-0 flex-col border-r border-neutral-200 bg-white md:w-[clamp(300px,30vw,430px)] dark:border-neutral-800 dark:bg-neutral-950',
        className,
      )}
    >
      <div className="shrink-0 border-b border-neutral-200/80 px-2 py-1.5 dark:border-neutral-800">
        {/* Search, units and the source toggle share one row — brand and pages moved to the nav bar. */}
        <div className="relative flex items-center gap-1.5">
        <label className="flex h-7 flex-1 items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-1.5 text-sm text-neutral-500 focus-within:border-neutral-400 focus-within:bg-white dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-600 dark:focus-within:bg-neutral-950">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions, prompts, tools"
            className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
        </label>

          {/* Every unit control reads as ONE pill ("money · € · plan") — separate borders
              made three independent-looking widgets out of one setting. */}
          <div className="inline-flex shrink-0 items-center divide-x divide-neutral-200 rounded-md border border-neutral-200 bg-neutral-50 text-[0.65rem] dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => setUnitMode(unitModes[(unitModes.indexOf(unitMode) + 1) % unitModes.length])}
            title="Cycle usage unit: tokens → token units → money"
            className="shrink-0 px-1.5 py-0.5 font-medium text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {UNIT_MODE_LABELS[unitMode]}
          </button>
          {/* token units → reference token type; money → currency. */}
          {unitMode === 'token_units' && (
            <button
              type="button"
              onClick={() => setTokenRef(tokenUnitRefs[(tokenUnitRefs.indexOf(tokenRef) + 1) % tokenUnitRefs.length])}
              title="Reference token type: every segment is shown as the equivalent number of these tokens"
              className="shrink-0 px-1.5 py-0.5 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {TOKEN_UNIT_REF_LABELS[tokenRef]}
            </button>
          )}
          {/* scaled ref → ± multiplier stepper. */}
          {unitMode === 'token_units' && tokenRef === 'scaled' && (
            <div className="inline-flex shrink-0 items-center font-medium text-neutral-700 dark:text-neutral-300">
              <button
                type="button"
                onClick={() => setTokenMult(stepTokenMult(tokenMult, -1))}
                title="Lower the token-unit multiplier"
                className="px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                −
              </button>
              <span className="min-w-[2.25rem] px-0.5 text-center tabular-nums" title="Token-unit multiplier">×{tokenMult}</span>
              <button
                type="button"
                onClick={() => setTokenMult(stepTokenMult(tokenMult, 1))}
                title="Raise the token-unit multiplier"
                className="px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                +
              </button>
            </div>
          )}
          {unitMode === 'money' && (
            <button
              type="button"
              onClick={() => setCurrency(currencyModes[(currencyModes.indexOf(currency) + 1) % currencyModes.length])}
              className="shrink-0 px-1.5 py-0.5 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {CURRENCY_LABELS[currency]}
            </button>
          )}
          {/* money → API list price vs subscription plan estimate (see the detail pane's ? panel). */}
          {unitMode === 'money' && (
            <button
              type="button"
              onClick={() => setPriceBasis(priceBasisModes[(priceBasisModes.indexOf(priceBasis) + 1) % priceBasisModes.length])}
              title="Which price: API list (theoretical) vs plan estimate (subscription)"
              className="shrink-0 px-1.5 py-0.5 font-medium text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              {PRICE_BASIS_LABELS[priceBasis]}
            </button>
          )}
          {/* money → "?" opens the pricing model: basis explainer + per-plan divisors. */}
          {unitMode === 'money' && (
            <button
              type="button"
              onClick={() => setPriceInfoOpen((o) => !o)}
              aria-label="How this price is computed"
              title="How this price is computed — per-plan divisors, source"
              className="inline-flex shrink-0 items-center justify-center px-1.5 py-0.5 font-semibold text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              ?
            </button>
          )}
          </div>
          <SourceCycle />
          {/* Panel spans the whole toolbar row (its `relative` ancestor), not the tiny "?"
              button, so its fixed width can't overflow the window's left edge. */}
          {unitMode === 'money' && priceInfoOpen && (
            <PriceModelPanel
              basis={priceBasis}
              subDivisors={subDivisors}
              onSetDivisor={setSubDivisor}
              currency={currency}
              onClose={() => setPriceInfoOpen(false)}
              posClass="left-0 right-0 top-full"
            />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {list.length === 0 ? (
          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No sessions match.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map(({ session: s, rates }) => {
              const selected = s.uid === selectedUid
              // Claude groups by project; Warp has only a working directory — both read
              // as the same trailing folder name. Codex is flat.
              const project =
                s.source === 'claude' || s.source === 'warp' ? projectLabel(s.projectCwd, s.projectSlug) : null
              return (
                <li key={s.uid}>
                  <button
                    type="button"
                    onClick={() => useKarin.getState().select(s.uid)}
                    className={cn(
                      'grid w-full gap-1 rounded-md border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'border-neutral-300 bg-neutral-100 shadow-sm dark:border-neutral-700 dark:bg-neutral-900'
                        : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-900',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <TurnDot state={s.turnState} />
                      <SourceBadge source={s.source} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-950 dark:text-neutral-50">
                        {s.title || s.id}
                      </span>
                    </div>
                    {/* Date + cached tokens live in the session detail now; the list row
                        stays lean with just total tokens + project. */}
                    <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {sessionTotalLabel(s, rates, unitMode, currency, tokenRef, tokenMult)}{project ? ` / ${project}` : ''}
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-1 text-[0.68rem] text-neutral-500 dark:text-neutral-500">
                      <span>{s.counts.user} user</span>
                      <span>{s.counts.assistant} assistant</span>
                      <span>{s.counts.tool_calls} tools</span>
                      <span>{s.counts.code_edits} edits</span>
                    </div>
                    <UsageBar
                      usage={s.latest_total_usage || {}}
                      rates={rates}
                      mode={unitMode}
                      currency={currency}
                      tokenRef={tokenRef}
                      tokenMult={tokenMult}
                      compact
                      inlineLabels
                      showLegend={false}
                      scaleMax={scaleMax}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
