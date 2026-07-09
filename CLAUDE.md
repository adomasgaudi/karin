# Karin — agent handoff

Read this before touching anything in `karin/`. It overrides the parent
`Meta apps/CLAUDE.md`, whose `template.html` / `build_site.py` workflow describes a
DIFFERENT project and does **not** apply here.

**The owner works on and sees the LOCAL version. It is the ONLY target.** There is no
public/hosted build anymore — the GitHub Pages deploy was deliberately removed (see the
bottom). Do not re-add a public deploy, an online build, or a `BASE_PATH` unless the owner
explicitly asks to rebuild the public version. To reach the local instance from another
device, use the Cloudflare tunnel (`./karin.ps1 -Tunnel`), not a hosted build.

## What Karin is

A local AI-session viewer. **React 19 + Vite 6 + TypeScript + Tailwind v4**, state in
Zustand. It loads token-usage / prompt / tool data and renders it as sessions → cycles →
events with usage bars. Transcripts stay on the machine.

**Three sources, one framework** (`SessionSource = 'codex' | 'claude' | 'warp'`). Never
build a per-AI UI: each source has its own indexer that emits a JSON feed, an adapter into
the shared `UnifiedSession`, and then flows through one cycle builder and one renderer.

| Source | Indexer | Feed | Reads |
| --- | --- | --- | --- |
| Codex | `bin/karin.py` | `data/karin-data.json` | `~/.codex/sessions/**.jsonl` |
| Claude | `bin/karin_claude.py` | `data/claude-raw.json` | `~/.claude/projects/**.jsonl` |
| Warp | `bin/karin_warp.py` | `data/warp-raw.json` | `%LOCALAPPDATA%/warp/Warp/data/warp.sqlite` |

Its own git repo (`origin → github.com/adomasgaudi/karin.git`), separate from the
`Meta apps` repo. Commit style here is plain descriptive subjects (see `git log`), NOT the
parent repo's `vN RULE-ID | … | N sp` format.

## The local version — how the owner runs it

Two ways, both via the launcher `./karin.ps1` (re-indexes Codex data into `data/` first):

| Command | Mode | Port | Notes |
| --- | --- | --- | --- |
| `./karin.ps1` | **Local deploy** | http://localhost:4173/ | Real offline build (`pnpm build:local`), your data baked into `dist/data/`, served by `pnpm preview`. Serves a BUILT bundle → needs a rebuild to reflect `src/` changes. |
| `./karin.ps1 -Dev` | **Dev server** | http://localhost:5173/ | `pnpm dev`, hot reload, auto-serves `data/`. Fastest for iterating — no build step. |
| `./karin.ps1 -Tunnel` | **+ public tunnel** | `*.trycloudflare.com` | Adds a Cloudflare quick tunnel over the local deploy (or `-Dev -Tunnel` over :5173). Live, served from this PC; data never leaves the machine or git. PC must stay on. |

To SEE a `src/` change on the local deploy (`:4173`) you must rebuild the bundle:
`pnpm build:local` (the running `pnpm preview` serves `dist/` from disk, so a rebuild
updates it live — just refresh the browser). On the dev server (`:5173`) changes hot-reload
automatically.

Check what's up: `Get-NetTCPConnection -LocalPort 4173,5173 -State Listen`.

## The build — local only

There is one target, so both build scripts now use relative asset paths (`base: './'`) and
differ only in whether they bake your data in:

- **`pnpm build:local`** (offline mode) → re-bakes `data/` into `dist/data/`; the build
  behind the local page at `localhost:4173/`. This is the one you want locally.
- **`pnpm build`** → same relative-path bundle, but ships **no** data. Only useful as the
  starting point if the owner ever asks to rebuild a public version.

The old "online build → `/karin/` absolute paths → blank local page" trap is gone (there's
no absolute base anymore). If the local page is still blank, rerun `pnpm build:local` and
verify `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/` is `200`.

## Where things live

| Path | What |
| --- | --- |
| `src/App.tsx` | Root: sidebar + detail layout, theme |
| `src/components/Sidebar.tsx` | Left pane: top "Karin" header + session list rows |
| `src/components/SessionDetail.tsx` | Right pane: one session — header, usage bars, cycles |
| `src/components/Cycle.tsx`, `EventEntry.tsx` | Per-turn / per-event rendering |
| `src/components/AgeIndicator.tsx` | Single live "Xm ago" relative age (`value` prop) |
| `src/components/DateStamp.tsx`, `UsageBar.tsx`, `ContextAudit.tsx` | Display widgets |
| `src/lib/format.ts` | `shortAge`, `dateParts`, number/date formatting |
| `src/lib/pricing.ts` | Model rates, token-unit + currency modes |
| `src/lib/cycles.ts` | Builds cycles from a session; per-cycle usage |
| `src/lib/loadData.ts` | Parses the loaded data file into the store shape |
| `src/lib/appVersion.ts` | `APP_VERSION` string shown in the UI |
| `src/store/karin.ts` | Zustand store (data, selection, theme) |
| `src/types.ts` | Shared TS types for the data model |
| `bin/karin.py` | Python indexer: scans local Codex sessions → `data/*.json` |
| `bin/karin_claude.py` | Python indexer: Claude Code transcripts → `data/claude-raw.json` |
| `bin/karin_warp.py` | Python indexer: Warp's SQLite → `data/warp-raw.json` (see below) |
| `src/lib/warpRaw.ts` | Warp feed types + `isWarpRawData` guard |
| `karin.ps1` | Windows launcher (local deploy, or `-Dev` dev server) |
| `vite.config.ts` | Build config; `--mode offline` = the local build. **`DATA_FILES` is an allowlist — a new feed must be added there or it never reaches `dist/data/`.** |

