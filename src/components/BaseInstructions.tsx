import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'

interface InstructionSection {
  level: number
  title: string
  body: string
}

interface InstructionBlock {
  kind: 'paragraph' | 'list' | 'code'
  lines: string[]
  ordered?: boolean
  language?: string
}

interface ParsedValue {
  text?: unknown
}

function isObject(value: unknown): value is ParsedValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// session_meta.base_instructions is usually JSON encoded twice: the outer context
// record carries a string containing {"text":"..."}. Accept the plain form too so
// this renderer also works with older feeds and hand-dropped datasets.
function unwrapInstructions(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (isObject(parsed) && typeof parsed.text === 'string') return parsed.text
  } catch {
    // Plain Markdown — leave it alone.
  }
  return raw
}

function cleanTitle(raw: string): string {
  return raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function headingFrom(line: string): { level: number; title: string } | null {
  const match = /^( {0,3})(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line)
  if (!match) return null
  return {
    level: match[2].length,
    title: cleanTitle(match[3].replace(/[ \t]+#+[ \t]*$/, '')),
  }
}

const STRUCTURED_TAGS: Record<string, string> = {
  recommended_plugins: 'Recommended plugins',
  environment_context: 'Environment context',
}

function contextTagFrom(line: string): { name: string; closing: boolean; rest: string } | null {
  const closing = /^\s*<\/([a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)>\s*$/i.exec(line)
  if (closing) return { name: closing[1], closing: true, rest: '' }
  const opening = /^\s*<([a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)>(.*)$/i.exec(line)
  if (!opening) return null
  return { name: opening[1], closing: false, rest: opening[2] }
}

function contextTitle(name: string): string {
  const normalized = name.toLowerCase()
  const title = STRUCTURED_TAGS[normalized] || cleanTitle(normalized)
  return title.replace(/(^|\s)\w/g, (letter) => letter.toUpperCase())
}

// Some session feeds flatten a Markdown/XML payload into one visual line while
// preserving the markers themselves. Put the structural markers back on their
// own lines before the normal section parser runs. Fenced code is deliberately
// left untouched so a `# heading` inside a script cannot create a false section.
function restoreEmbeddedBoundaries(source: string): string {
  let fence: { char: string; length: number } | null = null
  const output: string[] = []
  for (const originalLine of source.split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(originalLine)
    if (fence) {
      output.push(originalLine)
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length }
      output.push(originalLine)
      continue
    }

    // A heading or XML boundary appearing after prose is almost certainly a
    // flattened line break in these startup payloads.
    output.push(
      originalLine.replace(
        /([^\n])\s+(?=(?:#{1,6}\s+|<\/?[a-z][a-z0-9_. -]*>))/gi,
        '$1\n',
      ),
    )
  }
  return output.join('\n')
}

// Startup payloads can combine XML blocks with Markdown (recommended plugins →
// AGENTS.md → environment). Keep the same disclosure UI as base instructions while
// treating the known XML blocks as section boundaries too.
export function looksLikeStructuredContext(text: string): boolean {
  return /#\s+AGENTS\.md instructions\b/i.test(text) ||
    /<\/?(?:environment_context|instructions|permissions instructions)>/i.test(text)
}

export function isStructuredInstructionPayload(name: string | undefined, text: string): boolean {
  const normalized = name?.toLowerCase() || ''
  return normalized === 'base_instructions' || normalized === 'developer_message' || normalized === 'startup_context' || looksLikeStructuredContext(text)
}

// Split Markdown headings without treating a # inside a fenced code sample as a
// section title. Every heading becomes its own disclosure, including nested levels.
export function splitInstructions(raw: string): InstructionSection[] {
  const source = restoreEmbeddedBoundaries(unwrapInstructions(raw).replace(/\r\n?/g, '\n'))
  const lines = source.split('\n')
  const sections: InstructionSection[] = []
  let level = 0
  let title = ''
  let body: string[] = []
  let fence: { char: string; length: number } | null = null
  let contextTag: string | null = null
  let tagSection = false

  const push = () => {
    const content = body.join('\n').replace(/^\n+|\n+$/g, '')
    // A wrapper immediately followed by its first Markdown heading has no useful
    // body of its own; omit that empty disclosure and keep the real heading.
    if ((title || content) && (content || !tagSection)) {
      sections.push({ level, title: title || 'Preamble', body: content })
    }
  }

  for (const line of lines) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length) fence = null
      body.push(line)
      continue
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length }
      body.push(line)
      continue
    }

    const tagged = contextTagFrom(line)
    if (tagged && !contextTag && !tagged.closing) {
      push()
      level = 1
      title = contextTitle(tagged.name)
      body = []
      contextTag = tagged.name.toLowerCase()
      tagSection = true
      if (tagged.rest) body.push(tagged.rest)
      continue
    }
    if (tagged && contextTag === tagged.name.toLowerCase() && tagged.closing) {
      push()
      level = 0
      title = ''
      body = []
      contextTag = null
      tagSection = false
      continue
    }

    const heading = headingFrom(line)
    if (heading) {
      push()
      level = heading.level
      title = heading.title
      body = []
      tagSection = false
    } else {
      body.push(line)
    }
  }
  push()

  return sections.length ? sections : [{ level: 1, title: 'Base instructions', body: source }]
}

function flushBlock(blocks: InstructionBlock[], kind: InstructionBlock['kind'], lines: string[], extra: Partial<InstructionBlock> = {}) {
  const content = lines.join('\n').trim()
  if (content) blocks.push({ kind, lines: kind === 'code' ? lines : [content], ...extra })
}

function splitInstructionBlocks(body: string): InstructionBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const blocks: InstructionBlock[] = []
  let paragraph: string[] = []
  let index = 0
  const flushParagraph = () => {
    flushBlock(blocks, 'paragraph', paragraph)
    paragraph = []
  }

  while (index < lines.length) {
    const line = lines[index]
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      flushParagraph()
      const code: string[] = []
      const char = fence[1][0]
      const length = fence[1].length
      const language = fence[2].trim() || undefined
      index++
      while (index < lines.length && !new RegExp(`^\\s*${char}{${length},}\\s*$`).test(lines[index])) {
        code.push(lines[index])
        index++
      }
      if (index < lines.length) index++
      flushBlock(blocks, 'code', code, { language })
      continue
    }

    const list = /^(\s*)([-*+] |\d+[.)] )(.*)$/.exec(line)
    if (list) {
      flushParagraph()
      const ordered = /^\d/.test(list[2])
      const items: string[] = [list[3]]
      index++
      while (index < lines.length) {
        const next = /^(\s*)([-*+] |\d+[.)] )(.*)$/.exec(lines[index])
        if (next && /^\d/.test(next[2]) === ordered) {
          items.push(next[3])
          index++
          continue
        }
        if (lines[index].trim() === '') {
          let lookahead = index + 1
          while (lookahead < lines.length && lines[lookahead].trim() === '') lookahead++
          const nextAfterGap = lines[lookahead] && /^(\s*)([-*+] |\d+[.)] )(.*)$/.exec(lines[lookahead])
          if (nextAfterGap && /^\d/.test(nextAfterGap[2]) === ordered) {
            index = lookahead
            continue
          }
        }
        break
      }
      blocks.push({ kind: 'list', lines: items, ordered })
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
    } else {
      paragraph.push(line)
    }
    index++
  }
  flushParagraph()
  return blocks
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-neutral-200/70 px-1 py-0.5 font-mono text-[0.66rem] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
          {part.slice(1, -1)}
        </code>
      )
    }
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={index} className="font-semibold text-neutral-800 dark:text-neutral-100">{part.slice(2, -2)}</strong>
    }
    return <span key={index}>{part}</span>
  })
}

