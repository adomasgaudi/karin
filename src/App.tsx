import { useEffect } from 'react'
import { useKarin } from './store/karin'
import { cn } from './lib/cn'
import Dropzone from './components/Dropzone'
import Sidebar from './components/Sidebar'
import SessionDetail from './components/SessionDetail'
import TimelinePage from './components/TimelinePage'
import SummaryPage from './components/SummaryPage'
import ChangelogButton from './components/ChangelogButton'
import V2Page from './components/V2Page'
import NavBar from './components/NavBar'

export default function App() {
  const booting = useKarin((s) => s.booting)
  const hasData = useKarin((s) => s.codex != null || s.claude != null || s.warp != null)
  const selectedUid = useKarin((s) => s.selectedUid)
  const view = useKarin((s) => s.view)
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

  if (view === 'v2') return <V2Page />

  if (!hasData)
    return (
      <>
        <Dropzone />
        <ChangelogButton />
      </>
    )

  // One sticky nav above every page; each page fills the rest of the viewport.
  return (
    <>
      <div className="flex h-dvh flex-col bg-neutral-100 dark:bg-black">
        <div className="sticky top-0 z-40">
          <NavBar />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {view === 'timeline' ? (
            <TimelinePage />
          ) : view === 'summary' ? (
            <SummaryPage />
          ) : (
            // Two-pane on md+. On mobile: show the list until a session is picked, then the detail.
            <div className="flex h-full flex-col text-neutral-900 md:flex-row dark:text-neutral-100">
              <Sidebar className={cn('md:flex', selectedUid ? 'hidden md:flex' : 'flex')} />
              <main className={cn('min-w-0 flex-1 flex-col overflow-hidden', selectedUid ? 'flex' : 'hidden md:flex')}>
                <SessionDetail />
              </main>
            </div>
          )}
        </div>
      </div>
      <ChangelogButton />
    </>
  )
}
