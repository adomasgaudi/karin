import { create } from 'zustand'
import type { KarinData, KarinStatus, UnifiedSession } from '../types'
import type { ClaudeRawData } from '../lib/claudeRaw'
import type { UsageUnitMode, CurrencyMode, TokenUnitRef } from '../lib/pricing'
import { saveCodex, saveClaude, loadSaved, clearSaved } from '../lib/persist'
import { fetchLocalData, fetchClaudeRaw, fetchLocalStatus } from '../lib/loadData'
import { mergeSessions } from '../lib/adapt'

type Theme = 'light' | 'dark'
export type SourceFilter = 'all' | 'codex' | 'claude'

function initialTheme(): Theme {
  const saved = localStorage.getItem('karin-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function initialSourceFilter(): SourceFilter {
  const saved = localStorage.getItem('karin-source')
  return saved === 'codex' || saved === 'claude' ? saved : 'all'
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
  return saved === 'input' || saved === 'cached' || saved === 'output' ? saved : 'output'
}

function initialCurrency(): CurrencyMode {
  const saved = localStorage.getItem('karin-currency')
  return saved === 'usd' || saved === 'usd_cents' || saved === 'eur' || saved === 'eur_cents' ? saved : 'usd'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

interface KarinStore {
  codex: KarinData | null
  claude: ClaudeRawData | null
  sessions: UnifiedSession[] // merged, most-recent first
  generatedAt: string | null
  status: KarinStatus | null
  booting: boolean
  selectedUid: string | null
  search: string
  sourceFilter: SourceFilter
  unitMode: UsageUnitMode
  tokenRef: TokenUnitRef
  currency: CurrencyMode
  theme: Theme
  error: string | null

  boot: () => Promise<void>
  setCodexData: (data: KarinData) => void
  setClaudeData: (data: ClaudeRawData) => void
  refreshLocalData: () => Promise<void>
  reset: () => Promise<void>
  select: (uid: string | null) => void
  setSearch: (q: string) => void
  setSourceFilter: (f: SourceFilter) => void
  setUnitMode: (m: UsageUnitMode) => void
  setTokenRef: (r: TokenUnitRef) => void
  setCurrency: (c: CurrencyMode) => void
  setError: (msg: string | null) => void
  toggleTheme: () => void
}

// Freshest of the two generated-at stamps — the "generated" time shown in the header.
function freshestGeneratedAt(codex: KarinData | null, claude: ClaudeRawData | null): string | null {
  const stamps = [codex?.generated_at, claude?.generated_at].filter(Boolean) as string[]
  if (stamps.length === 0) return null
  return stamps.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
}

// Recompute the merged list + derived fields from whatever codex/claude are set.
function derive(codex: KarinData | null, claude: ClaudeRawData | null, selectedUid: string | null) {
  const sessions = mergeSessions(codex, claude)
  const stillSelected = selectedUid && sessions.some((s) => s.uid === selectedUid) ? selectedUid : null
  return { sessions, generatedAt: freshestGeneratedAt(codex, claude), selectedUid: stillSelected }
}

function isNewer(candidate: { generated_at: string } | null, current: { generated_at: string } | null): boolean {
  if (!candidate) return false
  if (!current) return true
  return Date.parse(candidate.generated_at) > Date.parse(current.generated_at)
}

export const useKarin = create<KarinStore>((set, get) => ({
  codex: null,
  claude: null,
  sessions: [],
  generatedAt: null,
  status: null,
  booting: true,
  selectedUid: null,
  search: '',
  sourceFilter: initialSourceFilter(),
  unitMode: initialUnitMode(),
  tokenRef: initialTokenRef(),
  currency: initialCurrency(),
  theme: initialTheme(),
  error: null,

  // Startup: prefer the freshest of saved vs local for EACH source, then keep polling.
  boot: async () => {
    applyTheme(get().theme)
    const [saved, localCodex, localClaude, status] = await Promise.all([
      loadSaved(),
      fetchLocalData(),
      fetchClaudeRaw(),
      fetchLocalStatus(),
    ])
    const codex = isNewer(localCodex, saved.codex) ? localCodex : saved.codex
    const claude = isNewer(localClaude, saved.claude) ? localClaude : saved.claude
    if (codex) void saveCodex(codex)
    if (claude) void saveClaude(claude)
    set({ codex, claude, status, ...derive(codex, claude, null), booting: false })
    startLocalRefreshLoop()
  },

  setCodexData: (data) => {
    void saveCodex(data)
    set((st) => ({ codex: data, error: null, search: '', ...derive(data, st.claude, st.selectedUid) }))
  },

  setClaudeData: (data) => {
    void saveClaude(data)
    set((st) => ({ claude: data, error: null, search: '', ...derive(st.codex, data, st.selectedUid) }))
  },

  refreshLocalData: async () => {
    const { codex: curCodex, claude: curClaude } = get()
    const [localCodex, localClaude, status] = await Promise.all([
      fetchLocalData(),
      fetchClaudeRaw(),
      fetchLocalStatus(),
    ])
    if (status) set({ status })
    const codexNew = isNewer(localCodex, curCodex)
    const claudeNew = isNewer(localClaude, curClaude)
    if (!codexNew && !claudeNew) return
    const codex = codexNew ? localCodex : curCodex
    const claude = claudeNew ? localClaude : curClaude
    if (codexNew && localCodex) void saveCodex(localCodex)
    if (claudeNew && localClaude) void saveClaude(localClaude)
    set((st) => ({ codex, claude, error: null, ...derive(codex, claude, st.selectedUid) }))
  },

  reset: async () => {
    stopLocalRefreshLoop()
    await clearSaved()
    set({ codex: null, claude: null, sessions: [], generatedAt: null, status: null, selectedUid: null, search: '', error: null })
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
  setCurrency: (c) => {
    localStorage.setItem('karin-currency', c)
    set({ currency: c })
  },
  setError: (msg) => set({ error: msg }),

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
