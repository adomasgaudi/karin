import { create } from 'zustand'
import type { KarinData } from '../types'
import { saveData, loadSavedData, clearSavedData } from '../lib/persist'
import { fetchLocalData } from '../lib/loadData'

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
  booting: boolean
  selectedId: string | null
  search: string
  theme: Theme
  error: string | null

  boot: () => Promise<void>
  setData: (data: KarinData) => void
  reset: () => Promise<void>
  select: (id: string | null) => void
  setSearch: (q: string) => void
  setError: (msg: string | null) => void
  toggleTheme: () => void
}

export const useKarin = create<KarinStore>((set, get) => ({
  data: null,
  booting: true,
  selectedId: null,
  search: '',
  theme: initialTheme(),
  error: null,

  // Startup: apply theme, then try IndexedDB, then auto-load local dev data.
  boot: async () => {
    applyTheme(get().theme)
    const saved = await loadSavedData()
    if (saved) {
      set({ data: saved, selectedId: saved.sessions[0]?.id ?? null, booting: false })
      return
    }
    const local = await fetchLocalData()
    if (local) {
      await saveData(local)
      set({ data: local, selectedId: local.sessions[0]?.id ?? null, booting: false })
      return
    }
    set({ booting: false })
  },

  setData: (data) => {
    void saveData(data)
    set({ data, selectedId: data.sessions[0]?.id ?? null, error: null, search: '' })
  },

  reset: async () => {
    await clearSavedData()
    set({ data: null, selectedId: null, search: '', error: null })
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
