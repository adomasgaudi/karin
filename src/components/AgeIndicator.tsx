import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { shortAge } from '../lib/format'

// Shared live clock — re-renders every 30s so the ages tick without a reload.
export function useLiveNow(intervalMs = 30000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

interface AgeIndicatorProps {
  value: string | null | undefined
  now?: Date
  className?: string
}

// Single live value: relative age since the last prompt, e.g. "37m ago".
export default function AgeIndicator({ value, now, className }: AgeIndicatorProps) {
  const fallback = useLiveNow()
  const at = now ?? fallback
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 font-semibold text-neutral-600 dark:text-neutral-300',
        className,
      )}
    >
      <span className="tabular-nums text-neutral-900 dark:text-neutral-50">{shortAge(value, at)}</span>
      <span className="font-normal text-neutral-400 dark:text-neutral-500">ago</span>
    </span>
  )
}
