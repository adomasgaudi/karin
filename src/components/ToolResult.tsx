import type { ReactNode } from 'react'
import type { ClaudeTool } from '../lib/claudeModel'

// Structural renderer for a Claude tool_use result. Dispatches on `tool.name` to render
// `tool.result?.raw` in a shape that fits the tool (stdout/stderr, unified diff, file
// content, filename lists, todo checklist, agent status, chosen answer …), always with the
// call's Input (pretty JSON of `tool.input`) shown above. Everything is best-effort over an
// `unknown` payload: unrecognised or malformed data falls back to pretty JSON / flat text.

// --- shared classes (mirror EventEntry.tsx) --------------------------------
const preClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-300'
const labelClass = 'text-xs font-semibold text-neutral-600 dark:text-neutral-300'
const diffPreClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed dark:bg-neutral-950/55'

// --- safe accessors over unknown -------------------------------------------
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isArr = (v: unknown): v is unknown[] => Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const get = (v: unknown, key: string): unknown => (isObj(v) ? v[key] : undefined)

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

// --- small building blocks -------------------------------------------------
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className={labelClass}>{label}</div>
      {children}
    </div>
  )
}

function Badge({ tone, children }: { tone: 'red' | 'neutral' | 'green'; children: ReactNode }) {
  const tones = {
    red: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    neutral: 'bg-neutral-200/80 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  }
  return (
    <span className={`inline-block rounded-sm px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  )
}

function KV({ rows }: { rows: Array<[string, ReactNode]> }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!shown.length) return null
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <span className="font-mono text-neutral-500 dark:text-neutral-400">{k}</span>
          <span className="min-w-0 break-words text-neutral-700 dark:text-neutral-300">{v}</span>
        </div>
      ))}
    </div>
  )
}

function FileList({ files }: { files: unknown[] }) {
  if (!files.length) return <div className="text-xs italic text-neutral-400 dark:text-neutral-500">no matches</div>
  return (
    <ul className="space-y-0.5">
      {files.map((f, i) => (
        <li key={i} className="truncate font-mono text-xs text-neutral-700 dark:text-neutral-300">
          {str(f)}
        </li>
      ))}
    </ul>
  )
}

// --- unified diff from structuredPatch hunks -------------------------------
interface Hunk {
  oldStart?: number
  oldLines?: number
  newStart?: number
  newLines?: number
  lines?: unknown[]
}

function readHunks(raw: unknown): Hunk[] {
  const sp = get(raw, 'structuredPatch')
  return isArr(sp) ? (sp as Hunk[]) : []
}

function DiffView({ hunks }: { hunks: Hunk[] }) {
  return (
    <div className={diffPreClass}>
      <div className="w-max">
        {hunks.map((h, hi) => {
          const header = `@@ -${h.oldStart ?? 0},${h.oldLines ?? 0} +${h.newStart ?? 0},${h.newLines ?? 0} @@`
          const lines = isArr(h.lines) ? h.lines : []
          return (
            <div key={hi}>
              <div className="whitespace-pre text-cyan-700 dark:text-cyan-400">{header}</div>
              {lines.map((raw, li) => {
                const line = str(raw)
                const c = line[0]
                const cls =
                  c === '+'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : c === '-'
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-neutral-600 dark:text-neutral-400'
                return (
                  <div key={li} className={`whitespace-pre ${cls}`}>
                    {line || ' '}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// --- per-tool bodies -------------------------------------------------------
function ShellBody({ raw }: { raw: unknown }) {
  const stdout = str(get(raw, 'stdout'))
  const stderr = str(get(raw, 'stderr'))
  const interrupted = get(raw, 'interrupted') === true
  const hasAny = stdout || stderr || interrupted
  if (!hasAny) return <FallbackBody raw={raw} />
  return (
    <div className="space-y-2">
      {interrupted && <Badge tone="red">interrupted</Badge>}
      {stdout && (
        <Section label="stdout">
          <pre className={preClass}>{stdout}</pre>
        </Section>
      )}
      {stderr && (
        <Section label="stderr">
          <pre className={`${preClass} text-red-600 dark:text-red-400`}>{stderr}</pre>
        </Section>
      )}
      {!stdout && !stderr && !interrupted && (
        <div className="text-xs italic text-neutral-400 dark:text-neutral-500">no output</div>
      )}
    </div>
  )
}

function EditBody({ raw }: { raw: unknown }) {
  const hunks = readHunks(raw)
  if (!hunks.length) return <FallbackBody raw={raw} />
  return (
    <Section label="Diff">
      <DiffView hunks={hunks} />
    </Section>
  )
}

function WriteBody({ raw }: { raw: unknown }) {
  const hunks = readHunks(raw)
  if (hunks.length) {
    return (
      <Section label="Diff">
        <DiffView hunks={hunks} />
      </Section>
    )
  }
  const content = str(get(raw, 'content'))
  return (
    <div className="space-y-2">
      <Badge tone="green">new file</Badge>
      {content && (
        <Section label="Content">
          <pre className={preClass}>{content}</pre>
        </Section>
      )}
    </div>
  )
}

function ReadBody({ raw, text }: { raw: unknown; text: string }) {
  const fileContent = str(get(get(raw, 'file'), 'content'))
  const body = fileContent || (typeof raw === 'string' ? raw : '') || text
  if (!body) return <FallbackBody raw={raw} />
  return (
    <Section label="File content">
      <pre className={preClass}>{body}</pre>
    </Section>
  )
}

function GrepBody({ raw, text }: { raw: unknown; text: string }) {
  const filenames = get(raw, 'filenames')
  if (isArr(filenames)) {
    const numMatches = get(raw, 'numFiles')
    return (
      <Section label={numMatches != null ? `Files (${str(numMatches)})` : 'Files'}>
        <FileList files={filenames} />
      </Section>
    )
  }
  const content = str(get(raw, 'content')) || text
  if (content) {
    return (
      <Section label="Matches">
        <pre className={preClass}>{content}</pre>
      </Section>
    )
  }
  return <FallbackBody raw={raw} />
}

function GlobBody({ raw }: { raw: unknown }) {
  const filenames = get(raw, 'filenames')
  if (isArr(filenames)) {
    return (
      <Section label={`Files (${filenames.length})`}>
        <FileList files={filenames} />
      </Section>
    )
  }
  return <FallbackBody raw={raw} />
}

interface Todo {
  content?: unknown
  status?: unknown
}

function statusMark(status: string): { mark: string; cls: string } {
  switch (status) {
    case 'completed':
      return { mark: '[x]', cls: 'text-emerald-700 dark:text-emerald-400' }
    case 'in_progress':
      return { mark: '[~]', cls: 'text-amber-700 dark:text-amber-400' }
    default:
      return { mark: '[ ]', cls: 'text-neutral-500 dark:text-neutral-400' }
  }
}

function TodoWriteBody({ raw }: { raw: unknown }) {
  const oldTodos = isArr(get(raw, 'oldTodos')) ? (get(raw, 'oldTodos') as Todo[]) : []
  const newTodos = isArr(get(raw, 'newTodos')) ? (get(raw, 'newTodos') as Todo[]) : []
  if (!oldTodos.length && !newTodos.length) return <FallbackBody raw={raw} />
  const oldByContent = new Map(oldTodos.map((t) => [str(t.content), str(t.status)]))
  return (
    <Section label="Todos">
      <div className="space-y-1">
        {newTodos.map((t, i) => {
          const content = str(t.content)
          const status = str(t.status)
          const { mark, cls } = statusMark(status)
          const prev = oldByContent.get(content)
          const changed = prev !== undefined && prev !== status
          const isNew = prev === undefined
          return (
            <div key={i} className="flex items-baseline gap-2 text-xs">
              <span className={`font-mono ${cls}`}>{mark}</span>
              <span className="min-w-0 break-words text-neutral-700 dark:text-neutral-300">{content}</span>
              {isNew && <Badge tone="green">new</Badge>}
              {changed && <Badge tone="neutral">{prev} → {status}</Badge>}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function AgentBody({ raw, input }: { raw: unknown; input: Record<string, unknown> }) {
  const rows: Array<[string, ReactNode]> = [
    ['status', str(get(raw, 'status'))],
    ['agentId', str(get(raw, 'agentId'))],
    ['resolvedModel', str(get(raw, 'resolvedModel')) || str(input.model)],
    ['description', str(input.description) || str(get(raw, 'description'))],
    ['subagent_type', str(input.subagent_type)],
  ]
  const kv = rows.filter(([, v]) => v)
  if (!kv.length) return <FallbackBody raw={raw} />
  return (
    <Section label="Agent">
      <KV rows={rows} />
    </Section>
  )
}

interface QOption {
  label?: unknown
  description?: unknown
}
interface Question {
  question?: unknown
  header?: unknown
  options?: unknown
  multiSelect?: unknown
}

function AskUserQuestionBody({ raw, input, text }: { raw: unknown; input: Record<string, unknown>; text: string }) {
  const questions = isArr(input.questions) ? (input.questions as Question[]) : []
  if (!questions.length) return <FallbackBody raw={raw} />
  // Chosen answers: flatten the result payload to text and test each option label against it.
  const answerHay = `${prettyJson(raw)}\n${text}`.toLowerCase()
  return (
    <div className="space-y-3">
      {questions.map((q, qi) => {
        const options = isArr(q.options) ? (q.options as QOption[]) : []
        return (
          <div key={qi} className="space-y-1">
            <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {str(q.header) && <span className="mr-1 text-neutral-500 dark:text-neutral-400">{str(q.header)}:</span>}
              {str(q.question)}
            </div>
            <div className="space-y-1">
              {options.map((o, oi) => {
                const label = str(o.label)
                const chosen = label !== '' && answerHay.includes(label.toLowerCase())
                return (
                  <div
                    key={oi}
                    className={`rounded-sm border px-2 py-1 text-xs ${
                      chosen
                        ? 'border-emerald-400 bg-emerald-50/70 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'border-neutral-200 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400'
                    }`}
                  >
                    <span className="font-medium">{label}</span>
                    {chosen && <span className="ml-1.5">✓</span>}
                    {str(o.description) && (
                      <span className="ml-1 text-neutral-500 dark:text-neutral-500">— {str(o.description)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FallbackBody({ raw, text }: { raw: unknown; text?: string }) {
  if (raw === null || raw === undefined) {
    if (text) {
      return (
        <Section label="Output">
          <pre className={preClass}>{text}</pre>
        </Section>
      )
    }
    return <div className="text-xs italic text-neutral-400 dark:text-neutral-500">no result</div>
  }
  const body = isObj(raw) || isArr(raw) ? prettyJson(raw) : str(raw) || text || ''
  return (
    <Section label="Output">
      <pre className={preClass}>{body}</pre>
    </Section>
  )
}

// --- dispatcher ------------------------------------------------------------
function OutputBody({ tool }: { tool: ClaudeTool }) {
  const result = tool.result
  if (!result) {
    return <div className="text-xs italic text-neutral-400 dark:text-neutral-500">no result</div>
  }
  const raw = result.raw
  const text = result.text || ''
  const name = tool.name

  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return <ShellBody raw={raw} />
    case 'Edit':
    case 'MultiEdit':
      return <EditBody raw={raw} />
    case 'Write':
      return <WriteBody raw={raw} />
    case 'Read':
      return <ReadBody raw={raw} text={text} />
    case 'Grep':
      return <GrepBody raw={raw} text={text} />
    case 'Glob':
      return <GlobBody raw={raw} />
    case 'TodoWrite':
      return <TodoWriteBody raw={raw} />
    case 'Agent':
    case 'Task':
      return <AgentBody raw={raw} input={tool.input} />
    case 'AskUserQuestion':
      return <AskUserQuestionBody raw={raw} input={tool.input} text={text} />
    default:
      return <FallbackBody raw={raw} text={text} />
  }
}

export default function ToolResult({ tool }: { tool: ClaudeTool }) {
  return (
    <div className="space-y-2">
      <Section label="Input">
        <pre className={preClass}>{prettyJson(tool.input)}</pre>
      </Section>
      <OutputBody tool={tool} />
    </div>
  )
}
