import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, createReadStream } from 'node:fs'

const root = dirname(fileURLToPath(import.meta.url))

// Dev only: serve the locally-generated data/ files (e.g. karin-data.json) so the
// app auto-loads real Codex data during `pnpm dev`. This is NOT part of the build,
// so the public Pages bundle never ships any transcript data.
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

// GitHub Pages serves the site from /<repo>/ — BASE_PATH is set in the deploy workflow.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), serveLocalData()],
})
