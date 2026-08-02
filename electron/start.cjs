// Spawn the Electron window from Node.
//
// Two things this exists for:
//   1. `KARIN_DEV_URL=... electron .` would break on Windows cmd, so the env var is set here.
//   2. ELECTRON_RUN_AS_NODE, which any Electron-based parent (VS Code, Claude Code, a
//      terminal launched from one) leaves in the environment, makes the electron binary
//      run as plain Node — `require('electron')` then yields no `app` and the process dies
//      with "Cannot read properties of undefined". Inheriting it is silent and confusing,
//      so it is stripped for the child.
//
// Usage: node electron/start.cjs [--dev]

const { spawn } = require('node:child_process')
const electron = require('electron')
const { join } = require('node:path')

const dev = process.argv.includes('--dev')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
if (dev) env.KARIN_DEV_URL = process.env.KARIN_DEV_URL || 'http://localhost:5173/'
else delete env.KARIN_DEV_URL

if (typeof electron !== 'string') {
  console.error('electron did not resolve to a binary path — run `pnpm rebuild electron`.')
  process.exit(1)
}

const child = spawn(electron, [join(__dirname, '..')], { stdio: 'inherit', env })
child.on('close', (code) => process.exit(code ?? 0))