function InstructionBody({ body }: { body: string }) {
  const blocks = useMemo(() => splitInstructionBlocks(body), [body])
  return (
    <div className="space-y-2 border-t border-neutral-200 bg-white/60 px-3 py-2 text-[0.72rem] leading-relaxed text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950/35 dark:text-neutral-300">
      {blocks.map((block, index) => {
        if (block.kind === 'code') {
          return (
            <div key={index} className="overflow-hidden rounded-md border border-neutral-200 bg-neutral-950/[0.04] dark:border-neutral-800 dark:bg-black/20">
              {block.language && <div className="border-b border-neutral-200 px-2 py-1 font-mono text-[0.58rem] uppercase tracking-wide text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">{block.language}</div>}
              <pre className="overflow-x-auto px-2 py-2 font-mono text-[0.68rem] leading-relaxed whitespace-pre-wrap break-words">{block.lines.join('\n')}</pre>
            </div>
          )
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={index} className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>
              {block.lines.map((line, itemIndex) => <li key={itemIndex}>{renderInline(line)}</li>)}
            </List>
          )
        }
        return <p key={index} className="whitespace-pre-wrap break-words">{renderInline(block.lines[0])}</p>
      })}
    </div>
  )
}

function InstructionSection({ section }: { section: InstructionSection }) {
  return (
    <details className="overflow-hidden rounded-md border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/45">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-xs marker:hidden [&::-webkit-details-marker]:hidden hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
        <ChevronRight className="h-3 w-3 shrink-0 text-neutral-400 transition-transform [[open]_&]:rotate-90 dark:text-neutral-500" />
        <span className="shrink-0 rounded-sm bg-neutral-200/70 px-1 font-mono text-[0.55rem] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          h{section.level}
        </span>
        <span className="min-w-0 flex-1 font-medium text-neutral-800 dark:text-neutral-100">{section.title}</span>
        <span className="shrink-0 font-mono text-[0.6rem] text-neutral-400 dark:text-neutral-500">
          {section.body.length.toLocaleString()} chars
        </span>
      </summary>
      {section.body ? <InstructionBody body={section.body} /> : <div className="border-t border-neutral-200 px-3 py-2 text-xs italic text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">(empty section)</div>}
    </details>
  )
}

export default function BaseInstructions({ text }: { text: string }) {
  const sections = useMemo(() => splitInstructions(text), [text])
  const chars = sections.reduce((total, section) => total + section.body.length, 0)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-1 text-[0.62rem] text-neutral-400 dark:text-neutral-500">
        <span>{sections.length} sections</span>
        <span>·</span>
        <span>{chars.toLocaleString()} chars</span>
        <span className="ml-auto">open a title to read that part</span>
      </div>
      {sections.map((section, index) => (
        <InstructionSection key={`${section.level}-${section.title}-${index}`} section={section} />
      ))}
    </div>
  )
}
