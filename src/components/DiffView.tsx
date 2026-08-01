// Renders structuredPatch hunks as a colored unified diff; falls back to the raw patch
// string when no structured hunks are present. Used by the unified edit card (Claude edits
// carry structured_patch; Codex edits have only a patch string, so they hit the fallback).
import { stripAnsi } from './JsonView'

interface PatchHunk {
  file?: string
  header?: string
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

// Codex commonly invokes apply_patch from an `exec` wrapper, so its normalized edit
// contains `const patch = "*** Begin Patch\\n..."` rather than Claude's structuredPatch.
// Recover the same file/hunk shape here instead of making the renderer show the wrapper.
function parseApplyPatch(raw: string): PatchHunk[] | null {
  let text = stripAnsi(raw || '')
  const begin = text.indexOf('*** Begin Patch')
  if (begin < 0) return null
  text = text.slice(begin)
  const end = text.indexOf('*** End Patch')
  if (end >= 0) text = text.slice(0, end)
  if (!text.includes('\n') && text.includes('\\n')) {
    text = text.replace(/\\r?\\n/g, '\n').replace(/\\"/g, '"')
  }

  const hunks: PatchHunk[] = []
  let file: string | undefined
  let current: PatchHunk | null = null
  const flush = () => {
    if (current && current.lines && current.lines.length > 0) hunks.push(current)
    current = null
  }
  for (const line of text.split(/\r?\n/)) {
    const fileMatch = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/.exec(line)
    if (fileMatch) {
      flush()
      file = fileMatch[1].trim()
      continue
    }
    if (line.startsWith('@@')) {
      flush()
      const header = line.trim()
      const match = /@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?/.exec(header)
      current = {
        file,
        header,
        oldStart: match ? Number(match[1]) : undefined,
        oldLines: match ? Number(match[2] ?? 1) : undefined,
        newStart: match ? Number(match[3]) : undefined,
        newLines: match ? Number(match[4] ?? 1) : undefined,
        lines: [line],
      }
      continue
    }
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
      if (!current) current = { file, lines: [] }
      current.lines?.push(line)
    }
  }
  flush()
  return hunks.length ? hunks : null
}

// `oldStart`/`newStart` turn on the line-number gutter: a removed line is numbered in
// the OLD file, everything else in the new one, which is the number you would jump to.
// Without them the gutter is omitted entirely (a bare patch has nothing to count from).
export function DiffLines({ lines, oldStart, newStart }: { lines: string[]; oldStart?: number; newStart?: number }) {
  const numbered = oldStart !== undefined && newStart !== undefined
  let oldNo = oldStart ?? 0
  let newNo = newStart ?? 0
  return (
    <div className="w-max min-w-full">
      {lines.map((rawLine, li) => {
        const line = stripAnsi(rawLine)
        const sign = line[0]
        const added = sign === '+' && !line.startsWith('+++')
        const removed = sign === '-' && !line.startsWith('---')
        const hunk = line.startsWith('@@')
        let lineNo = 0
        if (numbered && !hunk) {
          if (added) lineNo = newNo++
          else if (removed) lineNo = oldNo++
          else {
            lineNo = newNo++
            oldNo++
          }
        }
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
            {numbered && (
              <span className="w-10 shrink-0 select-none pr-2 text-right text-neutral-400 tabular-nums dark:text-neutral-600">
                {lineNo || ''}
              </span>
            )}
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
  const hunks = asHunks(structured) ?? parseApplyPatch(patch)
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
          {hunk.file && <div className="border-b border-neutral-200/60 bg-neutral-50 px-2 py-0.5 text-[0.6rem] text-neutral-500 dark:border-neutral-800/60 dark:bg-neutral-950/50 dark:text-neutral-400">{hunk.file}</div>}
          <div className="bg-neutral-100/70 px-2 py-0.5 text-[0.6rem] text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400">
            {hunk.header ?? `@@ -${hunk.oldStart ?? 0},${hunk.oldLines ?? 0} +${hunk.newStart ?? 0},${hunk.newLines ?? 0} @@`}
          </div>
          <DiffLines lines={hunk.lines || []} />
        </div>
      ))}
    </div>
  )
}
