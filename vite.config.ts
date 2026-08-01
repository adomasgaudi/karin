import { defineConfig } from 'vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, createReadStream, mkdirSync, copyFileSync, cpSync } from 'node:fs'
import { Readable } from 'node:stream'

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
  return {
    name: 'karin-serve-local-data',
    apply: 'serve' as const,
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url && url.startsWith('/data/')) {
          const file = join(root, decodeURIComponent(url))
          if (existsSync(file)) {
            res.setHeader('content-type', url.endsWith('.json') ? 'application/json' : 'text/plain')
            res.setHeader('cache-control', 'no-store')
            createReadStream(file).pipe(res)
            return
          }
        }
        next()
      })
    },
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
  return {
    base: './',
    server: { allowedHosts: tunnelHosts },
    preview: { allowedHosts: tunnelHosts },
    plugins: [react(), tailwindcss(), serveLocalData(), deepSeekProxy(deepSeekKey), ...(isLocal ? [bundleLocalData()] : [])],
  }
})
