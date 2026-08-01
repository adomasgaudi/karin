import type { ReactNode } from 'react'
import JsonView from './JsonView'

type Obj = Record<string, unknown>

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const isBranch = (value: unknown): value is Obj | unknown[] => isObj(value) || Array.isArray(value)

const preClass =
  'overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-950/55 dark:text-neutral-300'
const labelClass = 'text-xs font-semibold text-neutral-600 dark:text-neutral-300'

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
    if (char === '"' || char === "'") return this.string()
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
      } else if (escaped === '\\' || escaped === '"' || escaped === "'") {
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
  input: unknown
}

export function parseToolInvocation(raw: string): ToolInvocation | null {
  const match = /\btools\.([A-Za-z_$][\w$]*)\s*\(/.exec(raw)
  if (!match || match.index === undefined) return null
  const open = raw.indexOf('(', match.index)
  const close = balancedEnd(raw, open)
  if (close === null) return null
  const input = parseLoosePayload(raw.slice(open + 1, close))
  return input === null ? null : { name: match[1], input }
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
  const lines = text.split(/\r?\n/)
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
  const parsed = parseLoosePayload(raw)
  if (parsed !== null) {
    const blocks = textBlocks(parsed)
    if (blocks) {
      const result = executionText(blocks.join('\n\n'))
      return { structured: null, ...result }
    }
    return { structured: parsed, text: null, metadata: [] }
  }
  return { structured: null, ...executionText(raw) }
}

function renderScalar(value: unknown, raw: string) {
  if (typeof value === 'string') return <pre className={preClass}>{value}</pre>
  if (value !== null && value !== undefined) return <JsonView value={value} />
  return <pre className={preClass}>{raw}</pre>
}

export function ReadableToolInput({ toolName, argumentsText, value }: { toolName?: string; argumentsText?: string; value?: unknown }) {
  const invocation = argumentsText ? parseToolInvocation(argumentsText) : null
  const parsed = value !== undefined ? value : invocation?.input ?? (argumentsText ? parseLoosePayload(argumentsText) : null)
  const nestedName = invocation && invocation.name !== toolName ? invocation.name : null
  return (
    <div className="space-y-1">
      {nestedName && <div className="font-mono text-[0.62rem] text-neutral-500 dark:text-neutral-400">{nestedName}</div>}
      {parsed !== null && parsed !== undefined ? renderScalar(parsed, argumentsText || '') : <pre className={preClass}>{argumentsText || ''}</pre>}
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
      {parts.text && <Section label={parts.metadata.some(([key]) => key.toLowerCase() === 'status') ? 'Output' : 'Text'}><pre className={preClass}>{parts.text}</pre></Section>}
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
