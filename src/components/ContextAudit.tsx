import type { Session, UnifiedSession } from '../types'
import type { ClaudeDetailSession } from '../lib/claudeModel'

const preClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-300'

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

  return (
    <details className="context overflow-hidden rounded-md border border-violet-200/80 bg-violet-50/70 dark:border-violet-900/60 dark:bg-violet-950/25">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-violet-950 [&::-webkit-details-marker]:hidden dark:text-violet-100">
        Context audit
        <span className="ml-2 font-normal text-violet-700/80 dark:text-violet-300/80">
          {visibleCount} visible records / {blindSpotCount} blind spots
        </span>
      </summary>
      <div className="space-y-3 border-t border-violet-200/70 px-3 pb-3 pt-2 dark:border-violet-900/60">
        <div>
          <div className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Visible in {session.source === 'claude' ? 'Claude' : 'Karin'}
          </div>
          <pre className={preClass}>{JSON.stringify(audit.visible, null, 2)}</pre>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Not available locally</div>
          <pre className={preClass}>{JSON.stringify(audit.not_available, null, 2)}</pre>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Raw transcript counts</div>
          <pre className={preClass}>{JSON.stringify(rawCounts, null, 2)}</pre>
        </div>
      </div>
    </details>
  )
}
