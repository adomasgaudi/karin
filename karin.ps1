# Karin — LOCAL DEPLOY launcher (new React stack).
#
# By default this runs the LOCAL DEPLOY: a real, self-contained OFFLINE build of
# the React app with YOUR real Codex data baked in. It re-indexes your sessions
# into data/, runs `pnpm build:local` (relative asset paths + your data copied
# into dist/data/), then serves that built bundle with `pnpm preview`. The app
# runs entirely from local files — your transcripts never leave this machine.
# (The public GitHub Pages build ships no data and asks visitors to drag-drop
# their own file.)
#
# Use -Dev to skip the build and run the fast Vite dev server instead
# (hot reload; dev middleware auto-serves data/).
#
# Usage: ./karin.ps1 [-NoOpen] [-NoInstall] [-Dev] [-Limit N]
#   -NoOpen     do not open the browser
#   -NoInstall  skip `pnpm install` even if node_modules is missing
#   -Dev        run the fast dev server (pnpm dev) instead of the local deploy
#   -Limit N    index only the newest N sessions

param(
    [switch]$NoOpen,
    [switch]$NoInstall,
    [switch]$Dev,
    [int]$Limit = 0
)

$ErrorActionPreference = "Stop"

$KarinHome = $PSScriptRoot
if (-not $KarinHome) {
    $KarinHome = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# Step 1 — regenerate data/ from your local Codex sessions.
$Indexer = Join-Path $KarinHome "bin\karin.py"
$indexArgs = @($Indexer)
if ($Limit -gt 0) {
    $indexArgs += @("--limit", "$Limit")
}
python @indexArgs

function Start-KarinWatcher {
    $watchArgs = @($Indexer, "--watch")
    if ($Limit -gt 0) {
        $watchArgs += @("--limit", "$Limit")
    }
    $logDir = Join-Path $KarinHome "data"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $stdout = Join-Path $logDir "karin-watch.log"
    $stderr = Join-Path $logDir "karin-watch.err.log"
    return Start-Process -FilePath "python" -ArgumentList $watchArgs -WorkingDirectory $KarinHome -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
}

function Stop-KarinWatcher($Process) {
    if ($null -ne $Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force
    }
}

# Step 2 — install dependencies on first run.
$NodeModules = Join-Path $KarinHome "node_modules"
if (-not $NoInstall -and -not (Test-Path -LiteralPath $NodeModules)) {
    Push-Location $KarinHome
    try {
        pnpm install
    } finally {
        Pop-Location
    }
}

# Step 3 — serve. `pnpm dev` / `pnpm preview` are long-running and hold the
# console, so open the browser FIRST, then hand the console to the server.
if ($Dev) {
    # Fast dev server. Vite prints its own URL (~http://localhost:5173/).
    $url = "http://localhost:5173/"
    Write-Output "Karin starting in DEV mode (fast Vite server, hot reload) — data/ regenerated. Opening $url"
    if (-not $NoOpen) {
        Start-Process $url | Out-Null
    }
    $Watcher = Start-KarinWatcher
    Push-Location $KarinHome
    try {
        pnpm dev
    } finally {
        Stop-KarinWatcher $Watcher
        Pop-Location
    }
} else {
    # LOCAL DEPLOY: build the offline bundle (your data baked in), then serve it.
    Write-Output "Karin building LOCAL DEPLOY (offline bundle, your data baked in) — data/ regenerated. Please wait for the build..."
    Push-Location $KarinHome
    try {
        pnpm build:local
    } finally {
        Pop-Location
    }

    $url = "http://localhost:4173/"
    Write-Output "Karin serving LOCAL DEPLOY from $url"
    if (-not $NoOpen) {
        Start-Process $url | Out-Null
    }
    $Watcher = Start-KarinWatcher
    Push-Location $KarinHome
    try {
        pnpm preview --port 4173
    } finally {
        Stop-KarinWatcher $Watcher
        Pop-Location
    }
}
