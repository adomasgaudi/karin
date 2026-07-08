# Karin

A private, **local-only** viewer for [Codex CLI](https://developers.openai.com/codex/cli/) and Claude Code sessions — browse your prompts, token usage, tool calls, reasoning summaries, and code edits, reconstructed from local transcripts.

## Karin runs locally — there is no public site

Karin used to have a public GitHub Pages mirror. It was **deliberately removed** (2026-07-08) and must not be resurrected silently, for two reasons:

1. **Sensitive data.** The dataset is built from your real session transcripts — prompts, file paths, code, tool output. That cannot be shared on a public host, and publishing it would push transcripts off-machine, breaking the "transcripts stay on the machine" principle.
2. **Too much data.** The indexed dataset is far too large to ship with a static page; a static host also can't reach this PC to track live activity.

The only target is the local instance on this machine. To reach it from another device, use the Cloudflare tunnel (below) — it relays requests down to this PC; the data itself never leaves the machine or enters git.

## Two ways to run it

- **Local deploy** — `./karin.ps1` (or by hand: `pnpm build:local` + `pnpm preview`). A real, self-contained **offline** build: `build:local` uses relative asset paths and copies your real `data/karin-data.json` + `.js` into `dist/data/`, so the built app runs entirely from local files with your data baked in. Served at http://localhost:4173/. Serves a built bundle from disk, so a `src/` change needs a rebuild (`pnpm build:local`) before it shows up.
- **Dev** — `./karin.ps1 -Dev` (or `pnpm dev`). A fast Vite dev server with hot reload at http://localhost:5173/; the dev middleware auto-serves `data/`, so the app loads your real Codex data instantly. Best for hacking on the app.

(`pnpm build` still exists but ships **no** data — it is only the starting point if a public version is ever deliberately rebuilt.)

**Privacy by design:** the real dataset (`data/`, `karin-data.json`, `karin-data.js`) and the built `dist/` folder are gitignored and never committed or published — only the viewer code is.

## Stack

- **Frontend:** React 19, Vite 6, TypeScript, Tailwind v4, Radix UI, React Router, Zustand, lucide-react
- **Tooling:** pnpm
- **Indexer:** Python 3

## Run locally

Install dependencies once:

```
pnpm install
```

### Launcher (recommended)

```
./karin.ps1          # index → build:local → preview → open the local deploy
./karin.ps1 -Dev     # index → run the fast dev server (pnpm dev) instead
./karin.ps1 -Tunnel  # local deploy + Cloudflare quick tunnel (public URL to this PC)
```

`./karin.ps1` re-indexes your sessions, runs `pnpm build:local` to produce the
self-contained offline bundle, serves it with `pnpm preview` (http://localhost:4173/),
and opens your browser. Flags: `-NoOpen`, `-NoInstall`, `-Limit N`.

### By hand

Local deploy (offline build with your data):

```
pnpm index          # or: python bin/karin.py — generate data from ~/.codex sessions
pnpm build:local    # build the offline bundle; copies data/ into dist/data/
pnpm preview        # serve dist/ (default http://localhost:4173/)
```

…or the fast dev server:

```
pnpm index
pnpm dev            # start Vite; the app auto-loads data/karin-data.json
```

By default the indexer reads sessions from `~/.codex`. Set the `CODEX_HOME`
environment variable to point at a different Codex home.

## Generate / refresh data

```
python bin/karin.py            # index all sessions
python bin/karin.py --limit 20 # index only the newest 20 sessions
```

The indexer reads `~/.codex/sessions` and `~/.codex/archived_sessions`, redacts
obvious secret patterns (API keys, tokens, passwords), and writes both
`data/karin-data.json` (the app's primary source) and `data/karin-data.js`
(a `window.KARIN_DATA` wrapper convenient for drag-drop).

## Reaching it from another device (Cloudflare tunnel)

```
./karin.ps1 -Tunnel        # tunnel over the local deploy (:4173)
./karin.ps1 -Dev -Tunnel   # tunnel over the dev server (:5173)
```

Prints a `https://<random>.trycloudflare.com` URL you can open from any device. Requests
are relayed down to this PC — the data is still served locally and never copied
off-machine. The PC must stay on and the launcher window open, and anyone with the URL
can view it, so share it carefully. `tools/cloudflared.exe` (git-ignored, downloaded
per-machine) provides the binary; the launcher falls back to `cloudflared` on PATH.

## Privacy

- Karin never uploads anything. All parsing and rendering happens locally.
- The last-loaded dataset is cached in the browser's IndexedDB — local only.
- The indexer redacts common secret patterns, but review any generated file
  before sharing it. Your `data/` folder is gitignored and never published.
- There is no hosted build. If a public version is ever wanted again, it must be
  rebuilt deliberately (host workflow + absolute base path + a data strategy that
  ships **no** real transcripts) — see `CLAUDE.md`.
