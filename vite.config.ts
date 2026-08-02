import { defineConfig } from 'vite'
import type { PreviewServer, ViteDevServer } from 'vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, createReadStream, mkdirSync, copyFileSync, cpSync, openSync, closeSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { execFile, spawn } from 'node:child_process'

const root = dirname(fileURLToPath(import.meta.url))
// Every top-level feed the app fetches. A file missing here never reaches dist/data/, so the
// local deploy at :4173 would silently serve a bundle without that source.
const DATA_FILES = [
  'karin-data.json',
  'karin-status.json',
  'claude-raw.json',
  'claude-status.json',
  'warp-raw.json',
  'warp-status.json',
]

// Dev only: serve the locally-generated data/ files (e.g. karin-data.json) so the
// app auto-loads real Codex data during `pnpm dev`. NOT part of the build, so a plain
// `pnpm build` bundle never ships any transcript data (only `build:local` bakes it in).
function serveLocalData() {
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      const url = req.url?.split('?')[0]
      if (url && url.startsWith('/data/')) {
        const file = join(root, decodeURIComponent(url))
        if (existsSync(file)) {
          res.setHeader('content-type', url.endsWith('.json') ? 'application/json' : 'text/plain')
          res.setHeader('cache-control', 'no-store')
          // The 5s poll asks HEAD first and only downloads a feed whose tag moved
          // (see feedTag in src/lib/loadData.ts). This middleware answers every
          // /data/ request, so WITHOUT these two headers there is no tag at all:
          // feedTag returns null, which the store reads as "assume changed", and
          // every single tick re-downloads and re-parses ~200 MB of feed on the
          // main thread. That is not a slow refresh, it is a permanent freeze —
          // the page stops picking up new sessions. Stat the file and hand back a
          // tag so an idle tick costs three tiny requests again.
          try {
            const st = statSync(file)
            res.setHeader('etag', `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`)
            res.setHeader('last-modified', st.mtime.toUTCString())
            res.setHeader('content-length', String(st.size))
          } catch {
            // A file being replaced mid-stat still gets served, just untagged.
          }
          // A HEAD needs the headers only; reading the body would defeat the point.
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          const stream = createReadStream(file)
          // A rebuilt preview can briefly release its old dist/data file while a browser
          // is fetching it. Serve the live source feed instead, and fail a request rather
          // than letting Node's unhandled stream error take down the whole preview server.
          stream.on('error', () => {
            if (!res.headersSent) res.statusCode = 503
            res.end()
          })
          stream.pipe(res)
          return
        }
      }
      next()
    })
  }
  return {
    name: 'karin-serve-local-data',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

// LOCAL build only (`--mode local`): copy your real data/ files into dist/data so the
// built app is a self-contained, offline "local deploy" that loads your own sessions.
// This runs ONLY in local mode — the default/online build never touches data/.
function bundleLocalData() {
  return {
    name: 'karin-bundle-local-data',
    apply: 'build' as const,
    closeBundle() {
      const outDir = join(root, 'dist', 'data')
      let copied = 0
      for (const name of DATA_FILES) {
        const src = join(root, 'data', name)
        if (existsSync(src)) {
          mkdirSync(outDir, { recursive: true })
          copyFileSync(src, join(outDir, name))
          copied++
        }
      }
      // Split feeds keep their heavy transcript arrays in per-session bodies. Vite clears
      // dist/ before this hook runs, so the indexer's earlier mirror is not enough: copy
      // the body tree here as part of the same self-contained offline build.
      const sessionsSrc = join(root, 'data', 'sessions')
      if (existsSync(sessionsSrc)) {
        cpSync(sessionsSrc, join(outDir, 'sessions'), { recursive: true })
        copied++
      }
      if (!copied) {
        // eslint-disable-next-line no-console
        console.warn('[karin] local build: no data/ files found — run `python bin/karin.py` first.')
      }
    },
  }
}

// Keep DeepSeek credentials in the local Vite process instead of replacing them into
// the browser bundle. The same middleware is active for both :5173 dev and :4173 preview.
function deepSeekProxy(apiKey: string | undefined) {
  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('DeepSeek proxy accepts POST only.')
      return
    }
    if (!apiKey) {
      res.statusCode = 503
      res.end('DeepSeek API key is not configured in .env.local.')
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', async () => {
      try {
        const upstream = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: Buffer.concat(chunks),
        })
        res.statusCode = upstream.status
        upstream.headers.forEach((value, key) => {
          // Node fetch may transparently decompress the body; forwarding the old
          // encoding/length would make the browser try to decode it a second time.
          if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key)) res.setHeader(key, value)
        })
        if (upstream.body) {
          Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res)
        } else {
          res.end()
        }
      } catch (error) {
        res.statusCode = 502
        res.end(error instanceof Error ? error.message : 'DeepSeek proxy failed.')
      }
    })
  }
  const attach = (server: { middlewares: { use: (path: string, middleware: typeof handler) => void } }) => {
    server.middlewares.use('/api/deepseek', handler)
  }
  return {
    name: 'karin-deepseek-proxy',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

// The three feed watchers, as started by karin.ps1. The page cannot spawn processes, but
// the Vite server that serves it runs on the owner's PC — so it checks and restarts them.
// Each indexer takes a per-source lock file, so starting an already-running watcher is a
// no-op (the duplicate prints "already running" and exits).
const WATCHERS = [
  { id: 'codex', script: 'karin.py', log: 'karin-watch' },
  { id: 'claude', script: 'karin_claude.py', log: 'claude-watch' },
  { id: 'warp', script: 'karin_warp.py', log: 'warp-watch' },
] as const

// Which watchers are alive right now, by scanning process command lines for
// "<script> --watch". Heartbeat files can't answer this: the Warp watcher only rewrites
// its status when the sqlite changes, so a stale file there just means "idle".
function queryWatchers(): Promise<Record<string, boolean>> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%--watch%'" | Select-Object -ExpandProperty CommandLine`,
      ],
      { windowsHide: true, timeout: 15000 },
      (error, stdout) => {
        const commandLines = error ? '' : stdout
        resolve(Object.fromEntries(WATCHERS.map((w) => [w.id, commandLines.includes(w.script)])))
      },
    )
  })
}

