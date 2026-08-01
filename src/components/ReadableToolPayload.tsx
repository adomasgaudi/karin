import { useEffect, useRef, useState, type ReactNode } from 'react'
import JsonView, { stripAnsi } from './JsonView'
import { DEFAULT_MODEL, generate } from '../lib/localLlm'

type Obj = Record<string, unknown>

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const isBranch = (value: unknown): value is Obj | unknown[] => isObj(value) || Array.isArray(value)

const preClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-300'
const labelClass = 'text-xs font-semibold text-neutral-600 dark:text-neutral-300'

const SIMPLE_SYSTEM = [
  'You simplify coding-tool inputs for a developer reading an AI session transcript.',
  'Return a near-identical, concise walkthrough, not a vague summary.',
  'Keep every meaningful step, order, path, filename, search pattern, flag, literal, and command argument.',
  'Replace only noisy syntax or unfamiliar wrappers with intuitive uppercase keywords such as READ FILE, RUN COMMAND, SEARCH TEXT, EDIT FILE, or RUN IN PARALLEL.',
  'Keep the original path, command, or value in parentheses when replacing it could lose meaning.',
  'Start with exactly one short sentence beginning "What it does:" (18 words maximum).',
  'Then use one short line per meaningful original step. Do not invent results, edits, or intent.',
  'Output only the simplified text, with no markdown fence and no preamble.',
].join(' ')

const SIMPLE_INPUT_LIMIT = 18_000
const simpleCache = new Map<string, string>()

function promptInput(raw: string): string {
  if (raw.length <= SIMPLE_INPUT_LIMIT) return raw
  const head = Math.floor(SIMPLE_INPUT_LIMIT * 0.72)
  const tail = SIMPLE_INPUT_LIMIT - head
  return `${raw.slice(0, head)}\n… [middle clipped only for the local explanation] …\n${raw.slice(-tail)}`
}

function prettyInput(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) || fallback
  } catch {
    return fallback
  }
}

function SimplifiableInput({ raw, original }: { raw: string; original: ReactNode }) {
  const [mode, setMode] = useState<'original' | 'simple'>('original')
  const [simple, setSimple] = useState(() => simpleCache.get(raw) || '')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    abort.current?.abort()
    setMode('original')
    setSimple(simpleCache.get(raw) || '')
    setDraft('')
    setBusy(false)
    setError(null)
    return () => abort.current?.abort()
  }, [raw])

  const simplify = async () => {
    const cached = simpleCache.get(raw)
    if (cached) {
      setSimple(cached)
      setMode('simple')
      return
    }
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setMode('simple')
    setBusy(true)
    setDraft('')
    setError(null)
    try {
      const result = await generate(
        `Simplify this coding-tool input. Preserve its useful details.\n\n${promptInput(raw)}`,
        {
          model: DEFAULT_MODEL,
          system: SIMPLE_SYSTEM,
          signal: ac.signal,
          think: false,
          temperature: 0.15,
          numPredict: 500,
          numCtx: 8192,
          onToken: (chunk) => setDraft((prev) => prev + chunk),
        },
      )
      const cleaned = result.trim()
      if (!cleaned) throw new Error('Qwen returned no explanation.')
      simpleCache.set(raw, cleaned)
      setSimple(cleaned)
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (abort.current === ac) abort.current = null
      setBusy(false)
    }
  }

  if (!raw.trim()) return <>{original}</>

  const shown = mode === 'simple' && (simple || draft) ? simple || draft : ''
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end gap-1">
        <span className="mr-auto text-[0.58rem] text-neutral-400 dark:text-neutral-500">local Qwen</span>
        <button
          type="button"
          onClick={() => setMode('original')}
          className={`rounded-sm px-1.5 py-0.5 text-[0.6rem] ${mode === 'original' ? 'bg-neutral-200 font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200' : 'text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300'}`}
        >
          Original
        </button>
        <button
          type="button"
          onClick={() => void simplify()}
          className={`rounded-sm px-1.5 py-0.5 text-[0.6rem] ${mode === 'simple' ? 'bg-amber-100 font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' : 'text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300'}`}
        >
          {busy ? 'Simplifying…' : 'Simple'}
        </button>
      </div>
      {mode === 'simple' && shown ? (
        <pre className={`${preClass} whitespace-pre-wrap`}>{shown}{busy && <span className="animate-pulse text-neutral-400">▍</span>}</pre>
      ) : (
        original
      )}
      {mode === 'simple' && error && <div className="text-[0.65rem] text-red-600 dark:text-red-400">{error}</div>}
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className={labelClass}>{label}</div>
      {children}
    </div>
  )
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

