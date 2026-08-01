import type { Session, UnifiedSession } from '../types'
import type { ClaudeDetailSession } from '../lib/claudeModel'
import JsonView from './JsonView'

const panelClass = 'overflow-x-auto rounded-md bg-white/70 dark:bg-neutral-950/55'

// Drop empty/absent count maps so the raw-counts block only shows what this source records.
function present(counts: Record<string, Record<string, number> | undefined>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const [k, v] of Object.entries(counts)) {
    if (v && Object.keys(v).length) out[k] = v
  }
  return out
}

export default function ContextAudit({ session }: { session: UnifiedSession }) {
  const audit = (session.raw as Session | ClaudeDetailSession).audit
  if (!audit) return null

  const visibleCount = audit.visible?.reduce((sum, item) => sum + item.count, 0) ?? 0
  const blindSpotCount = audit.not_available?.length ?? 0

  // Each source records a different set of raw tallies — show whichever are present.
  const rawCounts =
    session.source === 'claude'
      ? present({
          'record types': (audit as ClaudeDetailSession['audit']).record_type_counts,
          'content blocks': (audit as ClaudeDetailSession['audit']).content_block_counts,
          roles: audit.role_counts,
          'system subtypes': (audit as ClaudeDetailSession['audit']).system_subtype_counts,
          'attachment types': (audit as ClaudeDetailSession['audit']).attachment_type_counts,
        })
      : present({
          records: (audit as Session['audit']).record_counts,
          'response items': (audit as Session['audit']).response_item_counts,
          roles: audit.role_counts,
          events: (audit as Session['audit']).event_counts,
        })

  // Only buckets that actually recorded something: a list of zeros says nothing about
  // this session, and the empty rows were most of the old panel's height.
  const buckets = (audit.visible ?? []).filter((item) => item.count > 0)

  return (
    <details className="context overflow-hidden rounded-md border border-violet-200/80 bg-violet-50/70 dark:border-violet-900/60 dark:bg-violet-950/25">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-violet-950 [&::-webkit-details-marker]:hidden dark:text-violet-100">
        Context audit
        <span className="ml-2 font-normal text-violet-700/80 dark:text-violet-300/80">
          {visibleCount.toLocaleString()} records
        </span>
      </summary>
      <div className="space-y-2 border-t border-violet-200/70 px-3 pb-3 pt-2 dark:border-violet-900/60">
        {/* count → name, one line each. The old view spent three lines per bucket to
            say what a number and a label say; the `source` string is a fixed
            explanation of the extractor, so it moves to each row's tooltip. */}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
          {buckets.map((item) => (
            <span key={item.name} className="flex items-baseline gap-1.5 text-xs" title={item.source}>
              <span className="font-mono text-neutral-700 dark:text-neutral-200">{item.count.toLocaleString()}</span>
              <span className="text-neutral-500 dark:text-neutral-400">{item.name.replace(/_/g, ' ')}</span>
            </span>
          ))}
        </div>
        {blindSpotCount > 0 && (
          <div className="text-[0.65rem] leading-relaxed text-neutral-400 dark:text-neutral-500">
            Not in any local transcript: {audit.not_available?.map((item) => item.name.replace(/_/g, ' ')).join(', ')}.
          </div>
        )}
        {/* The unmassaged tallies are the part worth keeping — they're how you'd spot a
            record type the indexer doesn't handle — but only when you go looking. */}
        <details>
          <summary className="cursor-pointer select-none text-[0.65rem] text-neutral-400 [&::-webkit-details-marker]:hidden hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">
            Raw transcript tallies
          </summary>
          <div className={`mt-1 ${panelClass}`}><JsonView value={rawCounts} /></div>
        </details>
      </div>
    </details>
  )
}
