import { useMemo, useState } from 'react'
import { Info, X } from 'lucide-react'
import type { Session, UnifiedSession } from '../types'
import type { ClaudeDetailSession } from '../lib/claudeModel'
import { buildCoverageAudit, type CoverageFinding } from '../lib/coverageAudit'
import JsonView from './JsonView'

const panelClass = 'overflow-x-auto rounded-md bg-white/70 dark:bg-neutral-950/55'

function present(counts: Record<string, Record<string, number> | undefined>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const [key, value] of Object.entries(counts)) {
    if (value && Object.keys(value).length) out[key] = value
  }
  return out
}

function lineRanges(lines: number[]): string {
  const sorted = [...new Set(lines)].sort((a, b) => a - b)
  const ranges: string[] = []
  for (const line of sorted) {
    const previous = ranges[ranges.length - 1]
    const match = previous?.match(/^(\d+)(?:–(\d+))?$/)
    if (match && Number(match[2] ?? match[1]) + 1 === line) {
      ranges[ranges.length - 1] = `${match[1]}–${line}`
    } else {
      ranges.push(String(line))
    }
  }
  return ranges.join(', ')
}

function findingTone(finding: CoverageFinding): string {
  if (finding.status === 'parse_error') return 'text-rose-700 dark:text-rose-300'
  if (finding.status === 'unhandled') return 'text-amber-700 dark:text-amber-300'
  if (finding.status === 'reclassified') return 'text-sky-700 dark:text-sky-300'
  return 'text-neutral-600 dark:text-neutral-300'
}

function findingStatus(status: CoverageFinding['status']): string {
  if (status === 'parse_error') return 'parse error'
  return status
}

export default function ContextAudit({ session }: { session: UnifiedSession }) {
  const [open, setOpen] = useState(false)
  const [talliesOpen, setTalliesOpen] = useState(false)
  const coverage = useMemo(() => buildCoverageAudit(session), [session])
  const raw = session.raw as Session | ClaudeDetailSession
  const audit = raw.audit
  if (!audit) return null

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
    <div className="relative flex justify-end">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open context coverage audit"
        aria-expanded={open}
        title="Show which source records are rendered, merged, or unhandled"
        className="inline-flex items-center gap-1 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <Info className="h-3.5 w-3.5" />
        <span className="font-mono text-[0.58rem] tabular-nums">{coverage.rawRecords.toLocaleString()}</span>
      </button>

      {open && (
        <div role="dialog" aria-label="Context coverage audit" className="absolute right-0 top-8 z-30 w-[min(42rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-violet-200 bg-violet-50/95 text-left shadow-xl shadow-neutral-950/10 backdrop-blur dark:border-violet-900/70 dark:bg-violet-950/95">
          <div className="flex items-center gap-2 border-b border-violet-200/70 px-3 py-2 dark:border-violet-900/70">
            <span className="text-xs font-semibold text-violet-950 dark:text-violet-100">Context coverage</span>
            <span className="text-[0.65rem] text-violet-700/80 dark:text-violet-300/80">
              {coverage.rawRecords.toLocaleString()} raw · {coverage.structuredRows.toLocaleString()} structured rows
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close context coverage audit" className="ml-auto rounded p-0.5 text-violet-500 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/60">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-[min(70vh,38rem)] space-y-2 overflow-y-auto px-3 pb-3 pt-2 text-[0.68rem]">
            {!coverage.loaded ? (
              <p className="text-neutral-500 dark:text-neutral-400">The feed body is still loading; exact source lines will appear when it arrives.</p>
            ) : coverage.findings.length === 0 ? (
              <p className="text-emerald-700 dark:text-emerald-300">Every loaded source record has a structured representation.</p>
            ) : (
              <div className="space-y-1">
                <div className="font-medium text-violet-950 dark:text-violet-100">Source lines needing explanation</div>
                {coverage.findings.map((finding) => (
                  <div key={`${finding.status}:${finding.name}:${finding.reason}`} className="rounded-md border border-violet-200/70 bg-white/60 px-2 py-1.5 dark:border-violet-900/60 dark:bg-neutral-950/35">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className={`font-medium ${findingTone(finding)}`}>{findingStatus(finding.status)}</span>
                      <span className="font-medium text-neutral-700 dark:text-neutral-200">{finding.name}</span>
                      <span className="font-mono text-neutral-400 dark:text-neutral-500">×{finding.count}</span>
                      {finding.lines.length > 0 && <span className="font-mono text-neutral-500 dark:text-neutral-400">lines {lineRanges(finding.lines)}</span>}
                    </div>
                    <div className="mt-0.5 leading-relaxed text-neutral-500 dark:text-neutral-400">{finding.reason}</div>
                  </div>
                ))}
              </div>
            )}

            {coverage.notAvailable.length > 0 && (
              <div className="border-t border-violet-200/70 pt-2 dark:border-violet-900/60">
                <div className="font-medium text-neutral-600 dark:text-neutral-300">Not available in local transcripts</div>
                <div className="mt-1 space-y-0.5 text-neutral-500 dark:text-neutral-400">
                  {coverage.notAvailable.map((item) => <div key={item.name}><span className="font-medium">{item.name.replace(/_/g, ' ')}</span> — {item.reason}</div>)}
                </div>
              </div>
            )}

            <div className="border-t border-violet-200/70 pt-2 dark:border-violet-900/60">
              <button type="button" onClick={() => setTalliesOpen((value) => !value)} className="text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
                {talliesOpen ? '▾' : '▸'} Raw transcript tallies
              </button>
              {talliesOpen && <div className={`mt-1 ${panelClass}`}><JsonView value={rawCounts} /></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
