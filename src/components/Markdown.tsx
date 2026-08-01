import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// A small markdown renderer for assistant/user message bodies.
//
// Transcript replies are written in markdown, and shown raw they are genuinely
// hard to read: ** ** around every emphasis, backticks in the middle of prose,
// and — worst — fenced ASCII diagrams whose alignment only survives in a
// monospace block. No dependency is used: the app is offline-first and this
// needs a handful of constructs, not a spec-complete parser.
//
// Deliberately NOT supported: html, tables, nested lists, images. Anything not
// recognised falls through as plain text, which is exactly the raw-markdown
// behaviour we have today — so an unhandled construct can never be worse than
// before.
// ---------------------------------------------------------------------------

const FENCE = /^\s*```/

// Inline: `code`, **bold**, *italic*, and [text](target) reduced to its text.
// One pass with a single alternation keeps the segments in source order.
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\n]*\))/g

function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE)
  return (
    <>
      {parts.map((part, index) => {
        // split() with one capture group puts every match at an odd index.
        if (index % 2 === 0) return part
        if (part.startsWith('`')) {
          return (
            <code key={index} className="rounded-sm bg-neutral-200/70 px-1 font-mono text-[0.92em] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part.startsWith('**')) {
          return (
            <strong key={index} className="font-semibold text-neutral-900 dark:text-neutral-50">
              {part.slice(2, -2)}
            </strong>
          )
        }
        if (part.startsWith('[')) {
          // Transcript links point at the owner's own files; there is nothing to
          // navigate to here, so the label is kept and the target dropped.
          const label = part.slice(1, part.indexOf(']'))
          return (
            <span key={index} className="text-sky-700 underline decoration-dotted dark:text-sky-300">
              {label}
            </span>
          )
        }
        return (
          <em key={index} className="italic">
            {part.slice(1, -1)}
          </em>
        )
      })}
    </>
  )
}

interface Block {
  kind: 'code' | 'heading' | 'bullet' | 'text'
  lines: string[]
  level?: number
}

// Group lines into blocks. A fence swallows everything up to its closing fence
// verbatim — that is what keeps an ASCII diagram's alignment intact.
function toBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (FENCE.test(line)) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      index += 1 // closing fence (or end of text, when the model left it open)
      blocks.push({ kind: 'code', lines: body })
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', lines: [heading[2]], level: heading[1].length })
      index += 1
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'bullet', lines: items })
      continue
    }
    // A run of ordinary lines, ended by a blank line, becomes one paragraph.
    const text: string[] = []
    while (index < lines.length && lines[index].trim() && !FENCE.test(lines[index]) && !/^\s*[-*]\s+/.test(lines[index]) && !/^#{1,4}\s+/.test(lines[index])) {
      text.push(lines[index])
      index += 1
    }
    if (text.length) blocks.push({ kind: 'text', lines: text })
    else index += 1 // blank line
  }
  return blocks
}

const HEADING_SIZES: Record<number, string> = {
  1: 'text-[1.05em] font-semibold',
  2: 'text-[1em] font-semibold',
  3: 'text-[0.95em] font-semibold',
  4: 'text-[0.92em] font-semibold',
}

export default function Markdown({ text }: { text: string }) {
  if (!text?.trim()) return null
  const blocks = toBlocks(text)
  const nodes: ReactNode[] = blocks.map((block, index) => {
    if (block.kind === 'code') {
      return (
        // whitespace-pre (not pre-wrap) so a wide ASCII diagram scrolls instead of
        // wrapping — a wrapped bar chart is not a bar chart.
        <pre
          key={index}
          className="overflow-x-auto rounded-md bg-neutral-100 p-2 font-mono text-[0.8em] leading-relaxed whitespace-pre text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
        >
          {block.lines.join('\n')}
        </pre>
      )
    }
    if (block.kind === 'heading') {
      return (
        <div key={index} className={`${HEADING_SIZES[block.level || 3]} text-neutral-900 dark:text-neutral-50`}>
          <Inline text={block.lines[0]} />
        </div>
      )
    }
    if (block.kind === 'bullet') {
      return (
        <ul key={index} className="ml-4 list-disc space-y-0.5 marker:text-neutral-400">
          {block.lines.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      )
    }
    return (
      <p key={index} className="whitespace-pre-wrap break-words leading-relaxed">
        <Inline text={block.lines.join('\n')} />
      </p>
    )
  })
  return <div className="space-y-2">{nodes}</div>
}