// Tool wrappers are JavaScript, while some connector responses are Python reprs.
// This deliberately accepts only data literals, never executable code.
class LiteralParser {
  private pos = 0

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.value()
    this.space()
    if (this.pos < this.source.length && this.source[this.pos] === ';') this.pos += 1
    this.space()
    if (this.pos < this.source.length) throw new Error('trailing literal text')
    return value
  }

  private space() {
    while (this.pos < this.source.length) {
      if (/\s/.test(this.source[this.pos])) {
        this.pos += 1
        continue
      }
      if (this.source.startsWith('//', this.pos)) {
        const end = this.source.indexOf('\n', this.pos + 2)
        this.pos = end < 0 ? this.source.length : end + 1
        continue
      }
      if (this.source.startsWith('/*', this.pos)) {
        const end = this.source.indexOf('*/', this.pos + 2)
        if (end < 0) throw new Error('unclosed comment')
        this.pos = end + 2
        continue
      }
      break
    }
  }

  private value(): unknown {
    this.space()
    const char = this.source[this.pos]
    if (char === '{') return this.object()
    if (char === '[') return this.array()
    if (char === '"' || char === "'" || char === '`') return this.string()
    return this.atom()
  }

  private object(): Obj {
    this.pos += 1
    const result: Obj = {}
    this.space()
    while (this.pos < this.source.length && this.source[this.pos] !== '}') {
      const key = this.key()
      this.space()
      if (this.source[this.pos] !== ':') throw new Error('missing object colon')
      this.pos += 1
      result[key] = this.value()
      this.space()
      if (this.source[this.pos] === ',') {
        this.pos += 1
        this.space()
      } else if (this.source[this.pos] !== '}') {
        throw new Error('missing object comma')
      }
    }
    if (this.source[this.pos] !== '}') throw new Error('unclosed object')
    this.pos += 1
    return result
  }

  private array(): unknown[] {
    this.pos += 1
    const result: unknown[] = []
    this.space()
    while (this.pos < this.source.length && this.source[this.pos] !== ']') {
      result.push(this.value())
      this.space()
      if (this.source[this.pos] === ',') {
        this.pos += 1
        this.space()
      } else if (this.source[this.pos] !== ']') {
        throw new Error('missing array comma')
      }
    }
    if (this.source[this.pos] !== ']') throw new Error('unclosed array')
    this.pos += 1
    return result
  }

  private key(): string {
    this.space()
    const char = this.source[this.pos]
    if (char === '"' || char === "'") return this.string()
    const start = this.pos
    while (this.pos < this.source.length && !/[\s:,{}[\]]/.test(this.source[this.pos])) this.pos += 1
    if (start === this.pos) throw new Error('empty object key')
    return this.source.slice(start, this.pos)
  }

  private string(): string {
    const quote = this.source[this.pos++]
    let result = ''
    while (this.pos < this.source.length) {
      const char = this.source[this.pos++]
      if (char === quote) return result
      if (char !== '\\') {
        result += char
        continue
      }
      if (this.pos >= this.source.length) throw new Error('unclosed string')
      const escaped = this.source[this.pos++]
      const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' }
      if (simple[escaped] !== undefined) {
        result += simple[escaped]
      } else if (escaped === 'u') {
        const code = this.source.slice(this.pos, this.pos + 4)
        if (!/^[0-9a-f]{4}$/i.test(code)) throw new Error('bad unicode escape')
        result += String.fromCharCode(parseInt(code, 16))
        this.pos += 4
      } else if (escaped === 'x') {
        const code = this.source.slice(this.pos, this.pos + 2)
        if (!/^[0-9a-f]{2}$/i.test(code)) throw new Error('bad hex escape')
        result += String.fromCharCode(parseInt(code, 16))
        this.pos += 2
      } else if (escaped === '\n') {
        // JavaScript line continuation.
      } else if (escaped === '\r') {
        if (this.source[this.pos] === '\n') this.pos += 1
      } else if (escaped === '\\' || escaped === '"' || escaped === "'" || escaped === '`') {
        result += escaped
      } else {
        // Preserve unknown escapes such as a Windows path's \U instead of silently
        // changing the recorded command.
        result += `\\${escaped}`
      }
    }
    throw new Error('unclosed string')
  }

  private atom(): unknown {
    const start = this.pos
    while (this.pos < this.source.length && !/[\s,]}]/.test(this.source[this.pos])) this.pos += 1
    const token = this.source.slice(start, this.pos)
    if (token === 'true') return true
    if (token === 'false') return false
    if (token === 'null' || token === 'undefined') return null
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) return Number(token)
    if (!token) throw new Error('empty literal')
    return token
  }
}

