# Karin - desktop-icon launcher for the Electron app.
#
# This is what the Desktop shortcut runs. Unlike karin.ps1 (which indexes data/, builds an
# offline bundle and serves it on :4173 with three watcher processes), the Electron shell
# reads ~/.claude and ~/.codex directly from the renderer - no server, no watchers, no
# data/*.json. So all this needs to do is make sure dist/ is current, then open the window.
#
# The build is skipped when dist/ is already newer than everything in src/ + index.html +
# vite.config.ts, so a normal double-click opens in ~2s instead of ~20s.
#
# Usage: ./karin-app.ps1 [-Force]
#   -Force   rebuild dist/ even if it looks up to date

param([switch]$Force)

$ErrorActionPreference = "Stop"

$KarinHome = $PSScriptRoot
if (-not $KarinHome) { $KarinHome = Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $KarinHome

# Newest write anywhere in the sources vs. the built entry point.
function Test-BuildStale {
    $entry = Join-Path $KarinHome "dist\index.html"
    if (-not (Test-Path -LiteralPath $entry)) { return $true }
    $built = (Get-Item -LiteralPath $entry).LastWriteTimeUtc

    $sources = @(Join-Path $KarinHome "src"), (Join-Path $KarinHome "index.html"), (Join-Path $KarinHome "vite.config.ts")
    foreach ($s in $sources) {
        if (-not (Test-Path -LiteralPath $s)) { continue }
        $newest = Get-ChildItem -LiteralPath $s -Recurse -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
        if ($null -eq $newest) { $newest = Get-Item -LiteralPath $s }
        if ($newest.LastWriteTimeUtc -gt $built) { return $true }
    }
    return $false
}

if (-not (Test-Path -LiteralPath (Join-Path $KarinHome "node_modules"))) {
    Write-Output "Installing dependencies (first run)..."
    pnpm install
}

if ($Force -or (Test-BuildStale)) {
    Write-Output "Building Karin (sources changed since the last build)..."
    pnpm build
} else {
    Write-Output "Build is current - opening Karin..."
}

# start.cjs strips ELECTRON_RUN_AS_NODE, which any Electron-based parent leaves behind and
# which would silently make the electron binary run as plain Node.
node electron/start.cjs
