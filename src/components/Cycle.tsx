import type { Cycle as CycleData } from '../lib/cycles'
import { cycleCounts, cyclePrompt } from '../lib/cycles'
import EventEntry from './EventEntry'

export default function Cycle({ cycle, index }: { cycle: CycleData; index: number }) {
  return (
    <details
      className="cycle rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 mb-3 overflow-hidden"
      open
    >
      <summary className="bg-neutral-100 dark:bg-neutral-800 px-3 py-2 cursor-pointer select-none text-xs font-medium">
        {`Cycle ${index + 1} · line ${cycle.startLine} · ${cyclePrompt(cycle)}`}
        <span className="ml-2 text-neutral-500 dark:text-neutral-400 font-normal">{cycleCounts(cycle)}</span>
      </summary>
      <div className="p-2">
        {cycle.items.map((entry, i) => (
          <EventEntry key={i} entry={entry} />
        ))}
      </div>
    </details>
  )
}
