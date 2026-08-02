// Karin Live — Electron shell.
//
// The whole point of this branch: the renderer IS the reader. `nodeIntegration` is on and
// `contextIsolation` is off, so src/live/*.ts calls fs.watch and fs.read directly on
// ~/.claude and ~/.codex — no HTTP, no IPC hop, no data/*.json, no watcher processes.
// That combination is only safe because this window never loads remote content: in dev it
// loads the local Vite server, in a build it loads dist/index.html off disk. Keep it that way.

const { app, BrowserWindow, shell } = require('electron')
const { join } = require('node:path')

// Vite's dev server URL, passed by `pnpm app:dev`. Absent in a packaged/built run.
const DEV_URL = process.env.KARIN_DEV_URL

function createWindow() {
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111111',
    // Don't paint a white frame before React mounts.
    show: false,
    title: 'Karin',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // The renderer reads files outside the app directory (the user's home), which
      // web security would otherwise block for a file:// origin.
      webSecurity: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Any http(s) link in a transcript opens in the real browser, never in this window —
  // loading remote content into a node-integrated renderer is the one thing to avoid.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_URL) {
    void win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(join(__dirname, '..', 'dist', 'index.html'))
  }

  return win
}

app.whenReady().then(() => {
  createWindow()
  // macOS keeps the app alive with no windows; reopening should make one.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
