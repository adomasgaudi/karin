import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, createReadStream, mkdirSync, copyFileSync } from 'node:fs'

const root = dirname(fileURLToPath(import.meta.url))
// Every feed the app fetches. A file missing here never reaches dist/data/, so the
// local deploy at :4173 would silently serve a bundle without that source.
const DATA_FILES = [
  'karin-data.json',
  'karin-data.js',
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
      if (!copied) {
        // eslint-disable-next-line no-console
        console.warn('[karin] local build: no data/ files found — run `python bin/karin.py` first.')
      }
    },
  }
}

// Karin builds for the LOCAL target only: relative asset paths ('./') so the bundle
// serves from any origin — localhost:4173, a Cloudflare tunnel, or a bare file path.
// The public GitHub Pages deploy was removed; to bring it back you'd reintroduce an
// absolute base (BASE_PATH) + a deploy workflow.
// `--mode offline` (pnpm build:local) additionally bakes your data/ into dist/data/.
export default defineConfig(({ mode }) => {
  const isLocal = mode === 'offline'
  // Allow Cloudflare quick-tunnel hosts (random *.trycloudflare.com each run) through
  // Vite's DNS-rebinding guard, for both the dev server (:5173) and preview (:4173) —
  // this is what makes `./karin.ps1 -Tunnel` reachable. localhost stays allowed by default.
  const tunnelHosts = ['.trycloudflare.com']
  return {
    base: './',
    server: { allowedHosts: tunnelHosts },
    preview: { allowedHosts: tunnelHosts },
    plugins: [react(), tailwindcss(), serveLocalData(), ...(isLocal ? [bundleLocalData()] : [])],
  }
})
