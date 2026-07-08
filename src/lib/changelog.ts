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