function startWatchers() {
  const logDir = join(root, 'data')
  mkdirSync(logDir, { recursive: true })
  for (const w of WATCHERS) {
    // Append to the same logs karin.ps1 writes, then detach — the watcher must outlive
    // this request and keep running even if the Vite server is later restarted.
    const out = openSync(join(logDir, `${w.log}.log`), 'a')
    const err = openSync(join(logDir, `${w.log}.err.log`), 'a')
    const child = spawn('python', [join(root, 'bin', w.script), '--watch'], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err],
    })
    child.unref()
    closeSync(out)
    closeSync(err)
  }
}

// GET /api/watchers → which watchers run; POST /api/watchers/start → start the missing
// ones and report the resulting state. Active for both :5173 dev and :4173 preview.
function watcherControl() {
  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const respond = (running: Record<string, boolean>) => {
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify({ running }))
    }
    const path = req.url?.split('?')[0] || '/'
    if (req.method === 'GET' && (path === '/' || path === '')) {
      void queryWatchers().then(respond)
      return
    }
    if (req.method === 'POST' && path === '/start') {
      startWatchers()
      // Give the spawned processes a moment to appear (or to exit on the lock),
      // so the response reflects reality instead of the pre-start snapshot.
      setTimeout(() => void queryWatchers().then(respond), 1500)
      return
    }
    res.statusCode = 404
    res.end('Unknown watcher endpoint.')
  }
  const attach = (server: { middlewares: { use: (path: string, middleware: typeof handler) => void } }) => {
    server.middlewares.use('/api/watchers', handler)
  }
  return {
    name: 'karin-watcher-control',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

// Karin builds for the LOCAL target only: relative asset paths ('./') so the bundle
// serves from any origin — localhost:4173, a Cloudflare tunnel, or a bare file path.
// The public GitHub Pages deploy was removed; to bring it back you'd reintroduce an
// absolute base (BASE_PATH) + a deploy workflow.
// `--mode offline` (pnpm build:local) additionally bakes your data/ into dist/data/.
export default defineConfig(({ mode }) => {
  const isLocal = mode === 'offline'
  const env = loadEnv(mode, root, '')
  const deepSeekKey = env.VITE_DEEPSEEK_API_KEY || env.VITE_DEEPSEEK_FLASH_API_KEY || env.VITE_DEEPSEEK_PRO_API_KEY
  // Allow Cloudflare quick-tunnel hosts (random *.trycloudflare.com each run) through
  // Vite's DNS-rebinding guard, for both the dev server (:5173) and preview (:4173) —
  // this is what makes `./karin.ps1 -Tunnel` reachable. localhost stays allowed by default.
  const tunnelHosts = ['.trycloudflare.com']
  // Directories the dev server must NOT watch.
  //
  // Vite watches the project root recursively, which here means it also watches every git
  // worktree under .claude/ — including a Rust target/ dir. A build writing a .pdb there
  // made chokidar throw EBUSY, and an unhandled watcher error takes the whole dev server
  // down (`vite exited with code 1`), which reads as "Electron failed to start".
  //
  // data/ is excluded for a different reason: the indexers rewrite ~48 MB of feed there
  // every few seconds, so watching it is a constant stream of events for files no module
  // graph depends on — the middleware serves them straight off disk per request.
  const watchIgnored = ['**/.claude/**', '**/.git/**', '**/dist/**', '**/data/**', '**/node_modules/**']
  return {
    base: './',
    server: { allowedHosts: tunnelHosts, watch: { ignored: watchIgnored } },
    preview: { allowedHosts: tunnelHosts },
    plugins: [react(), tailwindcss(), serveLocalData(), deepSeekProxy(deepSeekKey), watcherControl(), ...(isLocal ? [bundleLocalData()] : [])],
  }
})
