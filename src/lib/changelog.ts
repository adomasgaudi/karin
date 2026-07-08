// Owner-facing changelog — the SSOT for version updates shown in the app.
//
// Every material change PREPENDS one entry here (newest first). The app's
// APP_VERSION is derived from CHANGELOG[0].version, so bumping the version and
// writing what changed are the same action — they can't drift.
//
// Entry shape (see ChangelogButton):
//   title   — 2–5 words, the headline
//   summary — 8–20 words, one expandable level down
//   detail  — 30–100 words, a second expandable level (OPTIONAL; omit if the
//             summary already says everything)

export interface ChangelogEntry {
  version: string
  title: string
  summary: string
  detail?: string
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'v.48',
    title: 'Compact borderless events',
    summary:
      'Event rows lose their cards and the stray disclosure arrow — one tight inline line each, with message previews in the title and grouped session-state blocks.',
    detail:
      'Each event in a cycle is now a borderless row (a thin left accent + hairline divider) instead of a padded card, and the disclosure triangle moved onto the title line as an inline chevron that rotates when open — no more arrow on its own row. Message rows read "user: <preview>" / "assistant: <preview>" with the full text under the dropdown. Context rows show just the payload subtype (e.g. deferred_tools_delta) instead of "context / attachment/…". The repetitive Claude session-state records (last-prompt, mode, permission-mode, ai-title) collapse into a single "session state" dropdown.',
  },
  {
    version: 'v.47',
    title: 'One global unit toggle',
    summary:
      'The tokens / token-units switch is now global and labels the sidebar bars inline, so every token figure — including each session total — changes with one click.',
    detail:
      'Previously the sidebar and the session detail each had their own toggle, and the sidebar\'s "5.8M tokens" line never followed it — only the bar segments re-weighted. The toggle (plus the currency selector) now lives in the store, shared across both panes and remembered across reloads, so switching to token units re-expresses the session-row totals as cost too. The sidebar bars also print each segment\'s value inside them (input / cached / output …), matching the session-detail bar, instead of showing an unlabelled strip.',
  },
  {
    version: 'v.46',
    title: 'Removed active-session dots',
    summary:
      'Dropped the green/gray live dots — the data has no reliable signal for whether a session is still running.',
    detail:
      'The dots inferred "active" from how recently a session was last written to, but a session that ended two minutes ago is indistinguishable from one still running — both just have a recent last-activity timestamp. Since Karin reads finished transcript files on disk and has no process/heartbeat signal, liveness can\'t be determined with certainty, so the feature was misleading (it showed ended sessions as live) and has been removed rather than left to guess.',
  },
  {
    version: 'v.45',
    title: 'Consistent significant figures',
    summary:
      'Every measured number — tokens, cost, durations — now shows 2 significant figures below 10 and 3 above, never fewer or more.',
    detail:
      'One shared sig-fig policy drives all value formatting: 2 significant figures under 10, 3 at or above (e.g. 7.3, 45.2, 45.2K, $0.071, 12.0s). Token amounts, compact counts, currency in every denomination, and sub-minute durations all route through it, so nothing shows a lone digit like "5" or an over-precise "45,231". Exact counts of discrete things — records, events, transcript tallies, and m/s time breakdowns — are deliberately left untouched, since a count of 5 is 5, not 5.0.',
  },
  {
    version: 'v.44',
    title: 'Token units by default',
    summary:
      'Usage now opens in the priced "token units" view everywhere; toggle back to raw token counts anytime.',
    detail:
      'The sidebar totals and the session detail both start in the "token units" mode instead of raw token counts, so costs are the first thing you see. Nothing else changed about the toggle — one click still switches either view back to raw tokens, and the currency selector still appears while token units are shown.',
  },
  {
    version: 'v.43',
    title: 'Active-session dots',
    summary:
      'Each session row now carries a green dot when it was active in the last 5 minutes, gray when idle.',
    detail:
      'A small status dot sits at the left of every session row in the sidebar. It turns green (with a soft pulse) when the session had activity within the last 5 minutes, and stays gray otherwise — so you can scan the list and see which sessions are live at a glance. The dot re-evaluates every second against the shared live clock, so a session goes gray the moment it crosses the 5-minute threshold.',
  },
  {
    version: 'v.42',
    title: 'Leaner session list',
    summary:
      'Session rows drop the date and cached-tokens figures — that detail now lives inside the session view.',
    detail:
      'The sidebar row previously repeated each session\'s date/time and a "N cached" total. Both were redundant with what the session detail shows once opened (per-cycle start/end times, and cached tokens in the usage bars), so the list row now carries just total tokens and the project — less noise when scanning sessions. The generated-at stamp and the live "Xm ago" age at the top of the sidebar are unchanged.',
  },
  {
    version: 'v.41',
    title: 'Sub-second step precision',
    summary:
      'Fast steps now show 2 significant figures instead of collapsing to "0.0s", so sub-cycle durations under 0.1s stay accurate.',
    detail:
      'Step durations are often well under a tenth of a second, but the old formatter rounded every duration to one decimal — so a 4ms step read "0.0s" and a 42ms step "0.0s", losing the difference. Any duration under a minute now renders to 2 significant figures ("0.0040s", "0.042s", "3.7s", "12s"); minute/hour spans are unchanged. When the underlying timing is unavailable it still reads "n/a".',
  },
  {
    version: 'v.40',
    title: 'Per-cycle timing',
    summary:
      'Each cycle and each step now shows when it started, ended, and how long the AI actually worked — excluding time spent waiting on you.',
    detail:
      'Every cycle header carries a ⏱ working-time chip; expanding shows start → end wall-clock plus both a "working" span (AI churning) and a "total" span (including any time you spent answering an AskUserQuestion). Because the cycle split already isolates human touchpoints, work within a cycle is continuous, so working time is honest. Each event card also shows how long that step ran (gap to the next event); the owner-deliberation step reads "waiting on you" instead of counting as work.',
  },
  {
    version: 'v.39',
    title: 'Version updates panel',
    summary:
      'Floating bottom-right button opens a log of every version update, each with an expandable summary and deeper detail.',
    detail:
      'A fixed button in the bottom-right corner shows the current version. Clicking it opens a panel listing every changelog entry newest-first. Each entry expands to reveal a short summary, and — when useful — expands once more to a longer explanation. The changelog now lives in src/lib/changelog.ts, which is also the single source the app version is derived from.',
  },
]
