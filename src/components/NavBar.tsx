import { useState, type ReactNode } from 'react'
import { CalendarClock, LayoutList, ListChecks, Menu, X } from 'lucide-react'
import { useKarin, type View } from '../store/karin'
import { cn } from '../lib/cn'
import SettingsMenu from './SettingsMenu'
import WatcherStatus from './WatcherStatus'
import KarinLogo from './KarinLogo'
import { APP_VERSION } from '../lib/appVersion'

// ONE nav scaffold for both Karin versions: logo, version toggle, tab strip, right slot.
// v.1 and v.2 differ in which tabs and which settings they pass in — never in the frame,
// so the chrome can't drift between them.
export interface NavTab<T extends string = string> {
  id: T
  label: string
  icon?: typeof CalendarClock
  title?: string
  disabled?: boolean
}

interface NavBarProps<T extends string> {
  /** Optional: v.2 puts its own controls in a sticky bar below, so its nav has no tabs. */
  tabs?: NavTab<T>[]
  active?: T
  onSelect?: (id: T) => void
  /** Version label text; clicking it switches to the other Karin version. */
  versionLabel: string
  onVersionClick: () => void
  versionTitle: string
  /** Optional action for the Karin glasses mark. */
  onLogoClick?: () => void
  /** Optional centered status slot, independent of the left and right controls. */
  center?: ReactNode
  /** Right-hand slot — each version's own settings/status. */
  right?: ReactNode
}

export function NavBarShell<T extends string>({
  tabs,
  active,
  onSelect,
  versionLabel,
  onVersionClick,
  versionTitle,
  onLogoClick,
  center,
  right,
}: NavBarProps<T>) {
  // The bar must NOT be overflow-hidden: the settings popover is absolutely positioned
  // inside it, so clipping the bar clips the menu — it opens and is invisible.
  return (
    <nav className="relative z-40 flex shrink-0 flex-nowrap items-center gap-0.5 border-b border-neutral-200 bg-white px-1.5 dark:border-neutral-800 dark:bg-neutral-950">
      {onLogoClick ? (
        <button
          type="button"
          onClick={onLogoClick}
          aria-label="Back to sessions"
          title="Back to sessions"
          className="shrink-0 rounded-sm p-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <KarinLogo className="h-4" />
        </button>
      ) : (
        <KarinLogo className="h-4 shrink-0" />
      )}
      <button
        type="button"
        onClick={onVersionClick}
        title={versionTitle}
        className="mr-1 shrink-0 text-[0.6rem] font-medium text-neutral-400 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100"
      >
        {versionLabel}
      </button>
      {(tabs ?? []).map((t) => {
        const isActive = active === t.id
        const Icon = t.icon
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect?.(t.id)}
            disabled={t.disabled}
            title={t.title}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 border-b-2 px-1.5 py-1 text-[0.7rem] disabled:opacity-30',
              isActive
                ? 'border-neutral-900 font-medium text-neutral-950 dark:border-neutral-100 dark:text-neutral-50'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {t.label}
          </button>
        )
      })}
      {center && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap">
          {center}
        </div>
      )}
      {right && <div className="ml-auto flex shrink-0 items-center gap-1">{right}</div>}
    </nav>
  )
}

// v.1's instance: the three pages, plus freshness and the app settings menu.
const tabs: NavTab<View>[] = [
  { id: 'sessions', label: 'Sessions', icon: LayoutList, title: 'Session list and detail' },
  { id: 'timeline', label: 'Timeline', icon: CalendarClock, title: 'Day timeline — sessions as bars across the day' },
  { id: 'summary', label: 'Summary', icon: ListChecks, title: 'What happened across all sessions and where the effort went' },
]

function ViewMenu({ active, onSelect }: { active: View; onSelect: (view: View) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Open page navigation"
        title="Pages: Sessions, Timeline, Summary"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>
      {open && (
        <>
          <div aria-hidden="true" className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 max-h-[calc(100dvh-3rem)] w-44 overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            {tabs.map(({ id, label, icon: Icon, title }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onSelect(id)
                  setOpen(false)
                }}
                title={title}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  active === id ? 'font-semibold text-neutral-950 dark:text-neutral-50' : 'text-neutral-600 dark:text-neutral-300',
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function NavBar() {
  const view = useKarin((s) => s.view)
  const setView = useKarin((s) => s.setView)
  // The global "newest prompt anywhere" stamp used to sit in the middle of this bar, one
  // line above the selected session's own age — the same string twice whenever the newest
  // session was open. The session header keeps the one that is actually about what's shown.
  return (
    <NavBarShell
      versionLabel={APP_VERSION}
      onVersionClick={() => setView('v2')}
      versionTitle="Open Karin v.2.0 (work in progress)"
      onLogoClick={() => useKarin.getState().select(null)}
      right={
        <>
          <ViewMenu active={view} onSelect={setView} />
          <WatcherStatus />
          <SettingsMenu />
        </>
      }
    />
  )
}
