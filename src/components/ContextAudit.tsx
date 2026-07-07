import type { Session } from '../types'

const preClass = 'bg-neutral-100 dark:bg-neutral-800 rounded-md text-xs p-2 overflow-x-auto'

export default function ContextAudit({ session }: { session: Session }) {
  const audit = session.audit
  if (!audit) return null

  return (
    <details className="context rounded-md border border-neutral-200 dark:border-neutral-800 border-l-4 border-l-violet-400 bg-violet-50 dark:bg-violet-950/40 mb-2 overflow-hidden">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
        Context audit — visible context &amp; known blind spots
      </summary>
      <div className="px-3 pb-3 space-y-2">
        <div>
          <strong>Visible in Karin</strong>
          <pre className={preClass}>{JSON.stringify(audit.visible, null, 2)}</pre>
        </div>
        <div>
          <strong>Not available from local transcript</strong>
          <pre className={preClass}>{JSON.stringify(audit.not_available, null, 2)}</pre>
        </div>
        <div>
          <strong>Raw transcript counts</strong>
          <pre className={preClass}>
            {JSON.stringify(
              {
                records: audit.record_counts,
                'response items': audit.response_item_counts,
                roles: audit.role_counts,
                events: audit.event_counts,
              },
              null,
              2,
            )}
          </pre>
        </div>
      </div>
    </details>
  )
}
