// Renders structuredPatch hunks as a colored unified diff; falls back to the raw patch
// string when no structured hunks are present. Used by the unified edit card (Claude edits
// carry structured_patch; Codex edits have only a patch string, so they hit the fallback).

const preClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-300'

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

export default function DiffView({ structured, patch }: { structured: unknown; patch: string }) {
  const hunks = asHunks(structured)
  if (!hunks) {
    return <pre className={preClass}>{patch || '(no diff)'}</pre>
  }
  return (
    <div className="overflow-x-auto rounded-md bg-white/70 font-mono text-xs leading-relaxed dark:bg-neutral-950/55">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="border-b border-neutral-200/60 last:border-b-0 dark:border-neutral-800/60">
          <div className="bg-neutral-100/70 px-2 py-0.5 text-[0.6rem] text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400">
            @@ -{hunk.oldStart ?? 0},{hunk.oldLines ?? 0} +{hunk.newStart ?? 0},{hunk.newLines ?? 0} @@
          </div>
          {(hunk.lines || []).map((line, li) => {
            const sign = line[0]
            const cls =
              sign === '+'
                ? 'bg-emerald-100/60 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : sign === '-'
                  ? 'bg-rose-100/60 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                  : 'text-neutral-600 dark:text-neutral-400'
            return (
              <div key={li} className={`whitespace-pre px-2 ${cls}`}>
                {line || ' '}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