`data/` (generated) and `dist/` (built) are git-ignored — never commit them.

## Warp source (DeepSeek v4-flash / v4-pro)

Warp is the owner's terminal agent, running their own DeepSeek endpoint alongside Warp's
built-in models. `bin/karin_warp.py` reads Warp's local SQLite — it **snapshots db+wal+shm
to a temp dir and opens the copy read-only**, so Warp is never locked or written to.

Tables: `agent_conversations` (per-model token totals, `agent_name`, run id),
`ai_queries` (typed prompts, cwd, status), `agent_tasks` (a **protobuf BLOB** per task).

**The protobuf has no shipped schema.** `decode_fields` walks the wire format generically.
Field numbers were derived from live data and are the fragile part — a Warp update could
move them. Inside a task, `f5` repeats one event: `f1` uuid, `f13` turn id, `f14` a
`Timestamp`, and one payload field naming the kind — `f3` assistant, `f15` reasoning,
`f4` tool call, `f5` tool result. **Tool identity is the payload's field number** (`f2`
run_command, `f5` read_files, `f6` apply_file_diff, `f15` file_glob, `f30` task_report,
`f35` spawn_subagent). Unnamed fields are preserved verbatim in each record's `tree` and
surface in the Raw tab, so nothing is silently dropped. A `tool_result`'s field number does
**not** mirror its call's — resolve the tool name via `call_id`, never from the result.

Two facts that shape the UI, both deliberate:

- **Warp mixes models in one conversation.** A primary agent (`v4-flash`/`v4-pro`) plus
  small built-ins for tool summarization and terminal use. `model` is whichever is billed
  under the `primary_agent` category; `models` lists everyone who spent tokens.
- **Warp is not priced, on purpose.** It records one cumulative token scalar per model —
  no input/output split — and the two bill at very different rates. `ratesForUnified`
  returns `null` for warp, `attributeCycleUsage` gives warp cycles no usage bars, and the
  detail header says "Not priced". Do **not** "fix" this by inventing a split ratio.

The indexer emits **Codex-shaped arrays** (`Message`/`Tool`/`Reasoning`/`CodeEdit`) so
`warpEntries` reuses the Codex flattener and the renderer needs no Warp item types. Keep it
that way. Live updates: `karin_warp.py --watch` polls the sqlite mtime and rewrites the
feed; the app re-fetches every 5s (`refreshLocalData`).

## Version rule (every material change)

Bump the owner-facing `v.N` in **both** spots, keep them in sync:
- `src/lib/appVersion.ts` → `APP_VERSION`
- `package.json` → `displayVersion`

Increment by one per material change. End your reply naming the shift, e.g. `v.13 → v.14`.

## Push policy

**Commit + push to `main` after every change, automatically — do NOT ask.** The owner
confirmed this on 2026-07-08. Plain descriptive commit subjects (see `git log`), not the
parent repo's `vN RULE-ID | … | N sp` format. LF→CRLF warnings on commit are expected.

## Live-deploy rule — commit ≠ live (READ THIS)

**The owner views the BUILT bundle at http://localhost:4173/, NOT your source.** A commit
does NOT update it — `:4173` serves `dist/` from disk, so your change is invisible there
until `dist/` is rebuilt. This is the #1 recurring mistake: an AI commits, says "it's
live", and the owner still sees the old version. Do not claim live off a commit.

- A **post-commit hook** (`.githooks/post-commit`, enabled via `git config core.hooksPath
  .githooks`) now **auto-rebuilds `dist/` after every commit** — so a browser refresh on
  `:4173` shows it. If you clone fresh or the config is lost, re-run that `git config`.
- **Always verify** after a change: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/`
  is `200`, and the served JS carries the new version. Then tell the owner to hard-refresh
  (Ctrl+Shift+R) to bust the browser cache.
- The **`:5173` dev server hot-reloads** and needs no rebuild — the fastest way to see a
  change live is `./karin.ps1 -Dev`.

## Gotchas

- Line endings: working tree is LF, git normalizes to CRLF on Windows checkout — the
  `LF will be replaced by CRLF` warnings on commit are expected, ignore them.
- Keep `data/` and `dist/` out of git (generated & git-ignored); edit `src/`, not the
  generated output.
- `pnpm-workspace.yaml` only holds `allowBuilds: esbuild: true` (pnpm 10 build approval).

## Removed: the public GitHub Pages build

There used to be a public mirror at `adomasgaudi.github.io/karin`, published by
`.github/workflows/pages.yml` on every push to `main`. **It was deliberately removed** (2026-07-08):
the workflow is deleted and the GitHub Pages site is disabled. Karin is a live, personal,
local dashboard — a static public host can't reach your PC to track activity, and publishing
data would push transcripts off-machine, breaking the "transcripts stay on the machine"
principle.

If the owner ever wants a public version again, it must be **rebuilt from scratch**: re-add a
Pages (or other host) workflow, reintroduce an absolute `base`/`BASE_PATH` in `vite.config.ts`,
and decide a data-sync strategy. Don't resurrect it silently.

## Reaching the local version remotely (Cloudflare tunnel)

`./karin.ps1 -Tunnel` (or `-Dev -Tunnel`) runs the local server **and** a Cloudflare quick
tunnel, printing a `https://<random>.trycloudflare.com` URL you can open from any device. It
relays requests down to this PC — the data is still served locally and never copied off the
machine or into git. `tools/cloudflared.exe` (git-ignored, downloaded per-machine) provides
the binary; the launcher falls back to `cloudflared` on PATH. The PC must stay on and the
launcher window open, and anyone with the URL can view it, so share it carefully. For a
private-only mesh to your own devices instead of a public URL, Tailscale is the alternative
(not wired into the launcher).
