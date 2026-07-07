import { useEffect } from 'react'
import { useKarin } from './store/karin'
import { cn } from './lib/cn'
import Dropzone from './components/Dropzone'
import Sidebar from './components/Sidebar'
import SessionDetail from './components/SessionDetail'

export default function App() {
  const booting = useKarin((s) => s.booting)
  const data = useKarin((s) => s.data)
  const selectedId = useKarin((s) => s.selectedId)
  const boot = useKarin((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  if (booting) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-50 text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
        <span className="animate-pulse text-sm tracking-wide">Loading Karin…</span>
      </div>
    )
  }

  if (!data) return <Dropzone />

  // Two-pane on md+. On mobile: show the list until a session is picked, then the detail.
  return (
    <div className="flex h-dvh flex-col bg-neutral-100 text-neutral-900 md:flex-row dark:bg-black dark:text-neutral-100">
      <Sidebar className={cn('md:flex', selectedId ? 'hidden md:flex' : 'flex')} />
      <main className={cn('min-w-0 flex-1 flex-col overflow-hidden', selectedId ? 'flex' : 'hidden md:flex')}>
        <SessionDetail />
      </main>
    </div>
  )
}
