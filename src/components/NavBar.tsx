import type { ReactNode } from 'react'
import { CalendarClock, LayoutList, ListChecks } from 'lucide-react'
import { useKarin, type View } from '../store/karin'
import { cn } from '../lib/cn'
import SettingsMenu from './SettingsMenu'
import KarinLogo from './KarinLogo'
import AgeIndicator, { useLiveNow } from './AgeIndicator'
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
  tabs: NavTab<T>[]
  active: T
  onSelect: (id: T) => void
  /** Version label text; clicking it switches to the other Karin version. */
  versionLabel: string
  onVersionClick: () => void
  versionTitle: string
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
  right,
}: NavBarProps<T>) {
  return (
    <nav className="flex shrink-0 items-center gap-0.5 overflow-hidden border-b border-neutral-200 bg-white px-1.5 dark:border-neutral-800 dark:bg-neutral-950">
      <KarinLogo className="h-4 shrink-0" />
      <button
        type="button"
        onClick={onVersionClick}
        title={versionTitle}
        className="mr-1 shrink-0 text-[0.6rem] font-medium text-neutral-400 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100"
      >
        {versionLabel}
      </button>
      {tabs.map((t) => {
        const isActive = active === t.id
        const Icon = t.icon
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
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

export default function NavBar() {
  const view = useKarin((s) => s.view)
  const setView = useKarin((s) => s.setView)
  const sessions = useKarin((s) => s.sessions)
  const now = useLiveNow()
  // Newest prompt across ALL sources — "how long since I last worked".
  const latestPrompt = sessions.reduce<string | null>(
    (max, s) => (s.updated_at && (!max || s.updated_at > max) ? s.updated_at : max),
    null,
  )
  return (
    <NavBarShell
      tabs={tabs}
      active={view}
      onSelect={setView}
      versionLabel={APP_VERSION}
      onVersionClick={() => setView('v2')}
      versionTitle="Open Karin v.2.0 (work in progress)"
      right={
        <>
          <AgeIndicator value={latestPrompt} now={now} className="text-[0.65rem] text-neutral-500" />
          <SettingsMenu />
        </>
      }
    />
  )
}
