import { CalendarClock, LayoutList, ListChecks } from 'lucide-react'
import { useKarin, type View } from '../store/karin'
import { cn } from '../lib/cn'

// App-wide page nav. Sessions / Timeline / Summary are three PAGES, not actions, so they
// read as tabs above every view rather than as buttons inside the sidebar toolbar.
const tabs: { id: View; label: string; icon: typeof CalendarClock; title: string }[] = [
  { id: 'sessions', label: 'Sessions', icon: LayoutList, title: 'Session list and detail' },
  { id: 'timeline', label: 'Timeline', icon: CalendarClock, title: 'Day timeline — sessions as bars across the day' },
  { id: 'summary', label: 'Summary', icon: ListChecks, title: 'What happened across all sessions and where the effort went' },
]

export default function NavBar() {
  const view = useKarin((s) => s.view)
  const setView = useKarin((s) => s.setView)
  return (
    <nav className="flex shrink-0 items-end gap-1 border-b border-neutral-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950">
      {tabs.map((t) => {
        const active = view === t.id
        const Icon = t.icon
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            title={t.title}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs',
              active
                ? 'border-neutral-900 font-medium text-neutral-950 dark:border-neutral-100 dark:text-neutral-50'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}
