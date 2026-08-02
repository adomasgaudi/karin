import { create } from 'zustand'
import type { KarinData, KarinStatus, UnifiedSession, SessionSource } from '../types'
import type { ClaudeRawData } from '../lib/claudeRaw'
import type { WarpRawData } from '../lib/warpRaw'
import type { UsageUnitMode, CurrencyMode, TokenUnitRef, PriceBasis, BlockScale } from '../lib/pricing'
import { DEFAULT_TOKEN_MULT, SUB_DIVISOR_DEFAULTS } from '../lib/pricing'
import { saveCodex, saveClaude, saveWarp, loadSaved, clearSaved } from '../lib/persist'
import {
  fetchLocalData,
  fetchClaudeRaw,
  fetchWarpRaw,
  fetchLocalStatus,
  feedTag,
  FEED_PATHS,
} from '../lib/loadData'
import { mergeSessions } from '../lib/adapt'
import { applyCachedBody, hydrateSession, needsHydration } from '../lib/hydrate'

type Theme = 'light' | 'dark'
export type SourceFilter = 'all' | 'codex' | 'claude' | 'warp'
export type View = 'sessions' | 'timeline' | 'summary' | 'v2'

function initialTheme(): Theme {
  const saved = localStorage.getItem('karin-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function initialSourceFilter(): SourceFilter {
  const saved = localStorage.getItem('karin-source')
  if (saved === 'codex' || saved === 'claude' || saved === 'warp') return saved
  return 'all'
}

// One global usage-unit toggle drives EVERY token display (sidebar totals + bars,
// session detail, cycles) so switching it re-expresses all instances at once.
function initialUnitMode(): UsageUnitMode {
  const saved = localStorage.getItem('karin-unit')
  if (saved === 'tokens' || saved === 'token_units' || saved === 'money') return saved
  return 'money'
}

// Which token type token_units mode normalizes against (independent of currency).
function initialTokenRef(): TokenUnitRef {
  const saved = localStorage.getItem('karin-tokenref')
  if (saved === 'input' || saved === 'cached' || saved === 'output' || saved === 'scaled') return saved
  return 'output'
}

// Multiplier for the 'scaled' reference (see pricing.ts).
function initialTokenMult(): number {
  const saved = Number(localStorage.getItem('karin-tokenmult'))
  if (Number.isFinite(saved) && saved > 0) return saved
  return DEFAULT_TOKEN_MULT
}

// Whether expanding a step inside a cycle keeps the other steps open (accordion off).
// Default: auto-close, so one step at a time stays readable.
function initialKeepStepsOpen(): boolean {
  return localStorage.getItem('karin-keep-steps-open') === '1'
}

// Whether cycle headers show their meaningful AI work-step count. Keep the compact
// measurement visible by default, but let the owner remove it when reading only prompts.
function initialShowStepCounts(): boolean {
  return localStorage.getItem('karin-show-step-counts') !== '0'
}

// Whether the main session list is organized into folder sections instead of one flat list.
// Keep the existing flat layout as the default so the first launch is unchanged.
function initialGroupByFolder(): boolean {
  return localStorage.getItem('karin-group-folders') === '1'
}

function initialCurrency(): CurrencyMode {
  const saved = localStorage.getItem('karin-currency')
  if (saved === 'usd' || saved === 'usd_cents' || saved === 'eur' || saved === 'eur_cents') return saved
  return 'eur'
}

// How fine the usage BLOCKS may get. Defaults to all three denominations, which is the
// behaviour the bars have always had; '10c' forces every bar onto ten-cent boxes.
function initialBlockScale(): BlockScale {
  const saved = localStorage.getItem('karin-blockscale')
  if (saved === 'c10' || saved === 'c1_10' || saved === 'c01_1_10') return saved
  return 'c01_1_10'
}

// Which price the money mode shows: theoretical API list price, or the subscription
// plan estimate. Defaults to the plan estimate — the number the owner actually cares about.
function initialPriceBasis(): PriceBasis {
  const saved = localStorage.getItem('karin-pricebasis')
  if (saved === 'api' || saved === 'sub') return saved
  return 'sub'
}

// Divisor applied to API list price for the 'sub' plan estimate — SEPARATE per source,
// because a Codex (ChatGPT) plan and a Claude (Max) plan have different prices, allowances
// and model mixes, so their subscription-vs-API ratios differ. Migrates the old shared key.
function initialSubDivisor(key: string, fallback: number): number {
  const saved = Number(localStorage.getItem(key))
  if (Number.isFinite(saved) && saved > 0) return saved
  const legacy = Number(localStorage.getItem('karin-subdiv'))
  if (Number.isFinite(legacy) && legacy > 0) return legacy
  return fallback
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

interface KarinStore {
  codex: KarinData | null
  claude: ClaudeRawData | null
  warp: WarpRawData | null
  sessions: UnifiedSession[] // merged, most-recent first
  generatedAt: string | null
  status: KarinStatus | null
  booting: boolean
  selectedUid: string | null
  search: string
  sourceFilter: SourceFilter
  unitMode: UsageUnitMode
  tokenRef: TokenUnitRef
  tokenMult: number
  currency: CurrencyMode
  blockScale: BlockScale
  priceBasis: PriceBasis
  subDivisors: Record<SessionSource, number>
  keepStepsOpen: boolean
  showStepCounts: boolean
  groupByFolder: boolean
  theme: Theme
  view: View
  error: string | null

  boot: () => Promise<void>
  setCodexData: (data: KarinData) => void
  setClaudeData: (data: ClaudeRawData) => void
  setWarpData: (data: WarpRawData) => void
  refreshLocalData: () => Promise<void>
  reset: () => Promise<void>
  select: (uid: string | null) => void
  hydrateSelected: (uid: string) => Promise<void>
  hydrateAll: () => Promise<void>
  setSearch: (q: string) => void
  setSourceFilter: (f: SourceFilter) => void
  setUnitMode: (m: UsageUnitMode) => void
  setTokenRef: (r: TokenUnitRef) => void
  setTokenMult: (n: number) => void
  setCurrency: (c: CurrencyMode) => void
  setBlockScale: (s: BlockScale) => void
  setPriceBasis: (b: PriceBasis) => void
  setSubDivisor: (source: SessionSource, n: number) => void
  setKeepStepsOpen: (keep: boolean) => void
  setShowStepCounts: (show: boolean) => void
  setGroupByFolder: (group: boolean) => void
  setError: (msg: string | null) => void
  setView: (v: View) => void
  toggleTheme: () => void
}

// Freshest generated-at stamp across sources — the "generated" time shown in the header.
function freshestGeneratedAt(
  codex: KarinData | null,
  claude: ClaudeRawData | null,
  warp: WarpRawData | null,
): string | null {
  const stamps = [codex?.generated_at, claude?.generated_at, warp?.generated_at].filter(Boolean) as string[]
  if (stamps.length === 0) return null
  return stamps.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
}

// Freeze the sidebar order so the active session doesn't jump to the top on every refresh.
// mergeSessions returns updated_at-desc; we hold that order for RESORT_MS, then take a fresh
// snapshot. New sessions (absent from the snapshot) surface at the top in recency order.
const RESORT_MS = 5 * 60 * 1000
let sortSnapshot: { at: number; rank: Map<string, number> } | null = null

function frozenOrder(sorted: UnifiedSession[]): UnifiedSession[] {
  const now = Date.now()
  if (!sortSnapshot || now - sortSnapshot.at >= RESORT_MS) {
    sortSnapshot = { at: now, rank: new Map(sorted.map((s, i) => [s.uid, i])) }
    return sorted
  }
  const rank = sortSnapshot.rank
  const known = sorted.filter((s) => rank.has(s.uid)).sort((a, b) => rank.get(a.uid)! - rank.get(b.uid)!)
  const fresh = sorted.filter((s) => !rank.has(s.uid))
  return [...fresh, ...known]
}

// A fresh feed carries only the index — bodies live in per-session files. Re-attach the
// bodies we already fetched BEFORE the new feed reaches the store, so a refresh never
// blanks the open session (which would unmount its cycles and collapse what the owner is
// reading). Sessions whose updated_at moved are re-fetched afterwards, in the background.
function attachKnownBodies(codex: KarinData | null, claude: ClaudeRawData | null): {
  codex: KarinData | null
  claude: ClaudeRawData | null
} {
  const nextCodex = codex?.split
    ? { ...codex, sessions: codex.sessions.map((s) => applyCachedBody('codex', s)) }
    : codex
  const nextClaude = claude?.split
    ? {
        ...claude,
        projects: claude.projects.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) => applyCachedBody('claude', s as never) as never),
        })),
      }
    : claude
  return { codex: nextCodex, claude: nextClaude }
}

