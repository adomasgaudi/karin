// Separating what the OWNER typed from what the harness attached to their message.
//
// A recorded user turn is rarely just the owner's words. The IDE staples the current
// editor selection on, hooks inject system reminders, slash commands expand into
// name/args/stdout blocks. All of it arrives inside the same user record, so a prompt
// preview can end up showing an <ide_selection> wall where the owner's actual sentence
// was one short line at the end.
//
// That matters beyond looks: the owner has to be able to recognise their own writing.
// Everything here is a deterministic split on known wrappers — no model involved, so
// the boundary between "I wrote this" and "this was attached" is never a guess.

// Wrappers the harness adds around injected content. Each is a real tag seen in Codex
// and Claude transcripts; unknown tags are deliberately NOT guessed at, because
// mislabelling the owner's own words as injected is the one unacceptable error.
const INJECTED_TAGS = [
  'ide_selection',
  'ide_opened_file',
  'ide_diagnostics',
  'system-reminder',
  'local-command-caveat',
  'local-command-stdout',
  'command-name',
  'command-message',
  'command-args',
  'environment_context',
  'user_instructions',
  'persisted-output',
] as const

const TAG_LABELS: Record<string, string> = {
  ide_selection: 'IDE selection',
  ide_opened_file: 'open file',
  ide_diagnostics: 'IDE diagnostics',
  'system-reminder': 'system reminder',
  'local-command-caveat': 'command caveat',
  'local-command-stdout': 'command output',
  'command-name': 'slash command',
  'command-message': 'command message',
  'command-args': 'command args',
  environment_context: 'environment',
  user_instructions: 'instructions',
  'persisted-output': 'saved output',
}

const TAG_RE = new RegExp(`<(${INJECTED_TAGS.join('|')})>([\\s\\S]*?)</\\1>`, 'g')

export interface PromptSegment {
  kind: 'own' | 'injected'
  /** Human label for an injected block ("IDE selection"); absent on own text. */
  label?: string
  text: string
}

/**
 * Split a recorded user message into the owner's own words and the blocks attached
 * around them. Segments come back in their original order, so the body can be
 * rendered as it was actually sent.
 */
export function splitPrompt(raw: string): PromptSegment[] {
  const text = raw || ''
  if (!text.trim()) return []
  const segments: PromptSegment[] = []
  let cursor = 0
  TAG_RE.lastIndex = 0
  for (let match = TAG_RE.exec(text); match; match = TAG_RE.exec(text)) {
    const before = text.slice(cursor, match.index)
    if (before.trim()) segments.push({ kind: 'own', text: before.trim() })
    segments.push({
      kind: 'injected',
      label: TAG_LABELS[match[1]] || match[1],
      text: match[2].trim(),
    })
    cursor = match.index + match[0].length
  }
  const tail = text.slice(cursor)
  if (tail.trim()) segments.push({ kind: 'own', text: tail.trim() })
  return segments
}

/**
 * Only the words the owner actually typed. Falls back to the full text when a message
 * is entirely injected — showing something the owner can identify beats showing nothing.
 */
export function ownPromptText(raw: string): string {
  const own = splitPrompt(raw)
    .filter((segment) => segment.kind === 'own')
    .map((segment) => segment.text)
    .join('\n')
    .trim()
  return own || (raw || '').trim()
}

/** Labels of the blocks attached to this message, deduplicated, in order. */
export function injectedLabels(raw: string): string[] {
  const seen = new Set<string>()
  for (const segment of splitPrompt(raw)) {
    if (segment.kind === 'injected' && segment.label) seen.add(segment.label)
  }
  return [...seen]
}

/** Does this message carry anything the owner did not type? */
export function hasInjected(raw: string): boolean {
  return splitPrompt(raw).some((segment) => segment.kind === 'injected')
}
