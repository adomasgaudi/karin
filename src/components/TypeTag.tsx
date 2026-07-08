import { cn } from '../lib/cn'

// A small, neutral-ish colored tag for a record `_type`. Colors are muted and
// theme-aware; unknown types fall back to neutral so new record kinds still render.
const TYPE_STYLES: Record<string, string> = {
  user: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  assistant: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  system: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  summary: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  tool_use: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  tool_result: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  thinking: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
}

const FALLBACK = 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'

export default function TypeTag({ type, className }: { type: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 font-mono text-[0.62rem] font-medium leading-none',
        TYPE_STYLES[type] ?? FALLBACK,
        className,
      )}
    >
      {type}
    </span>
  )
}
