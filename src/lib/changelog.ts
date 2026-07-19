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
    version: 'v.96',
    title: 'Delete versus hide',
    summary: 'Two removals: delete drops a key from your format, hide only tidies it out of the clean view.',
    detail:
      'Hiding used to mean one thing, and it meant too much: a key you merely wanted out of the way vanished as completely as one you had decided was not yours. They are now separate rules. Delete says the key is not part of your format — it is gone from every mapped view. Hide says it still belongs but is noise, so it leaves only the tidy view; schema gains its own clean/raw sub-pill to ask the same question of the structure. In the original column both stay on the page and show what you did: deleted keys struck through in red, hidden keys greyed, so an edit is legible where you made it rather than only as an absence in the other column.',
  },
  {
    version: 'v.95',
    title: 'Depth reads as hierarchy',
    summary: 'Higher layers of the JSON tree get bigger type, bolder keys and more air.',
    detail:
      'Every row used to be the same size, so the only cue for structure was indent — which makes a long feed read as one wall of text. The tree now steps four levels: the top layer is about a third larger with a bold key and a clear gap above it, and each level down shrinks back towards ordinary body text. Sizes are stated relative to the parent so nesting does not compound them, and the ladder lives in @adomas/json-tree, so Pepper gets it too.',
  },
  {
    version: 'v.94',
    title: 'Unhide all keys',
    summary: 'Settings gets a per-feed action that brings every hidden key back.',
    detail:
      'Hiding is the one edit that removes something, which makes it the one you can get stuck behind: a key you hid is no longer on screen to unhide from. Settings now offers "Unhide all <feed> keys" whenever that feed has any hide rule. It clears only the hide rules — your order, renames and groups survive, unlike the full schema reset sitting beneath it, which would undo work you never asked to lose.',
  },
  {
    version: 'v.93',
    title: 'All feeds at once, side by side',
    summary: 'Feed tabs are gone, mapped is the default, and a wide screen shows original beside mapped.',
    detail:
      'The feed tabs hid two thirds of what you had and made comparing Codex against Claude a navigation act. All three now sit on the page as collapsed branches you open when you want them, each keeping its own schema. Mapped is the default, since your format is what you came to read; on a screen wide enough — iPad and up — choosing it shows the original in a second column, so an edit can be checked against the feed it came from without toggling back and forth. Narrow screens keep mapped alone, because two columns of JSON on a phone is two unreadable columns. The original is never editable: it is the record on disk, and every edit belongs to your mapped copy.',
  },
  {
    version: 'v.92',
    title: 'Grouping is schema-only',
    summary: 'The group action now appears only in schema view, not in clean or raw.',
    detail:
      'Folding sibling keys under one object is a structural decision — it is about the shape of your format, not about the values in front of you. Offering it in clean and raw invited edits made while reading data that then silently reshaped every other view. It now shows up only where you are looking at the structure itself: mapped schema view. Hide, reorder and rename are unchanged and still available in any mapped mode.',
  },
  {
    version: 'v.91',
    title: 'Controls get their own bar',
    summary: 'Feed, mode and shape move out of the nav into a sticky bar under it.',
    detail:
      'The v.2 nav was carrying the brand, the version toggle, three feed tabs, three mode buttons, two shape buttons and a gear — too much for one row, and worst on the narrow screen where it matters. The three choices now sit in their own sticky bar directly below, drawn by one segmented-pill component rather than three near-identical blocks that would drift apart. The nav keeps what identifies the app; the bar keeps what you actually change while reading.',
  },
  {
    version: 'v.90',
    title: 'Mapped becomes an axis',
    summary: 'Every view now has an original and a mapped version, instead of mapped being a fourth mode.',
    detail:
      'Mapped sat in the same row as clean, raw and schema, which forced a false choice: picking your own format meant giving up raw values, and reading the shape meant giving up your edits. The two are separate questions — what the values look like, and whether your schema is applied — so they are now separate toggles. Any of the three modes can be read original or mapped, so you can see the raw bytes in your key order, or the bare shape with nothing of yours on it. Editing lives in mapped, where an edit lands somewhere you can see it; original is read-only by design.',
  },
  {
    version: 'v.89',
    title: 'Keys go neutral',
    summary: 'Keys are grey in every palette — hue is reserved for the values that vary.',
    detail:
      'A key labels a row; it does not carry data. Colouring it competes with the values for attention and spends a hue on the one thing that looks the same on every line. Keys now use near-zero chroma and earn their prominence from contrast instead — darker than everything else on a light page, brighter on a dark one. The custom palette loses its key slider accordingly, since offering a control that barely does anything implies a choice that is not really there.',
  },
  {
    version: 'v.89',
    title: 'Group keys into one object',
    summary: 'Schema view can fold sibling keys — three timestamps, say — under one named object.',
    detail:
      'Hovering a row in schema view now offers "group" beside rename and hide. Type a name and the key moves under an object of that name; type the same name on a sibling and the two sit together. The group lands where its first member sat, so it reads as a fold of the rows you picked rather than a jump to the bottom. Leaving the name blank takes a key back out, and a group with no members left disappears. Like every other schema edit this is a rule kept beside the data, replayed over each fresh feed, so it survives the reindex that overwrites the file.',
  },
  {
    version: 'v.88',
    title: 'Pick colours by data type',
    summary: 'A custom palette where each type gets its own hue, kept balanced by OKLCH.',
    detail:
      'Choosing the custom palette reveals a hue slider per data type — keys, strings, numbers, nulls. The colours are built in OKLCH, where equal numbers mean equal appearance, so lightness and chroma are held fixed per theme and only hue is yours to move. That is what stops one type shouting over the others, which is exactly what happens when four colours are picked by eye in hex. Named harmonies (spectrum, warm, cool, triad) set all four at once by the spacing between them. The colours reach the tree as CSS variables, since Tailwind cannot emit a class for a colour chosen at runtime.',
  },
  {
    version: 'v.87',
    title: 'Schema compiler, your format',
    summary: 'Edits in schema view become rules that are replayed over every fresh feed.',
    detail:
      'The feeds are regenerated every few seconds, so an edit written into them would be gone by the next refresh — and writing back into the transcripts would corrupt them. So an edit becomes a rule instead: drag to order, rename, or hide a key, and it is saved beside the data as a path-keyed spec. A new mapped mode shows the compiled result, which is the shape the rest of Karin would consume. One rule covers every element of an array, so you arrange the shape once rather than once per row. Specs are per feed and persist in localStorage.',
  },
  {
    version: 'v.86',
    title: 'Settings menu opens again',
    summary: 'The nav bar was clipping its own popover, so the gear button appeared to do nothing.',
    detail:
      'The shared nav scaffold carried overflow-hidden to stop the tab strip spilling on a narrow screen. The settings popover is absolutely positioned inside that same bar, so the clip applied to it too: the menu did open, was rendered, and was cut away to nothing. The bar now relies on flex-nowrap for the tabs and sits on its own stacking context, so the popover escapes. This affects both versions, since v.1 and v.2 render the same shell.',
  },
  {
    version: 'v.86',
    title: 'Schema view, colours, reorder',
    summary: 'A third viewer mode showing shape not payload, a palette setting, and drag-to-reorder keys.',
    detail:
      'The v.2 viewer gains a schema mode: every value replaced by its type, arrays merged into one representative element, so a 4000-entry feed reads as a page of structure. In that mode rows can be dragged to reorder keys, with the order kept outside the data as a path-to-keys map. A palette picker sits in the settings menu. All of it landed in @adomas/json-tree rather than in Karin — these are viewer features, not Karin features, so Pepper gets them too.',
  },
  {
    version: 'v.85',
    title: 'v.2 clean/raw toggle',
    summary: 'The raw-feed viewer gains a clean mode with readable Vilnius timestamps, and a raw mode.',
    detail:
      'v.2 showed ISO timestamps exactly as the indexers wrote them — precise, unreadable. A clean/raw switch now sits in the nav. Clean walks a copy of the feed and rewrites only date-like values to Vilnius day + time without seconds; epoch numbers under time-ish keys get the same treatment. Raw is byte-for-byte what is on disk. Both go through the same JsonTree, so collapse/expand and the big-array paging guards are identical, and the JSON on disk is never touched.',
  },
  {
    version: 'v.84',
    title: 'One shared nav, denser chrome',
    summary: 'Brand, pages and settings live in one half-height nav bar shared by v.1 and v.2.',
    detail:
      'The nav bar now carries the logo, version toggle, page tabs and the settings gear, at half the previous padding, sized to fit a phone without wrapping or scrolling. NavBarShell is the scaffold both Karin versions render — v.2 passes its feed tabs and its own settings, so the chrome cannot drift. The sidebar keeps one row: a shorter search field, every unit control fused into a single "money · € · plan" pill, and the four source buttons replaced by one cycling All/Codex/Claude/Warp toggle. The "N sessions / generated" line is gone, freshness moved next to the gear, and each list row folds its cost, project and turn counts onto the usage bar itself. Money in euros is now the default.',
  },
  {
    version: 'v.83',
    title: 'v2 shows the raw feeds',
    summary: 'v.2 renders the Codex/Claude/Warp JSON directly, using the same viewer package as Pepper.',
    detail:
      'v.1 shows a heavily interpreted view — cycles, attributed usage, pricing — which is exactly what felt overwhelming. v.2 starts at the other end: the raw indexer output, in a collapsible tree, with a tab per source. The viewer is not a copy of the one in Pepper: JsonTree moved out into its own repo, @adomas/json-tree, linked into both apps, so one edit changes both. It keeps the hard-won guards — big arrays never expand eagerly and page in 100 at a time.',
  },
  {
    version: 'v.82',
    title: 'Real sticky nav bar',
    summary: 'Sessions / Timeline / Summary are sticky tabs above every page, not buttons.',
    detail:
      'Timeline and Summary were reachable only as buttons buried in the sidebar toolbar, and each page carried its own "← Sessions" button to get back — navigation disguised as actions. There is now one sticky nav bar above the whole app with three underlined tabs, so the current page is always visible and every page is one click away. The per-page back buttons and the sidebar Timeline/Summary buttons are gone; pages now fill the space under the bar instead of claiming the full viewport height.',
  },
  {
    version: 'v.81',
    title: 'v2 gets logo and settings',
    summary: 'The v.2 header carries the Karin glasses and a gear menu holding the theme toggle.',
    detail:
      'The glasses SVG was inline in the sidebar; it is now a shared KarinLogo component used by both versions so they cannot drift. v.2 gains the same gear popover pattern as v.1, but holding only what it currently has — the light/dark switch — and the page itself is now theme-aware rather than hard-coded black. A separate explainer, docs/how-karin-works.html, walks through the whole pipeline in plain language.',
  },
  {
    version: 'v.80',
    title: 'Nav bar and settings menu',
    summary: 'Timeline is the nav button; Summary, exports, Load and theme move into a ⚙ menu.',
    detail:
      'The sidebar header row held six controls side by side and overflowed the pane. Only Timeline is a real navigation destination, so it stays inline; Summary, the AI gist/full exports, Load and the dark-mode switch are occasional and now live behind a single gear popover. The units controls lost their "units" label and share one tighter row with the All/Codex/Claude/Warp source filter, which is right-aligned there instead of competing for space in the header.',
  },
  {
    version: 'v.79',
    title: 'Version label toggles v1v2',
    summary: 'The v.2.0 label is itself the way back to v.1 — the separate back button is gone.',
  },
  {
    version: 'v.78',
    title: 'Header toolbar wraps',
    summary: 'The sidebar toolbar no longer overflows its pane — buttons wrap to a second row.',
  },
  {
    version: 'v.77',
    title: 'Karin v.2.0 shell',
    summary: 'Clicking the sidebar version opens a blank v.2.0 page; v.1 stays fully intact.',
    detail:
      'A parallel rebuild starts here. The existing session UI was informative-per-pixel but overwhelming, so rather than refactor it in place, v.2 gets its own view (`view === "v2"`) and its own root component — currently an empty black page with a back link. Both versions run side by side so they can be compared before anything is retired.',
  },
  {
    version: 'v.76',
    title: 'Watchers die with the launcher',
    summary: 'Closing the launcher window no longer leaves indexers running behind a dead server.',
    detail:
      'The server holds the launcher console in the foreground, but the watchers and cloudflared were detached background processes cleaned up only by a `finally` block — which never runs if the window is closed rather than Ctrl+C’d. The result was a silent split brain: the indexers kept rewriting data/ every few seconds while nothing served the page, so the feeds looked perfectly current and the tunnel 502’d. They are now bound to a Win32 job object with KILL_ON_JOB_CLOSE, so the OS terminates every child — and their grandchildren — whenever the launcher dies, by any means.',
  },
  {
    version: 'v.75',
    title: 'Warp + DeepSeek sessions',
    summary: 'Third source: Warp terminal agents, including v4-flash and v4-pro runs on your own API keys.',
    detail:
      'A new indexer reads Warp’s local SQLite and decodes its undocumented protobuf task blobs into prompts, reasoning, assistant replies, tool calls and file diffs — so DeepSeek runs appear beside Codex and Claude, filterable and searchable, with a Raw tab preserving every field. Warp mixes models per conversation, so each session is labelled by its primary agent and the ⋮ popover lists every model’s token share. Warp logs one cumulative token scalar per model with no input/output split, so these sessions show tokens but no money — a cost figure would be a guess.',
  },
  {
    version: 'v.74',
    title: 'Summary page',
    summary:
      'New Summary view reconstructs what happened as 10–20 work items and shows where effort went per project, with log-rule altitude.',
    detail:
      'A "Summary" button in the sidebar opens a page with Today / 7 days / All ranges. It groups sessions by project, shows an effort-share bar (tokens, wall time, session counts), then lists at most 20 reconstructed work items. Altitude follows the log rule: if one project holds ≥50% of the effort, its items are specified individually (retry sessions folded by normalized title) while other projects collapse to one line each; if effort is spread, every project stays a one-liner with a few title clues.',
  },
  {
    version: 'v.73',
    title: 'Gist export',
    summary:
      'New "AI gist" export compresses all sessions to ~1–3 lines each — clues, not completeness; the full digest moved to a secondary button.',
    detail:
      'The v.71 full export ran ~2000 lines for a day of work — too much as AI input. The gist keeps only the vital signals per session: date/time, source+project, title, up to 3 prompts sampled across the session (start…end fragments of long texts), the top edited files, and a compact prompts/tools/edits/tokens tally. It is deliberately lossy: enough for a reading AI to reconstruct roughly what happened. The sidebar button now downloads the gist; "full" sits beside it.',
  },
  {
    version: 'v.72',
    title: 'Docs: local-only',
    summary:
      'README now documents that Karin runs locally only — the public GitHub Pages build is gone.',
    detail:
      'The README still described a public GitHub Pages deploy that was deliberately removed on 2026-07-08. It now states the two reasons Karin is local-only — session transcripts are sensitive and cannot be published, and the dataset is too large for a static host — and documents the Cloudflare tunnel (./karin.ps1 -Tunnel) as the way to reach the local instance from another device.',
  },
  {
    version: 'v.71',
    title: 'AI-handoff export',
    summary:
      'New sidebar "AI export" button downloads all sessions as one markdown digest another AI can summarize.',
    detail:
      'The digest (karin-ai-export-<date>.md) opens with instructions for the reading AI, then lists every session chronologically: when/where/model/token totals, and each human prompt cycle with the tools used, files edited, and a clipped excerpt of the final reply. Works across both sources (Codex + Claude) via the unified cycle builder. Excerpts are truncated on purpose — it is a summarization input, not an archive.',
  },
  {
    version: 'v.70',
    title: 'Per-cycle model pricing',
    summary:
      'Cycles are now priced by the model that answered them, so money mode re-weighs sonnet vs fable cycles after a mid-session switch.',
    detail:
      'All bars and timeline segments in a session used ONE rate table — the session-level model — so after a mid-session model switch, toggling token units → money changed nothing: Claude rate tables are proportional to each other, and only the absolute per-model rate distinguishes a sonnet cycle from a fable one. Cycle bars in the session detail and cycle segments on the timeline now look up rates from their own cycle\'s model (falling back to the session model), so a fable cycle correctly grows ~3.3× relative to a sonnet cycle in money mode.',
  },
  {
    version: 'v.69',
    title: 'One scale for all lines',
    summary:
      'In-pill usage lines now share one global value→pixel scale — a €0.10 session\'s line sits 10× lower than a €1 session\'s instead of both topping out their pills.',
    detail:
      'Each pill\'s line was normalized to its own total, so every session\'s line ended at its own pill top and slopes were incomparable. Now one value→pixels ratio (set by the most expensive session at 75px) drives both pill heights and line heights: the line ends at the session\'s true value height, which only touches the pill top for the biggest session. Pills below the 16px hover minimum keep their true (lower) line inside the clamped pill.',
  },
  {
    version: 'v.68',
    title: 'Halved pills, 2-axis pan',
    summary:
      'Max pill height halved (150→75px) and dragging now pans vertically through lanes as well as through time.',
  },
  {
    version: 'v.67',
    title: 'Cost-proportional timeline pills',
    summary:
      'Pill height now scales with total usage on one global scale, the usage line stays flat while idle, cycles are clickable, and the units toggle (tokens/tu/money) lives on the page.',
    detail:
      'Expensive sessions are now visibly thick and cheap ones thin: every pill\'s height is proportional to its total usage in the active unit, measured against one shared scale, bottom-aligned per lane for honest comparison. The cumulative line switched to a step profile — it climbs only across a cycle\'s span and holds flat through idle gaps, since no tokens are spent while idle. Clicking an individual cycle (not just the pill) now opens the session — pointer capture was swallowing child clicks; it now engages only after a real drag starts. The header gains the same global tokens / token-units / money toggle as the sidebar, and all heights, labels and tooltips re-express in the chosen unit.',
  },
  {
    version: 'v.66',
    title: 'Zoomable cycle timeline',
    summary:
      'Timeline is now continuously zoomable (minutes → months) and pannable; pills turned neutral, segmented by real cycles with idle gaps, a cumulative token area-line, and cost tooltips.',
    detail:
      'The day-paged bars are gone. One continuous canvas: scroll to zoom around the cursor (1 minute to ~4 months across the screen), drag or shift-scroll to pan, ←/→ and ±  keys work, and 1h/Day/Week/All/Now presets jump around. Session pills are now light neutral containers — the darker accent-tinted blocks inside are the actual cycles (prompt → work), so idle stretches within a session finally show as light gaps. A gray area-line under the segments plots tokens accumulating across the session (the cost story); hovering any cycle shows its prompt, times, duration, tokens and cost, and the pill shows totals. Cycle extraction is cached per session so the 5s data poll stays cheap.',
  },
  {
    version: 'v.65',
    title: 'Model switch shows same cycle',
    summary:
      'A mid-session model change now tags the cycle it happened in, not one cycle late.',
    detail:
      'Cycle model/effort labels used the latest turn_context at or before the cycle\'s FIRST line. Claude records a model change on the first assistant message with the new model — which lands after the cycle-opening user prompt — so the very cycle where you switched models still showed the old model. Labels now resolve against the cycle\'s last line, so the switch cycle is tagged with the model that actually answered it. Codex cycles are unaffected (their turn_context precedes the turn).',
  },
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