// Set once the timeline has pulled every body; a later refresh then re-hydrates them all
// instead of silently dropping back to index-only sessions.
let hydratedAll = false

// Recompute the merged list + derived fields from whatever codex/claude/warp are set.
function derive(
  codex: KarinData | null,
  claude: ClaudeRawData | null,
  warp: WarpRawData | null,
  selectedUid: string | null,
) {
  const sessions = frozenOrder(mergeSessions(codex, claude, warp))
  let stillSelected: string | null = null
  if (selectedUid && sessions.some((s) => s.uid === selectedUid)) stillSelected = selectedUid
  return { sessions, generatedAt: freshestGeneratedAt(codex, claude, warp), selectedUid: stillSelected }
}

// Last ETag seen per feed, so the poll can tell "unchanged" from a HEAD alone.
// Module state rather than store state: nothing renders it, and putting it in
// the store would wake every subscriber on each tick.
const lastTags: Record<'codex' | 'claude' | 'warp', string | null> = {
  codex: null,
  claude: null,
  warp: null,
}

function isNewer(candidate: { generated_at: string } | null, current: { generated_at: string } | null): boolean {
  if (!candidate) return false
  if (!current) return true
  return Date.parse(candidate.generated_at) > Date.parse(current.generated_at)
}

export const useKarin = create<KarinStore>((set, get) => ({
  codex: null,
  claude: null,
  warp: null,
  sessions: [],
  generatedAt: null,
  status: null,
  booting: true,
  selectedUid: null,
  search: '',
  sourceFilter: initialSourceFilter(),
  unitMode: initialUnitMode(),
  tokenRef: initialTokenRef(),
  tokenMult: initialTokenMult(),
  currency: initialCurrency(),
  blockScale: initialBlockScale(),
  priceBasis: initialPriceBasis(),
  subDivisors: {
    codex: initialSubDivisor('karin-subdiv-codex', SUB_DIVISOR_DEFAULTS.codex),
    claude: initialSubDivisor('karin-subdiv-claude', SUB_DIVISOR_DEFAULTS.claude),
    warp: initialSubDivisor('karin-subdiv-warp', SUB_DIVISOR_DEFAULTS.warp),
  },
  keepStepsOpen: initialKeepStepsOpen(),
  showStepCounts: initialShowStepCounts(),
  groupByFolder: initialGroupByFolder(),
  theme: initialTheme(),
  view: 'sessions',
  error: null,

  // Startup: prefer the freshest of saved vs local for EACH source, then keep polling.
  boot: async () => {
    applyTheme(get().theme)
    const [saved, localCodex, localClaude, localWarp, status, ...tags] = await Promise.all([
      loadSaved(),
      fetchLocalData(),
      fetchClaudeRaw(),
      fetchWarpRaw(),
      fetchLocalStatus(),
      // Seeded here so the first 5s tick already knows what it just read, and
      // does not re-download every feed once before settling down.
      feedTag(FEED_PATHS.codex),
      feedTag(FEED_PATHS.claude),
      feedTag(FEED_PATHS.warp),
    ])
    if (localCodex) lastTags.codex = tags[0]
    if (localClaude) lastTags.claude = tags[1]
    if (localWarp) lastTags.warp = tags[2]
    const codex = isNewer(localCodex, saved.codex) ? localCodex : saved.codex
    const claude = isNewer(localClaude, saved.claude) ? localClaude : saved.claude
    const warp = isNewer(localWarp, saved.warp) ? localWarp : saved.warp
    if (codex) void saveCodex(codex)
    if (claude) void saveClaude(claude)
    if (warp) void saveWarp(warp)
    set({ codex, claude, warp, status, ...derive(codex, claude, warp, null), booting: false })
    startLocalRefreshLoop()
  },

  setCodexData: (data) => {
    void saveCodex(data)
    set((st) => ({ codex: data, error: null, search: '', ...derive(data, st.claude, st.warp, st.selectedUid) }))
  },

  setClaudeData: (data) => {
    void saveClaude(data)
    set((st) => ({ claude: data, error: null, search: '', ...derive(st.codex, data, st.warp, st.selectedUid) }))
  },

  setWarpData: (data) => {
    void saveWarp(data)
    set((st) => ({ warp: data, error: null, search: '', ...derive(st.codex, st.claude, data, st.selectedUid) }))
  },

  refreshLocalData: async () => {
    const { codex: curCodex, claude: curClaude, warp: curWarp } = get()
    // Cheap HEAD per feed first — see feedTag. A tick where nothing changed now
    // costs three tiny requests instead of ~146 MB of download and parse.
    const [codexTag, claudeTag, warpTag] = await Promise.all([
      feedTag(FEED_PATHS.codex),
      feedTag(FEED_PATHS.claude),
      feedTag(FEED_PATHS.warp),
    ])
    // A null tag means we could not tell — fetch, rather than risk going stale.
    const codexStale = codexTag === null || codexTag !== lastTags.codex
    const claudeStale = claudeTag === null || claudeTag !== lastTags.claude
    const warpStale = warpTag === null || warpTag !== lastTags.warp
    const [localCodex, localClaude, localWarp, status] = await Promise.all([
      codexStale ? fetchLocalData() : Promise.resolve(null),
      claudeStale ? fetchClaudeRaw() : Promise.resolve(null),
      warpStale ? fetchWarpRaw() : Promise.resolve(null),
      fetchLocalStatus(),
    ])
    // Record tags only after a successful read, so a failed fetch retries next tick.
    if (codexStale && localCodex) lastTags.codex = codexTag
    if (claudeStale && localClaude) lastTags.claude = claudeTag
    if (warpStale && localWarp) lastTags.warp = warpTag
    if (status) set({ status })
    const codexNew = isNewer(localCodex, curCodex)
    const claudeNew = isNewer(localClaude, curClaude)
    const warpNew = isNewer(localWarp, curWarp)
    // A body request can briefly fail while the indexer is replacing a split body
    // file, even though the small feed itself has not changed. Retry the selected
    // body's hydration on every poll so one transient read cannot leave the detail
    // stuck at its opening user prompt forever.
    if (!codexNew && !claudeNew && !warpNew) {
      const uid = get().selectedUid
      if (uid) void get().hydrateSelected(uid)
      return
    }
    const warp = warpNew ? localWarp : curWarp
    if (codexNew && localCodex) void saveCodex(localCodex)
    if (claudeNew && localClaude) void saveClaude(localClaude)
    if (warpNew && localWarp) void saveWarp(localWarp)
    // Re-attach known bodies to the fresh index before it ever reaches a component.
    const nextCodex = codexNew ? localCodex : curCodex
    const nextClaude = claudeNew ? localClaude : curClaude
    const { codex, claude } = attachKnownBodies(nextCodex, nextClaude)
    set((st) => ({ codex, claude, warp, error: null, ...derive(codex, claude, warp, st.selectedUid) }))
    // Then pull whatever actually moved: the open session first, and every body if the
    // timeline is relying on them.
    const uid = get().selectedUid
    if (uid) void get().hydrateSelected(uid)
    if (hydratedAll) void get().hydrateAll()
  },

  // The timeline builds cycles for EVERY session, so it needs every body. Bodies are
  // cached after the first fetch, so this is a one-off cost per feed generation; the
  // view shows its normal empty state until it resolves. Batched so a hundred sessions
  // don't open a hundred simultaneous requests.
  hydrateAll: async () => {
    let feedReplacedWhileHydrating = false
    const codex = get().codex
    if (codex?.split) {
      const pending = codex.sessions.filter((s) => needsHydration('codex', s as unknown as Record<string, unknown>))
      const filled = new Map<string, (typeof codex.sessions)[number]>()
      for (let i = 0; i < pending.length; i += 8) {
        const batch = await Promise.all(pending.slice(i, i + 8).map((s) => hydrateSession('codex', s)))
        batch.forEach((s) => filled.set(s.id, s))
      }
      if (filled.size && get().codex === codex) {
        const next = { ...codex, sessions: codex.sessions.map((s) => filled.get(s.id) ?? s) }
        set((st) => ({ codex: next, ...derive(next, st.claude, st.warp, st.selectedUid) }))
      } else if (get().codex !== codex) {
        feedReplacedWhileHydrating = true
      }
    }

    const claude = get().claude
    if (claude?.split) {
      const all = claude.projects.flatMap((p) => p.sessions)
      const pending = all.filter((s) => needsHydration('claude', s as unknown as Record<string, unknown>))
      const filled = new Map<string, (typeof all)[number]>()
      for (let i = 0; i < pending.length; i += 8) {
        const batch = await Promise.all(pending.slice(i, i + 8).map((s) => hydrateSession('claude', s as never)))
        batch.forEach((s) => filled.set((s as { id: string }).id, s as never))
      }
      if (filled.size && get().claude === claude) {
        const next = {
          ...claude,
          projects: claude.projects.map((p) => ({
            ...p,
            sessions: p.sessions.map((s) => filled.get(s.id) ?? s),
          })),
        }
        set((st) => ({ claude: next, ...derive(st.codex, next, st.warp, st.selectedUid) }))
      } else if (get().claude !== claude) {
        feedReplacedWhileHydrating = true
      }
    }
    // A live feed can replace the index while this batch is in flight. Do not mark the
    // stale snapshot complete: immediately retry against the new identity/body set.
    hydratedAll = !feedReplacedWhileHydrating
    if (feedReplacedWhileHydrating) void get().hydrateAll()
  },

  reset: async () => {
    stopLocalRefreshLoop()
    await clearSaved()
    set({ codex: null, claude: null, warp: null, sessions: [], generatedAt: null, status: null, selectedUid: null, search: '', error: null })
  },

  // Selecting a session shows it immediately from the index, then fills in its events.
  // The body swap replaces that session inside the source feed and re-derives, so the
  // detail view re-renders with real cycles once the fetch lands.
  select: (uid) => {
    set({ selectedUid: uid })
    if (uid) void get().hydrateSelected(uid)
  },

  hydrateSelected: async (uid) => {
    const [source, ...rest] = uid.split(':')
    const id = rest.join(':')
    if (source !== 'codex' && source !== 'claude') return

    if (source === 'codex') {
      const data = get().codex
      const session = data?.sessions.find((s) => s.id === id)
      if (!data || !session || !needsHydration('codex', session as unknown as Record<string, unknown>)) return
      const full = await hydrateSession('codex', session)
      if (full === session) return
      // Bail if the feed was replaced by a refresh while we were fetching.
      if (get().codex !== data) return
      const next = { ...data, sessions: data.sessions.map((s) => (s.id === id ? full : s)) }
      set((st) => ({ codex: next, ...derive(next, st.claude, st.warp, st.selectedUid) }))
      return
    }

    const data = get().claude
    if (!data) return
    // Find the one session FIRST. The refresh loop calls this on every idle tick, and the
    // rebuild below spreads ~54 projects and ~880 sessions into fresh objects — allocating
    // all of that several times a second only to discover nothing needed hydrating.
    const target = data.projects.flatMap((p) => p.sessions).find((s) => s.id === id)
    if (!target || !needsHydration('claude', target as unknown as Record<string, unknown>)) return
    const projects = data.projects
    const full = await hydrateSession('claude', target as never)
    if (full === (target as never)) return
    if (get().claude !== data) return
    const next = {
      ...data,
      projects: projects.map((p) => ({
        ...p,
        sessions: p.sessions.map((s) => (s.id === id ? (full as never) : s)),
      })),
    }
    set((st) => ({ claude: next, ...derive(st.codex, next, st.warp, st.selectedUid) }))
  },

  setSearch: (q) => set({ search: q }),
  setSourceFilter: (f) => {
    localStorage.setItem('karin-source', f)
    set({ sourceFilter: f })
  },
  setUnitMode: (m) => {
    localStorage.setItem('karin-unit', m)
    set({ unitMode: m })
  },
  setTokenRef: (r) => {
    localStorage.setItem('karin-tokenref', r)
    set({ tokenRef: r })
  },
  setTokenMult: (n) => {
    localStorage.setItem('karin-tokenmult', String(n))
    set({ tokenMult: n })
  },
  setCurrency: (c) => {
    localStorage.setItem('karin-currency', c)
    set({ currency: c })
  },
  setBlockScale: (b) => {
    localStorage.setItem('karin-blockscale', b)
    set({ blockScale: b })
  },
  setPriceBasis: (b) => {
    localStorage.setItem('karin-pricebasis', b)
    set({ priceBasis: b })
  },
  setSubDivisor: (source, n) => {
    localStorage.setItem(`karin-subdiv-${source}`, String(n))
    set((st) => ({ subDivisors: { ...st.subDivisors, [source]: n } }))
  },
  setKeepStepsOpen: (keep) => {
    localStorage.setItem('karin-keep-steps-open', keep ? '1' : '0')
    set({ keepStepsOpen: keep })
  },
  setShowStepCounts: (show) => {
    localStorage.setItem('karin-show-step-counts', show ? '1' : '0')
    set({ showStepCounts: show })
  },
  setGroupByFolder: (group) => {
    localStorage.setItem('karin-group-folders', group ? '1' : '0')
    set({ groupByFolder: group })
  },
  setError: (msg) => set({ error: msg }),
  setView: (v) => set({ view: v }),

  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('karin-theme', theme)
    applyTheme(theme)
    set({ theme })
  },
}))

