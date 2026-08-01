import { useState } from 'react'
import { ChevronRight, Folder, Info, List, Search } from 'lucide-react'
import type { RateLimits } from '../types'
import { useKarin } from '../store/karin'
import { sessionMatchesUnified } from '../lib/format'
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
import SourceMark from './SourceMark'
import SidebarHero from './SidebarHero'

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

// All three sources can provide a working/project directory, but they store it in
// different fields. UnifiedSession keeps both forms so the sidebar can group them
// without knowing which indexer produced the row.
function sessionFolder(session: { projectCwd: string | null; cwd: string | null; projectSlug: string | null }): string | null {
  const folder = session.projectCwd || session.cwd || session.projectSlug
  return folder?.replace(/[\\/]+$/, '') || null
}

function folderLabel(folder: string | null): string {
  return folder ? projectLabel(folder, null) || folder : 'No folder'
}

// Codex and Claude can report the same Windows project with different drive-letter
// casing or slash styles. Canonicalize only Windows paths so those rows share a group.
function folderGroupKey(folder: string | null): string {
  if (!folder) return 'no-folder'
  const normalized = folder.replace(/[\\/]+/g, '/')
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

function windowName(minutes: number | null): string {
  if (minutes == null) return 'window'
  if (minutes >= 10080) return 'weekly'
  if (minutes >= 1440) return 'daily'
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes)}m`
}

function resetLabel(epochSeconds: number | null): string {
  if (!epochSeconds) return 'reset unknown'
  return `resets ${new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(epochSeconds * 1000)}`
}

function RemainingUsage({ limits, className }: { limits: RateLimits | null; className?: string }) {
  if (!limits) return null
  const windows = [limits.primary, limits.secondary].filter(Boolean)
  if (windows.length === 0 && limits.credits?.unlimited) {
    return <div className={cn('border-b border-neutral-200/70 px-2 py-1 text-[0.65rem] text-neutral-500 dark:border-neutral-800/70 dark:text-neutral-400', className)}>unlimited usage</div>
  }
  if (windows.length === 0) return null
  const label = windows
    .map((window) => `${windowName(window!.window_minutes)} ${Math.max(0, 100 - window!.used_percent).toFixed(window!.used_percent % 1 ? 1 : 0)}% left`)
    .join(' · ')
  const title = windows.map((window) => resetLabel(window!.resets_at)).join(' · ')
  return (
    <div className={cn('flex items-center gap-1 border-b border-neutral-200/70 px-2 py-1 text-[0.65rem] text-neutral-500 dark:border-neutral-800/70 dark:text-neutral-400', className)} title={title}>
      <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
      <span className="font-semibold text-neutral-700 dark:text-neutral-200">{label}</span>
    </div>
  )
}

export default function Sidebar({ className }: SidebarProps) {
  const sessions = useKarin((s) => s.sessions)
  const selectedUid = useKarin((s) => s.selectedUid)
  const search = useKarin((s) => s.search)
  const setSearch = useKarin((s) => s.setSearch)
  const sourceFilter = useKarin((s) => s.sourceFilter)
  const groupByFolder = useKarin((s) => s.groupByFolder)
  const setGroupByFolder = useKarin((s) => s.setGroupByFolder)
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [priceInfoOpen, setPriceInfoOpen] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})

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
  const folderGroups = (() => {
    const groups = new Map<string, { key: string; folder: string | null; rows: typeof rows }>()
    rows.forEach((row) => {
      const folder = sessionFolder(row.session)
      const key = `folder:${folderGroupKey(folder)}`
      const group = groups.get(key)
      if (group) group.rows.push(row)
      else groups.set(key, { key, folder, rows: [row] })
    })
    return [...groups.values()]
  })()
  // Sessions are merged newest-first, so the first snapshot is the freshest account-level
  // Codex rate-limit response available in the local feed.
  const rateLimits = sessions.find((s) => s.rateLimits)?.rateLimits ?? null

  return (
    <aside
      className={cn(
        'flex h-full w-full min-w-0 flex-col border-r border-neutral-200 bg-white md:w-[clamp(300px,30vw,430px)] dark:border-neutral-800 dark:bg-neutral-950',
        className,
      )}
    >
      <div className="shrink-0 border-b border-neutral-200/80 px-2 py-1.5 dark:border-neutral-800">
        {/* The quiet header exposes actions, not persistent controls. Search and pricing
            still exist, but open only when the owner asks for them. */}
        <div className="relative flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSearchOpen((open) => {
              if (!open) setInfoOpen(false)
              return !open
            })}
            aria-expanded={searchOpen}
            title="Search sessions, prompts, and tools"
            className="inline-flex h-7 w-7 items-center justify-center text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setInfoOpen((open) => {
              if (!open) setSearchOpen(false)
              if (open) setPriceInfoOpen(false)
              return !open
            })}
            aria-expanded={infoOpen}
            title="Usage allowance, display units, and pricing"
            className="inline-flex h-7 w-7 items-center justify-center text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
          >
            <Info className="h-3.5 w-3.5" />
          </button>

          {searchOpen && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
              <label className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 text-sm text-neutral-500 focus-within:border-neutral-400 focus-within:bg-white dark:border-neutral-800 dark:bg-neutral-950 dark:focus-within:border-neutral-600">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search sessions, prompts, tools"
                  className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                />
              </label>
            </div>
          )}

          {infoOpen && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
              <RemainingUsage limits={rateLimits} className="mb-2 rounded-md border" />
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
          <button
            type="button"
            onClick={() => setGroupByFolder(!groupByFolder)}
            aria-pressed={groupByFolder}
            aria-label={groupByFolder ? 'Show a flat session list' : 'Group sessions by folder'}
            title={groupByFolder ? 'Grouped by folder — click for a flat list' : 'Flat list — click to group by folder'}
            className={cn(
              'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800',
              groupByFolder && 'border-neutral-400 bg-neutral-200 text-neutral-950 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50',
            )}
          >
            {groupByFolder ? <Folder className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
          </button>
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
          )}
        </div>
      </div>

      <SidebarHero sessionCount={list.length} />

      <div className="flex-1 overflow-y-auto px-1 pt-1 pb-16">
        {list.length === 0 ? (
          <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No sessions match.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(groupByFolder ? folderGroups : [{ key: 'all-sessions', folder: null, rows }]).map(({ key, folder, rows: groupRows }) => (
              <section key={key}>
                {groupByFolder && (
                  <button
                    type="button"
                    onClick={() => setCollapsedFolders((current) => ({ ...current, [key]: !current[key] }))}
                    aria-expanded={!collapsedFolders[key]}
                    className="flex w-full items-center gap-1.5 px-2 pb-1 pt-1 text-left text-[0.65rem] font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                    title={folder || 'Sessions without a folder'}
                  >
                    <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', !collapsedFolders[key] && 'rotate-90')} />
                    <Folder className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 truncate">{folderLabel(folder)}</span>
                    <span className="ml-auto shrink-0 font-normal tabular-nums text-neutral-400 dark:text-neutral-500">{groupRows.length}</span>
                  </button>
                )}
                {!groupByFolder || !collapsedFolders[key] ? (
                  <ul className="flex flex-col gap-0.5">
                    {groupRows.map(({ session: s, rates }) => {
                      const selected = s.uid === selectedUid
                      // Every source gets a compact project label from its project cwd or working cwd.
                      const project = projectLabel(s.projectCwd || s.cwd, s.projectSlug)
                      return (
                        <li key={s.uid}>
                          <button
                            type="button"
                            onClick={() => useKarin.getState().select(s.uid)}
                            className={cn(
                              'relative flex w-full flex-col gap-0 rounded-md border px-3 py-1.5 text-left transition-colors',
                              selected
                                ? 'border-neutral-300 bg-neutral-100 shadow-sm dark:border-neutral-700 dark:bg-neutral-900'
                                : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-900',
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <SourceMark source={s.source} state={s.turnState} />
                              <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-950 dark:text-neutral-50">
                                  {s.title || s.id}
                                </span>
                                {project && (
                                  <span
                                    className="max-w-[38%] shrink-0 truncate text-[0.65rem] text-neutral-500 dark:text-neutral-400"
                                    title={s.projectCwd || s.cwd || project}
                                  >
                                    · {project}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="ml-[22px] -mt-px min-w-0">
                              <UsageBar
                                usage={s.latest_total_usage || {}}
                                rates={rates}
                                mode={unitMode}
                                currency={currency}
                                tokenRef={tokenRef}
                                tokenMult={tokenMult}
                                compact
                                bare
                                inlineLabels
                                hideSegmentLabels
                                showLegend={false}
                                scaleMax={scaleMax}
                              />
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
