// Turn state — "is the AI idle (waiting on you) or still mid-turn?" — deduced from the
// LAST record of a session. This is NOT liveness (we can't know if the process is alive);
// it's the turn's closing state AS OF THE LAST INDEX. Honest because it reads a signal the
// model itself emitted (Claude `stop_reason`, Codex message `phase`), not mere recency.

import type { Session } from '../types'
import type { ClaudeDetailSession } from './claudeModel'

export type TurnState = 'working' | 'waiting' | 'interrupted' | 'unknown'

// Claude: the assistant message's own `stop_reason` is authoritative.
//   end_turn / stop_sequence → it yielded the floor        → waiting
//   tool_use                 → it fired a tool, not closed  → working
//   max_tokens               → cut off mid-response         → interrupted
// A human prompt after the AI's last message also means the AI's turn is pending.
export function claudeTurnState(s: ClaudeDetailSession): TurnState {
  const msgs = (s.messages || []).filter((m) => !m.is_sidechain && !m.is_meta)
  let lastAssistant: ClaudeDetailSession['messages'][number] | null = null
  let lastHuman: ClaudeDetailSession['messages'][number] | null = null
  for (const m of msgs) {
    if (m.role === 'assistant') {
      if (!lastAssistant || m.line > lastAssistant.line) lastAssistant = m
    } else if (m.role === 'user' && m.origin_kind === 'human') {
      if (!lastHuman || m.line > lastHuman.line) lastHuman = m
    }
  }
  if (!lastAssistant) return msgs.length ? 'working' : 'unknown'
  if (lastHuman && lastHuman.line > lastAssistant.line) return 'working'
  switch (lastAssistant.stop_reason) {
    case 'tool_use':
      return 'working'
    case 'max_tokens':
      return 'interrupted'
    default:
      // end_turn, stop_sequence, or null (final message with no explicit reason)
      return 'waiting'
  }
}

// Codex: a turn ends with a `final`-phase assistant message. Anything recorded after the
// last final answer (a tool call, commentary, or a fresh user prompt) means work resumed.
export function codexTurnState(s: Session): TurnState {
  const msgs = s.messages || []
  const tools = s.tools || []
  if (!msgs.length && !tools.length) return 'unknown'
  const maxLine = (arr: { line: number }[]) => arr.reduce((mx, x) => (x.line > mx ? x.line : mx), -1)
  const finals = msgs.filter((m) => m.role === 'assistant' && m.phase === 'final')
  const assistants = msgs.filter((m) => m.role === 'assistant')
  // Prefer real "final" answers; fall back to any assistant message if the phase is absent.
  const lastFinalLine = finals.length ? maxLine(finals) : maxLine(assistants)
  if (lastFinalLine < 0) return 'working' // messages/tools exist but no assistant answer yet
  const lastEventLine = Math.max(maxLine(msgs), maxLine(tools))
  return lastEventLine > lastFinalLine ? 'working' : 'waiting'
}