export function parseLoosePayload(raw: string): unknown | null {
  const text = raw.trim()
  if (!text) return null
  const json = parseJson(text)
  if (json !== null) return json
  try {
    return new LiteralParser(text).parse()
  } catch {
    return null
  }
}

function balancedEnd(source: string, start: number): number | null {
  let depth = 0
  let quote = ''
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    if (quote) {
      if (char === '\\') {
        i += 1
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(' || char === '{' || char === '[') depth += 1
    if (char === ')' || char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return null
}

export interface ToolInvocation {
  name: string
  input: unknown | null
  rawArgs: string
}

function quotedEnd(source: string, start: number): number | null {
  const quote = source[start]
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1
    } else if (source[i] === quote) {
      return i
    }
  }
  return null
}

function expressionEnd(source: string, start: number): number {
  const char = source[start]
  if (char === '"' || char === "'" || char === '`') return quotedEnd(source, start) ?? source.length - 1
  if (char === '{' || char === '[' || char === '(') return balancedEnd(source, start) ?? source.length - 1
  let end = start
  while (end < source.length && source[end] !== ';' && source[end] !== '\n' && source[end] !== '\r') end += 1
  return end - 1
}

function localLiteralBindings(source: string): Map<string, unknown> {
  const bindings = new Map<string, unknown>()
  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g
  let match: RegExpExecArray | null
  while ((match = declaration.exec(source))) {
    const start = match.index + match[0].length
    const end = expressionEnd(source, start)
    const expression = source.slice(start, end + 1).trim().replace(/;$/, '')
    if (!expression || /^[A-Za-z_$][\w$]*$/.test(expression)) continue
    const value = parseLoosePayload(expression)
    if (value !== null) bindings.set(match[1], value)
  }
  return bindings
}

function invocationInput(rawArgs: string, bindings: Map<string, unknown>): unknown | null {
  const text = rawArgs.trim()
  if (!text) return null
  if (/^[A-Za-z_$][\w$]*$/.test(text)) return bindings.get(text) ?? null
  return parseLoosePayload(text)
}

export function parseToolInvocations(raw: string): ToolInvocation[] {
  const bindings = localLiteralBindings(raw)
  const calls: ToolInvocation[] = []
  const call = /\btools\.([A-Za-z_$][\w$]*)\s*\(/g
  let match: RegExpExecArray | null
  while ((match = call.exec(raw))) {
    const open = raw.indexOf('(', match.index)
    const close = balancedEnd(raw, open)
    if (close === null) continue
    const rawArgs = raw.slice(open + 1, close)
    calls.push({ name: match[1], input: invocationInput(rawArgs, bindings), rawArgs })
    call.lastIndex = close + 1
  }
  return calls
}

export function parseToolInvocation(raw: string): ToolInvocation | null {
  return parseToolInvocations(raw)[0] || null
}

export interface ToolOutputParts {
  structured: unknown | null
  text: string | null
  metadata: Array<[string, string]>
}

function textBlocks(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => isObj(item) && typeof item.text === 'string')) {
      return value.map((item) => String((item as Obj).text))
    }
    for (const item of value) {
      const nested = textBlocks(item)
      if (nested) return nested
    }
    return null
  }
  if (!isObj(value)) return null
  if (typeof value.text === 'string') return [value.text]
  for (const key of ['content', 'output', 'result', 'data']) {
    const nested = textBlocks(value[key])
    if (nested) return nested
  }
  return null
}

function executionText(text: string): { text: string | null; metadata: Array<[string, string]> } {
  const lines = stripAnsi(text).split(/\r?\n/)
  const metadata: Array<[string, string]> = []
  const body: string[] = []
  let inBody = false
  for (const line of lines) {
    // functions.exec may split one terminal response across several input_text
    // blocks. If the first block ended at an Output header, keep collecting the
    // next block's execution metadata until real output text begins.
    if (inBody && body.every((item) => !item.trim())) {
      const continued = /^([A-Za-z][\w ()/-]{1,40}):\s*(.*)$/.exec(line.trim())
      if (continued) {
        metadata.push([continued[1], continued[2]])
        continue
      }
      if (/^output:\s*$/i.test(line.trim())) continue
      if (/^script completed$/i.test(line.trim())) {
        metadata.push(['Status', 'completed'])
        continue
      }
      if (/^script running$/i.test(line.trim())) {
        metadata.push(['Status', 'running'])
        continue
      }
    }
    if (!inBody && /^output:\s*$/i.test(line.trim())) {
      inBody = true
      continue
    }
    if (!inBody) {
      const labelled = /^([A-Za-z][\w ()/-]{1,40}):\s*(.*)$/.exec(line.trim())
      if (labelled) {
        metadata.push([labelled[1], labelled[2]])
        continue
      }
      if (/^script completed$/i.test(line.trim())) {
        metadata.push(['Status', 'completed'])
        continue
      }
      if (/^script running$/i.test(line.trim())) {
        metadata.push(['Status', 'running'])
        continue
      }
    }
    body.push(line)
  }
  const cleanBody = body.join('\n').replace(/^\n+|\n+$/g, '')
  return { text: cleanBody || null, metadata }
}

export function parseToolOutput(raw: string | null | undefined): ToolOutputParts {
  if (!raw) return { structured: null, text: null, metadata: [] }
  const clean = stripAnsi(raw)
  const parsed = parseLoosePayload(clean)
  if (parsed !== null) {
    const blocks = textBlocks(parsed)
    if (blocks) {
      const result = executionText(blocks.join('\n\n'))
      return { structured: null, ...result }
    }
    return { structured: parsed, text: null, metadata: [] }
  }
  return { structured: null, ...executionText(clean) }
}

function renderScalar(value: unknown, raw: string) {
  if (typeof value === 'string') return <pre className={preClass}>{stripAnsi(value)}</pre>
  if (value !== null && value !== undefined) return <JsonView value={value} />
  return <pre className={preClass}>{stripAnsi(raw)}</pre>
}

function readableToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function renderInputValue(value: unknown | null, raw: string) {
  const original = value !== null && value !== undefined ? renderScalar(value, raw) : <pre className={preClass}>{stripAnsi(raw) || '(no arguments)'}</pre>
  return <SimplifiableInput raw={raw} original={original} />
}

export function ReadableToolInput({ toolName, argumentsText, value }: { toolName?: string; argumentsText?: string; value?: unknown }) {
  // Claude gives us the already-parsed input object. Codex/exec wrapper calls may
  // contain several nested tool invocations, so show every one instead of only the first.
  if (value !== undefined) {
    const raw = prettyInput(value, argumentsText || '')
    return <div className="space-y-1">{renderInputValue(value, raw)}</div>
  }

  const invocations = argumentsText ? parseToolInvocations(argumentsText) : []
  if (invocations.length > 0) {
    return (
      <div className="space-y-2">
        {invocations.map((invocation, index) => (
          <Section key={`${invocation.name}-${index}`} label={readableToolName(invocation.name)}>
            {renderInputValue(invocation.input, invocation.rawArgs)}
          </Section>
        ))}
      </div>
    )
  }

  const parsed = argumentsText ? parseLoosePayload(argumentsText) : null
  return (
    <div className="space-y-1">
      {toolName && <div className="text-[0.62rem] font-semibold text-neutral-500 dark:text-neutral-400">{readableToolName(toolName)}</div>}
      {renderInputValue(parsed, argumentsText || '')}
    </div>
  )
}

export function ReadableToolOutput({ output }: { output: string | null | undefined }) {
  const parts = parseToolOutput(output)
  return (
    <div className="space-y-2">
      {parts.metadata.length > 0 && (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {parts.metadata.map(([key, value]) => (
            <div key={`${key}-${value}`} className="contents">
              <span className="font-mono text-neutral-500 dark:text-neutral-400">{key}</span>
              <span className="min-w-0 break-words text-neutral-700 dark:text-neutral-300">{value || '—'}</span>
            </div>
          ))}
        </div>
      )}
      {parts.structured !== null && <Section label="Data"><JsonView value={parts.structured} /></Section>}
      {parts.text && <Section label={parts.metadata.some(([key]) => key.toLowerCase() === 'status') ? 'Output' : 'Text'}><pre className={preClass}>{stripAnsi(parts.text)}</pre></Section>}
      {!parts.structured && !parts.text && parts.metadata.length === 0 && <div className="text-xs italic text-neutral-400 dark:text-neutral-500">no output</div>}
    </div>
  )
}

export function ReadableToolValue({ value, text }: { value: unknown; text?: string }) {
  if (isBranch(value)) return <JsonView value={value} />
  if (typeof value === 'string') return <ReadableToolOutput output={value} />
  if (text) return <ReadableToolOutput output={text} />
  if (value !== null && value !== undefined) return renderScalar(value, '')
  return <div className="text-xs italic text-neutral-400 dark:text-neutral-500">no result</div>
}
