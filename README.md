# Karin

A private, local viewer for [Codex CLI](https://developers.openai.com/codex/cli/) sessions — browse your prompts, token usage, tool calls, reasoning summaries, and code edits, reconstructed from local transcripts.

## Two modes

Karin runs from **one** codebase in two modes:

- **LOCAL** — you run it on your own machine (`pnpm dev` / `./karin.ps1`). The Python indexer reads your real Codex sessions into `data/karin-data.json`, and the app auto-loads that file. Everything is offline; your transcripts never leave your machine.
- **ONLINE** — the public GitHub Pages build. It ships **no data**. Visitors drag-drop a file they generated themselves; parsing happens entirely in their browser.

**Privacy by design:** the real dataset (`data/`, `karin-data.json`, `karin-data.js`) is gitignored and is never committed or published. The public site is empty until someone loads their own file.

## Stack

- **Frontend:** React 19, Vite 6, TypeScript, Tailwind v4, Radix UI, React Router, Zustand, lucide-react
- **Tooling:** pnpm
- **Indexer:** Python 3

## Run locally

Install dependencies once:

```
pnpm install
```

Then either do it in two steps:

```
pnpm index      # or: python bin/karin.py  — generate data from your ~/.codex sessions
pnpm dev        # start Vite; the app auto-loads data/karin-data.json
```

…or just run the launcher, which does both and opens your browser:

```
./karin.ps1
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