let refreshTimer: number | null = null
let refreshStopped = true

// A tick where nothing changed is three HEAD requests (see refreshLocalData), so
// polling fast is cheap. Self-scheduling rather than setInterval: a tick that DID
// change downloads megabytes and can outlast the gap, and overlapping runs would
// pile up. The gap is measured from completion, so the loop can never lap itself.
const REFRESH_GAP_MS = 300
const MAX_REFRESH_GAP_MS = 15_000
// How much idle time to leave per unit of work the last tick cost. A cheap tick
// (three HEADs, ~5ms) keeps the 300ms floor; an expensive one earns a proportional rest.
const REFRESH_DUTY_FACTOR = 6

// The gap AFTER a tick that took `ms`.
//
// A fixed 300ms gap is only cheap while the feeds sit still. When an indexer is actively
// rewriting a ~50 MB feed — which is exactly what happens while you are working, the case
// this app exists to watch — every tick sees a moved tag, re-downloads the feed and
// JSON.parses it on the main thread. At 300ms that is a multi-second freeze restarting
// three times a second, and the whole UI reads as a second behind every click. Backing off
// in proportion to the last tick's cost keeps idle polling instant and caps a churning
// feed at a fraction of the main thread instead of all of it.
function nextRefreshGap(ms: number): number {
  return Math.min(MAX_REFRESH_GAP_MS, Math.max(REFRESH_GAP_MS, Math.round(ms * REFRESH_DUTY_FACTOR)))
}

function startLocalRefreshLoop() {
  if (!refreshStopped) return
  refreshStopped = false
  const tick = async () => {
    const started = performance.now()
    try {
      await useKarin.getState().refreshLocalData()
    } finally {
      const gap = nextRefreshGap(performance.now() - started)
      if (!refreshStopped) refreshTimer = window.setTimeout(() => void tick(), gap)
    }
  }
  refreshTimer = window.setTimeout(() => void tick(), REFRESH_GAP_MS)
}

function stopLocalRefreshLoop() {
  refreshStopped = true
  if (refreshTimer === null) return
  window.clearTimeout(refreshTimer)
  refreshTimer = null
}
