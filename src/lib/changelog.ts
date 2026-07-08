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
    version: 'v.64',
    title: 'Day timeline page',
    summary:
      'New Timeline view: every Codex and Claude session drawn as a bar across the day, with lanes for overlaps and labeled idle gaps.',
    detail:
      'A "Timeline" button in the sidebar header opens a full-page day view. Each session becomes a colored bar (blue Codex, orange Claude) from its start to its last activity, positioned on an hour axis. Simultaneous sessions stack into separate lanes; a lane is reused as soon as it frees up. Idle stretches of 5+ minutes between activity blocks are marked in a dashed gap strip with their duration. Arrows page between days with activity; clicking a bar (or its row in the start/end list below) jumps to that session. Sessions spanning midnight appear on both days, clipped.',
  },
  {
    version: 'v.63',
    title: 'Readable action rows',
    summary:
      'Tool/edit rows now show a “tool” tag + name (no slash) with the actual command/file/pattern instead of the call id, and assistant rows drop the label/model to show up to 3 lines of the reply itself.',
    detail:
      'Tool and edit rows replace the "tool / Name" title with a small "tool"/"edit" tag next to the name, and the lighter meta text now summarises the call — the command a Bash ran, the file a Read/Edit touched, the pattern a Grep searched — instead of the opaque toolu_… id. Assistant rows, in a single-model session, drop the redundant "assistant:" label and model chip entirely and instead show the reply text, wrapping up to 3 lines before truncating (the model chip returns only when a session actually mixes models). Everything still expands to the full content.',
  },
  {
    version: 'v.62',
    title: 'Token bar hugs the title',
    summary:
      'The per-action thin token bar moved from the right of the title to a tight full-width strip directly beneath it, adding almost no vertical height.',
  },
  {
    version: 'v.61',
    title: 'Per-model rate table',
    summary:
      'The pricing “?” panel now has a collapsible “All model rates” table listing every model’s $/1M-token rates, built from the same constants that price your usage.',
    detail:
      'You can now verify the exact cost-per-token used for every model and provider. The money-mode “?” panel gains a collapsible table of every OpenAI/Codex and Anthropic/Claude model, showing input / cached / cache-write (5m, 1h) / output $ per 1M tokens, split by short/long context. It is generated directly from the STANDARD_RATES and CLAUDE_RATES objects the cost math itself reads (via a new allModelRates() helper), so the displayed numbers cannot drift from the ones actually applied. The active session’s model row is highlighted; “—” marks buckets that don’t apply (Codex has no premium cache-write; pro models bill cache at the input rate).',
  },
  {
    version: 'v.60',
    title: 'Price panel fits its bounds',
    summary:
      'The money “?” pricing dropdown no longer overflows off the window’s left edge in the sidebar — it now spans the toolbar width instead of a fixed 320px pinned to the tiny button.',
    detail:
      'In the narrow sidebar the panel was absolute-positioned at a fixed 320px width anchored to the small “?” button near the right edge, so its left side ran past the window edge and clipped the text. The panel now takes a position/width class from its caller: the sidebar anchors it to the whole toolbar row (left-0 right-0) so it always fits, while the wider detail pane keeps the pinned 320px. No content changed — it just stays on-screen.',
  },
  {
    version: 'v.59',
    title: 'Leaner steps, traceable rows',
    summary:
      'Dropped the "step N" header rows — each action carries its own thin token bar (bigger when expanded); empty thinking is merged away; and every structured row is now numbered by its raw line so it traces back to the Raw pane.',
    detail:
      'The claude block used to put a "STEP N" row with a full bar above every single action, doubling the row count. Now each action (thinking / assistant / tool …) shows a ~4px token bar inline in its collapsed row, expanding to the full labelled bar — no separate step rows. Empty thinking blocks (no text) merge forward into the next real action like empty messages already did, instead of showing as blank rows. And each structured row’s number badge is now its raw JSONL line number — the same ordinal the Raw pane shows — so any part of the structured view can be cross-referenced back to the exact raw record.',
  },
  {
    version: 'v.58',
    title: 'Per-plan estimates, in an info dropdown',
    summary:
      'The plan-estimate divisor is now separate for Codex vs Claude (they’re different plans), and the ÷N tuning + explanation moved into a “?” info dropdown instead of a toolbar stepper.',
    detail:
      'A single shared ÷20 was wrong: a ChatGPT/Codex plan and a Claude/Max plan have different prices, allowances and model mixes, so their subscription-vs-API ratios differ. Each source now has its own divisor — Codex defaults to ÷20 (anchored to the owner’s own usage), Claude to ÷25 (the cited “$200 Max ≈ $5,000 API value” gap) — each independently tunable and remembered. The inline toolbar ÷N stepper is gone; both panes now show a compact “?” button that opens a dropdown explaining what the price means (API list vs plan estimate, with formula and caveats), letting you tune each plan’s divisor with the active session’s plan highlighted, and — in the detail pane — showing the verbatim API rate table with its source so any figure is traceable.',
  },
  {
    version: 'v.57',
    title: 'Honest money: API vs plan',
    summary:
      'Money mode gets a price-basis pill — theoretical API list price vs a subscription plan estimate (default ÷20) — plus a traceable pricing-model panel so no cost is a mystery.',
    detail:
      'The old money figure was the theoretical pay-as-you-go API list price, which overstates real subscription cost ~10-25× for a heavy ~$200/mo plan — that is why totals looked absurd (e.g. €93 for usage worth ~€4.5 of your allowance). A new “API list / plan est.” pill (both panes) switches the meaning: the plan estimate divides the API list price by a tunable ÷N divisor (default 20, matching the documented subscription-vs-API value gap; OpenAI/Anthropic don’t publish exact token allowances, so it is a calibrated estimate you tune with ±). A persistent caption states which price you are seeing, and a “?” panel shows the formula, the divisor, and the verbatim API rate table with its source date so any wrong-looking number can be traced. Defaults to the plan estimate.',
  },
  {
    version: 'v.56',
    title: 'Smarter titles, calmer list',
    summary:
      'Session names now prefer Claude’s own latest generated tab-label (falling back to the freshest substantive prompt), and the sidebar only re-sorts every 5 minutes so rows stop jumping.',
    detail:
      'The title used to be the frozen first prompt (e.g. "check the project"), which stops meaning anything once the session moves on. It now prefers, in order: Claude Code’s newest terminal-tab-label op (its own topic-aware title, regenerated as the conversation evolves), then a real ai-title record, then the latest substantive human prompt (skipping terse "fix"/"ok" lines), then the old title. Separately, the session list held its order for 5 minutes before re-sorting by recency — previously it re-sorted on every 5-second refresh, so the active session kept jumping to the top mid-read. New sessions still appear at the top immediately.',
  },
  {
    version: 'v.55',
    title: 'Scaled token unit',
    summary:
      'A fourth token-unit reference, "scaled", keeps the total near the raw token count, with a ± multiplier to tune it up or down.',
    detail:
      'input-eq / cached-eq / output-eq land far above or below the raw count (cached balloons, output shrinks), making it hard to see how re-weighting shifts the mix. The new "scaled" reference is output-equivalent times a tunable multiplier, so the total sits near the original token count while segments still re-weight relative to each other. When scaled is active a ±N stepper appears (both panes) to raise or lower the multiplier along a nice-number ladder; it is a token-unit multiplier, not a token multiplier, and persists across reloads.',
  },
  {
    version: 'v.54',
    title: 'Honest turn-state dots',
    summary:
      'Session rows show an amber (working), gray (waiting on you), or rose (interrupted) dot deduced from the AI’s own stop signal.',
    detail:
      'The old green “live” dots guessed from recency and lied; these read the AI’s own stop signal in the last record — Claude’s stop_reason (end_turn → waiting, tool_use → working, max_tokens → interrupted) and Codex’s final-phase message — so an ended session correctly reads “waiting”, never “working”. It reflects the turn state as of the last index (pair it with “Xm ago”), not live process state, which the transcript can’t reveal. Hover a dot for its exact meaning; logic lives in src/lib/turnState.ts.',
  },
  {
    version: 'v.53',
    title: 'Unit picker is one pill',
    summary:
      'The tokens / token units / money selector is now a single pill that cycles on click, instead of three side-by-side buttons.',
    detail:
      'Both the sidebar and the session view had a three-segment button row for the usage unit. It is now one pressable pill showing the current unit, advancing tokens → token units → money on each click — matching the reference and currency sub-toggles, which already cycle the same way. Less width, one consistent interaction for every unit control.',
  },
  {
    version: 'v.52',
    title: 'Neutral context band',
    summary:
      'The injected-entries band is now just labelled "context" with a count — dropped the "not chosen by the AI" description, since it can hold more than hooks.',
  },
  {
    version: 'v.51',
    title: 'Authorship bands per cycle',
    summary:
      'Each cycle now reads as user → hooks → claude: the human prompt, then injected context the AI did not choose, then a claude block grouping its actions by usage frame with tokens per group.',
    detail:
      'A cycle used to be a flat list mixing the owner, the harness, and the AI. It now splits by author: the user prompt (and answers) sit at top level; everything injected that the AI did not choose — environment/attachment context, session-state, hook_additional_context, Codex runtime — folds into one collapsed "hooks" band after the prompt; everything the AI chose folds into a "claude:" block. Usage is no longer an action row — each usage frame instead closes a group of the actions it measured, and its tokens become that group\'s label, so every step shows what it cost. Empty assistant turns (only thinking + a tool call) merge into the next real action instead of showing as blank rows.',
  },
  {
    version: 'v.50',
    title: 'Token units split from cost',
    summary:
      'Three usage modes now — tokens, token units, money — each with its own sub-toggle; token units measures token weight, not price.',
    detail:
      'Usage now has three independent modes instead of two. "tokens" shows raw counts. "token units" re-expresses every token type as the equivalent number of a chosen reference token (input-eq / cached-eq / output-eq) at their relative rates — so 7M mostly-cached tokens might read as ~1M output-eq, measuring how wastefully a model spends tokens regardless of absolute price, and letting you compare Codex vs Claude on token weight. "money" is the actual cost, with the currency sub-toggle ($ / ¢ / € / €¢) that used to hang off token units. The reference and currency pickers appear only for their own mode, and the currency picker is finally on the sidebar (main page) too, not just the session view.',
  },
  {
    version: 'v.49',
    title: 'Drop empty message rows',
    summary:
      'Assistant/user turns that carried only thinking + tool calls no longer render as a blank "assistant:" line — those turns already show via their thinking/tool rows.',
    detail:
      'A Claude turn whose content was purely a thinking block plus a tool call has no text block, so it flattened to an empty string and rendered as a blank message row with no preview and nothing inside. Those rows are now skipped: the turn is still fully represented by its adjacent thinking, tool, and usage rows, so no information is lost — the transcript just stops showing empty "assistant:" placeholders.',
  },
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
