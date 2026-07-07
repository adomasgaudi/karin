# Karin — LOCAL launcher.
# Runs Karin in LOCAL mode: it re-indexes your real Codex sessions into
# data/ and starts the Vite dev server, which auto-loads that data. Your
# transcripts never leave this machine. (The public GitHub Pages build ships
# no data and asks visitors to drag-drop their own file.)
#
# Usage: ./karin.ps1 [-NoOpen] [-NoInstall] [-Limit N]
#   -NoOpen     do not open the browser
#   -NoInstall  skip `pnpm install` even if node_modules is missing
#   -Limit N    index only the newest N sessions

param(
    [switch]$NoOpen,
    [switch]$NoInstall,
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

# Step 3 — start Vite. `pnpm dev` is long-running and holds the console.
$url = "http://localhost:5173/"
Write-Output "Karin starting in LOCAL mode — data/ regenerated. Opening $url"
if (-not $NoOpen) {
    Start-Process $url | Out-Null
}

Push-Location $KarinHome
try {
    pnpm dev
} finally {
    Pop-Location
}
