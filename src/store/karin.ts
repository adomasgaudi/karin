import { create } from 'zustand'
import type { KarinData, KarinStatus } from '../types'
import { saveData, loadSavedData, clearSavedData } from '../lib/persist'
import { fetchLocalData, fetchLocalStatus } from '../lib/loadData'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  const saved = localStorage.getItem('karin-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

interface KarinStore {
  data: KarinData | null
  status: KarinStatus | null
  booting: boolean
  selectedId: string | null
  search: string
  theme: Theme
  error: string | null

  boot: () => Promise<void>
  setData: (data: KarinData) => void
  refreshLocalData: () => Promise<void>
  reset: () => Promise<void>
  select: (id: string | null) => void
  setSearch: (q: string) => void
  setError: (msg: string | null) => void
  toggleTheme: () => void
}

export const useKarin = create<KarinStore>((set, get) => ({
  data: null,
  status: null,
  booting: true,
  selectedId: null,
  search: '',
  theme: initialTheme(),
  error: null,

  // Startup: prefer the freshest local data, then keep checking while the app is open.
  boot: async () => {
    applyTheme(get().theme)
    const [saved, local, status] = await Promise.all([loadSavedData(), fetchLocalData(), fetchLocalStatus()])
    const data = freshestData(saved, local)
    if (data) {
      await saveData(data)
      set({ data, status: freshestStatus(data, status), selectedId: null, booting: false })
      startLocalRefreshLoop()
      return
    }
    set({ status, booting: false })
    startLocalRefreshLoop()
  },

  setData: (data) => {
    void saveData(data)
    set({ data, status: statusFromData(data), selectedId: null, error: null, search: '' })
  },

  refreshLocalData: async () => {
    const current = get().data
    const [local, status] = await Promise.all([fetchLocalData(), fetchLocalStatus()])
    if (status) set({ status })
    if (!local || !isNewerData(local, current)) return
    await saveData(local)
    const selectedId = local.sessions.some((s) => s.id === get().selectedId) ? get().selectedId : null
    set({ data: local, status: freshestStatus(local, status), selectedId, error: null })
  },

  reset: async () => {
    stopLocalRefreshLoop()
    await clearSavedData()
    set({ data: null, status: null, selectedId: null, search: '', error: null })
  },

  select: (id) => set({ selectedId: id }),
  setSearch: (q) => set({ search: q }),
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

function freshestData(saved: KarinData | null, local: KarinData | null): KarinData | null {
  if (isNewerData(local, saved)) return local
  return saved
}

function isNewerData(candidate: KarinData | null, current: KarinData | null): candidate is KarinData {
  if (!candidate) return false
  if (!current) return true
  return Date.parse(candidate.generated_at) > Date.parse(current.generated_at)
}

function statusFromData(data: KarinData): KarinStatus {
  return {
    last_checked_at: data.last_checked_at ?? data.generated_at,
    last_entry_at: data.last_entry_at ?? data.sessions[0]?.updated_at ?? null,
    session_file_count: data.session_file_count ?? data.session_count,
  }
}

function freshestStatus(data: KarinData, status: KarinStatus | null): KarinStatus {
  const fallback = statusFromData(data)
  if (!status) return fallback
  return {
    last_checked_at: status.last_checked_at ?? fallback.last_checked_at,
    last_entry_at: status.last_entry_at ?? fallback.last_entry_at,
    session_file_count: status.session_file_count ?? fallback.session_file_count,
  }
}
