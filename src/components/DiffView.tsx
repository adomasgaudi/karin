// Renders structuredPatch hunks as a colored unified diff; falls back to the raw patch
// string when no structured hunks are present. Used by the unified edit card (Claude edits
// carry structured_patch; Codex edits have only a patch string, so they hit the fallback).
import { stripAnsi } from './JsonView'

interface PatchHunk {
  oldStart?: number
  oldLines?: number
  newStart?: number
  newLines?: number
  lines?: string[]
}

function asHunks(structured: unknown): PatchHunk[] | null {
  if (!Array.isArray(structured) || structured.length === 0) return null
  const hunks = structured.filter(
    (h): h is PatchHunk => !!h && typeof h === 'object' && Array.isArray((h as PatchHunk).lines),
  )
  return hunks.length > 0 ? hunks : null
}

export function DiffLines({ lines }: { lines: string[] }) {
  return (
    <div className="w-max min-w-full">
      {lines.map((rawLine, li) => {
        const line = stripAnsi(rawLine)
        const sign = line[0]
        const added = sign === '+' && !line.startsWith('+++')
        const removed = sign === '-' && !line.startsWith('---')
        const hunk = line.startsWith('@@')
        const cls = hunk
          ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300'
          : added
            ? 'border-l-2 border-emerald-500 bg-emerald-100/70 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'
            : removed
              ? 'border-l-2 border-rose-500 bg-rose-100/70 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200'
              : 'border-l-2 border-transparent text-neutral-600 dark:text-neutral-400'
        const content = added || removed || sign === ' ' ? line.slice(1) : line
        return (
          <div key={li} className={`flex min-w-max ${cls}`}>
            <span className="w-5 shrink-0 select-none text-center text-neutral-400 dark:text-neutral-500">
              {added ? '+' : removed ? '−' : ''}
            </span>
            <span className="whitespace-pre">{content || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function DiffView({ structured, patch }: { structured: unknown; patch: string }) {
  const hunks = asHunks(structured)
  if (!hunks) {
    return (
      <div className="overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed dark:bg-neutral-950/55">
        <DiffLines lines={(patch || '(no diff)').split(/\r?\n/)} />
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-md bg-white/70 font-mono text-xs leading-relaxed dark:bg-neutral-950/55">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="border-b border-neutral-200/60 last:border-b-0 dark:border-neutral-800/60">
          <div className="bg-neutral-100/70 px-2 py-0.5 text-[0.6rem] text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400">
            @@ -{hunk.oldStart ?? 0},{hunk.oldLines ?? 0} +{hunk.newStart ?? 0},{hunk.newLines ?? 0} @@
          </div>
          <DiffLines lines={hunk.lines || []} />
        </div>
      ))}
    </div>
  )
}
