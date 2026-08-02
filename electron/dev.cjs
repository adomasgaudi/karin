// Launch Electron against the running Vite dev server.
//
// A plain `KARIN_DEV_URL=... electron .` in the npm script would break on Windows cmd,
// so the env var is set here instead and Electron is spawned from Node.

const { spawn } = require('node:child_process')
const electron = require('electron')
const { join } = require('node:path')

const url = process.env.KARIN_DEV_URL || 'http://localhost:5173/'

const child = spawn(electron, [join(__dirname, '..')], {
  stdio: 'inherit',
  env: { ...process.env, KARIN_DEV_URL: url },
})

child.on('close', (code) => process.exit(code ?? 0))
