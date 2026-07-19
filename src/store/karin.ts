import { create } from 'zustand'
import type { KarinData, KarinStatus, UnifiedSession, SessionSource } from '../types'
import type { ClaudeRawData } from '../lib/claudeRaw'
import type { WarpRawData } from '../lib/warpRaw'
import type { UsageUnitMode, CurrencyMode, TokenUnitRef, PriceBasis } from '../lib/pricing'
import { DEFAULT_TOKEN_MULT, SUB_DIVISOR_DEFAULTS } from '../lib/pricing'
import { saveCodex, saveClaude, saveWarp, loadSaved, clearSaved } from '../lib/persist'
import { fetchLocalData, fetchClaudeRaw, fetchWarpRaw, fetchLocalStatus } from '../lib/loadData'
import { mergeSessions } from '../lib/adapt'

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
  return saved === 'codex' || saved === 'claude' || saved === 'warp' ? saved : 'all'
}

// One global usage-unit toggle drives EVERY token display (sidebar totals + bars,
// session detail, cycles) so switching it re-expresses all instances at once.
function initialUnitMode(): UsageUnitMode {
  const saved = localStorage.getItem('karin-unit')
  return saved === 'tokens' || saved === 'token_units' || saved === 'money' ? saved : 'token_units'
}

// Which token type token_units mode normalizes against (independent of currency).
function initialTokenRef(): TokenUnitRef {
  const saved = localStorage.getItem('karin-tokenref')
  return saved === 'input' || saved === 'cached' || saved === 'output' || saved === 'scaled' ? saved : 'output'
}

// Multiplier for the 'scaled' reference (see pricing.ts).
function initialTokenMult(): number {
  const saved = Number(localStorage.getItem('karin-tokenmult'))
  return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_TOKEN_MULT
}

function initialCurrency(): CurrencyMode {
  const saved = localStorage.getItem('karin-currency')
  return saved === 'usd' || saved === 'usd_cents' || saved === 'eur' || saved === 'eur_cents' ? saved : 'usd'
}

// Which price the money mode shows: theoretical API list price, or the subscription
// plan estimate. Defaults to the plan estimate — the number the owner actually cares about.
function initialPriceBasis(): PriceBasis {
  const saved = localStorage.getItem('karin-pricebasis')
  return saved === 'api' || saved === 'sub' ? saved : 'sub'
}

// Divisor applied to API list price for the 'sub' plan estimate — SEPARATE per source,
// because a Codex (ChatGPT) plan and a Claude (Max) plan have different prices, allowances
// and model mixes, so their subscription-vs-API ratios differ. Migrates the old shared key.
function initialSubDivisor(key: string, fallback: number): number {
  const saved = Number(localStorage.getItem(key))
  if (Number.isFinite(saved) && saved > 0) return saved
  const legacy = Number(localStorage.getItem('karin-subdiv'))
  return Number.isFinite(legacy) && legacy > 0 ? legacy : fallback
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
  priceBasis: PriceBasis
  subDivisors: Record<SessionSource, number>
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
  setSearch: (q: string) => void
  setSourceFilter: (f: SourceFilter) => void
  setUnitMode: (m: UsageUnitMode) => void
  setTokenRef: (r: TokenUnitRef) => void
  setTokenMult: (n: number) => void
  setCurrency: (c: CurrencyMode) => void
  setPriceBasis: (b: PriceBasis) => void
  setSubDivisor: (source: SessionSource, n: number) => void
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

// Recompute the merged list + derived fields from whatever codex/claude/warp are set.
function derive(
  codex: KarinData | null,
  claude: ClaudeRawData | null,
  warp: WarpRawData | null,
  selectedUid: string | null,
) {
  const sessions = frozenOrder(mergeSessions(codex, claude, warp))
  const stillSelected = selectedUid && sessions.some((s) => s.uid === selectedUid) ? selectedUid : null
  return { sessions, generatedAt: freshestGeneratedAt(codex, claude, warp), selectedUid: stillSelected }
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
  priceBasis: initialPriceBasis(),
  subDivisors: {
    codex: initialSubDivisor('karin-subdiv-codex', SUB_DIVISOR_DEFAULTS.codex),
    claude: initialSubDivisor('karin-subdiv-claude', SUB_DIVISOR_DEFAULTS.claude),
    warp: initialSubDivisor('karin-subdiv-warp', SUB_DIVISOR_DEFAULTS.warp),
  },
  theme: initialTheme(),
  view: 'sessions',
  error: null,

  // Startup: prefer the freshest of saved vs local for EACH source, then keep polling.
  boot: async () => {
    applyTheme(get().theme)
    const [saved, localCodex, localClaude, localWarp, status] = await Promise.all([
      loadSaved(),
      fetchLocalData(),
      fetchClaudeRaw(),
      fetchWarpRaw(),
      fetchLocalStatus(),
    ])
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
    const [localCodex, localClaude, localWarp, status] = await Promise.all([
      fetchLocalData(),
      fetchClaudeRaw(),
      fetchWarpRaw(),
      fetchLocalStatus(),
    ])
    if (status) set({ status })
    const codexNew = isNewer(localCodex, curCodex)
    const claudeNew = isNewer(localClaude, curClaude)
    const warpNew = isNewer(localWarp, curWarp)
    if (!codexNew && !claudeNew && !warpNew) return
    const codex = codexNew ? localCodex : curCodex
    const claude = claudeNew ? localClaude : curClaude
    const warp = warpNew ? localWarp : curWarp
    if (codexNew && localCodex) void saveCodex(localCodex)
    if (claudeNew && localClaude) void saveClaude(localClaude)
    if (warpNew && localWarp) void saveWarp(localWarp)
    set((st) => ({ codex, claude, warp, error: null, ...derive(codex, claude, warp, st.selectedUid) }))
  },

  reset: async () => {
    stopLocalRefreshLoop()
    await clearSaved()
    set({ codex: null, claude: null, warp: null, sessions: [], generatedAt: null, status: null, selectedUid: null, search: '', error: null })
  },

  select: (uid) => set({ selectedUid: uid }),
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
  setPriceBasis: (b) => {
    localStorage.setItem('karin-pricebasis', b)
    set({ priceBasis: b })
  },
  setSubDivisor: (source, n) => {
    localStorage.setItem(`karin-subdiv-${source}`, String(n))
    set((st) => ({ subDivisors: { ...st.subDivisors, [source]: n } }))
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

function startLocalRefreshLoop() {
  if (refreshTimer !== null) return
  refreshTimer = window.setInterval(() => {
    void useKarin.getState().refreshLocalData()
  }, 5000)
}

function stopLocalRefreshLoop() {
  if (refreshTimer === null) return
  window.clearInterval(refreshTimer)
  refreshTimer = null
}
