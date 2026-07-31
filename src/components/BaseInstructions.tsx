import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'

interface InstructionSection {
  level: number
  title: string
  body: string
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
  const closing = /^\s*<\/([a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)>\s*$/.exec(line)
  if (closing) return { name: closing[1], closing: true, rest: '' }
  const opening = /^\s*<([a-z][a-z0-9_.-]*(?:[ \t]+[a-z][a-z0-9_.-]*)*)>(.*)$/.exec(line)
  if (!opening) return null
  return { name: opening[1], closing: false, rest: opening[2] }
}

function contextTitle(name: string): string {
  return STRUCTURED_TAGS[name] || cleanTitle(name)
}

// Startup payloads can combine XML blocks with Markdown (recommended plugins →
// AGENTS.md → environment). Keep the same disclosure UI as base instructions while
// treating the known XML blocks as section boundaries too.
export function looksLikeStructuredContext(text: string): boolean {
  return Object.keys(STRUCTURED_TAGS).some((tag) => text.includes(`<${tag}>`)) || text.includes('# AGENTS.md instructions')
}

// Split Markdown headings without treating a # inside a fenced code sample as a
// section title. Every heading becomes its own disclosure, including nested levels.
export function splitInstructions(raw: string): InstructionSection[] {
  const source = unwrapInstructions(raw).replace(/\r\n?/g, '\n')
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
      contextTag = tagged.name
      tagSection = true
      if (tagged.rest) body.push(tagged.rest)
      continue
    }
    if (tagged && contextTag === tagged.name && tagged.closing) {
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
      <pre className="max-h-[36rem] overflow-auto border-t border-neutral-200 bg-white/60 px-2 py-2 font-mono text-[0.68rem] leading-relaxed whitespace-pre-wrap break-words text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950/35 dark:text-neutral-300">
        {section.body || '(empty section)'}
      </pre>
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
