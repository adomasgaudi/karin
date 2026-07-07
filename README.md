# Karin

A private, local viewer for [Codex CLI](https://developers.openai.com/codex/cli/) sessions — browse your prompts, token usage, tool calls, reasoning summaries, and code edits, reconstructed from local transcripts.

## Three ways to run it

- **Dev** — `pnpm dev` (or `./karin.ps1 -Dev`). A fast Vite dev server with hot reload; the dev middleware auto-serves `data/`, so the app loads your real Codex data instantly. Best for hacking on the app.
- **Local deploy** — `pnpm build:local` + `pnpm preview` (or just `./karin.ps1`). A real, self-contained **offline** build: `build:local` uses relative asset paths and copies your real `data/karin-data.json` + `.js` into `dist/data/`, so the built app runs entirely from local files with your data baked in. `pnpm preview` serves it (default http://localhost:4173/).
- **Online** — the public GitHub Pages build (`pnpm build`). It ships **no data**. Visitors drag-drop a file they generated themselves; parsing happens entirely in their browser.

**Privacy by design:** the real dataset (`data/`, `karin-data.json`, `karin-data.js`) and the built `dist/` folder are gitignored and never committed or published — only the empty viewer code is. The public site is empty until a visitor loads their own file.

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

## Deploy (GitHub Pages)

Push to `main`. The [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
GitHub Action builds the app and deploys it.

One-time setup: in the repo **Settings → Pages**, set **Source = "GitHub Actions"**.

The public site ships no data, so it stays empty until a visitor loads their own
generated file.

## Privacy

- Karin never uploads anything. File parsing happens entirely in-browser.
- The last-loaded dataset is cached in the browser's IndexedDB — local only.
- The indexer redacts common secret patterns, but review any generated file
  before sharing it. Your `data/` folder is gitignored and never published.
