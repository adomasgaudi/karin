# Karin - LOCAL DEPLOY launcher (new React stack).
#
# By default this runs the LOCAL DEPLOY: a real, self-contained OFFLINE build of
# the React app with YOUR real Codex data baked in. It re-indexes your sessions
# into data/, runs `pnpm build:local` (relative asset paths + your data copied
# into dist/data/), then serves that built bundle with `pnpm preview`. The app
# runs entirely from local files - your transcripts never leave this machine.
#
# Use -Dev to skip the build and run the fast Vite dev server instead
# (hot reload; dev middleware auto-serves data/).
#
# Use -Tunnel to also expose THIS running instance on a public Cloudflare URL
# (https://<random>.trycloudflare.com) so you can reach your live local Karin from
# another device (e.g. your phone). The data is still served from this PC and never
# leaves it or goes into git - the tunnel just relays requests down to this machine.
# Requires tools/cloudflared.exe (bundled) or cloudflared on PATH. The PC must stay
# on and this window open. Anyone with the URL can view it, so share it carefully.
#
# Usage: ./karin.ps1 [-NoOpen] [-NoInstall] [-Dev] [-Tunnel] [-Limit N]
#   -NoOpen     do not open the browser
#   -NoInstall  skip `pnpm install` even if node_modules is missing
#   -Dev        run the fast dev server (pnpm dev) instead of the local deploy
#   -Tunnel     expose this instance publicly via a Cloudflare quick tunnel
#   -Limit N    index only the newest N sessions

param(
    [switch]$NoOpen,
    [switch]$NoInstall,
    [switch]$Dev,
    [switch]$Tunnel,
    [int]$Limit = 0
)

$ErrorActionPreference = "Stop"

$KarinHome = $PSScriptRoot
if (-not $KarinHome) {
    $KarinHome = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# Step 1 - regenerate data/ from your local Codex, Claude Code AND Warp sessions.
# Codex feeds karin-data.json; Claude feeds claude-raw.json; Warp reads its local
# SQLite (agent conversations run against your DeepSeek endpoint and Warp's built-in
# models) into warp-raw.json. All land in data/ (and dist/data/).
$Indexer = Join-Path $KarinHome "bin\karin.py"
$ClaudeIndexer = Join-Path $KarinHome "bin\karin_claude.py"
$WarpIndexer = Join-Path $KarinHome "bin\karin_warp.py"
$indexArgs = @($Indexer)
$claudeIndexArgs = @($ClaudeIndexer)
$warpIndexArgs = @($WarpIndexer)
if ($Limit -gt 0) {
    $indexArgs += @("--limit", "$Limit")
    $claudeIndexArgs += @("--limit", "$Limit")
    $warpIndexArgs += @("--limit", "$Limit")
}
python @indexArgs
python @claudeIndexArgs
python @warpIndexArgs

# Kill-on-close job object.
#
# The watchers and cloudflared are detached `Start-Process` children, but the server
# (`pnpm dev` / `pnpm preview`) holds this console in the FOREGROUND. Close the window
# instead of Ctrl+C and the server dies while the `finally` cleanup below never runs —
# the background children orphan and keep rewriting data/ behind a dead server. The feeds
# stay perfectly fresh, so it looks like tracking works while nothing is served.
#
# A Win32 job with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE ties them to THIS process: when the
# launcher dies by any means, the last job handle closes and the OS terminates every child.
Add-Type -Namespace Karin -Name Job -MemberDefinition @'
[DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfo);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
'@

$script:KarinJob = [IntPtr]::Zero
function Initialize-KarinJob {
    if ($script:KarinJob -ne [IntPtr]::Zero) { return }
    try {
        $job = [Karin.Job]::CreateJobObject([IntPtr]::Zero, $null)
        if ($job -eq [IntPtr]::Zero) { return }

        # JOBOBJECT_EXTENDED_LIMIT_INFORMATION. LimitFlags sits at offset 16 (two
        # LARGE_INTEGERs) on both 32- and 64-bit; only the total size differs.
        $size = if ([IntPtr]::Size -eq 8) { 144 } else { 112 }
        $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
        try {
            [Runtime.InteropServices.Marshal]::Copy((New-Object byte[] $size), 0, $ptr, $size)
            [Runtime.InteropServices.Marshal]::WriteInt32($ptr, 16, 0x2000)  # KILL_ON_JOB_CLOSE
            if ([Karin.Job]::SetInformationJobObject($job, 9, $ptr, $size)) {
                $script:KarinJob = $job
            }
        } finally {
            [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
        }
    } catch {
        Write-Warning "Could not create the kill-on-close job ($($_.Exception.Message)); background helpers may outlive this window."
    }
}

function Add-KarinJobChild($Proc) {
    if ($null -eq $Proc -or $script:KarinJob -eq [IntPtr]::Zero) { return }
    try {
        [void][Karin.Job]::AssignProcessToJobObject($script:KarinJob, $Proc.Handle)
    } catch {
        Write-Warning "Could not bind PID $($Proc.Id) to the kill-on-close job."
    }
}

function Start-KarinWatcher {
    $logDir = Join-Path $KarinHome "data"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Initialize-KarinJob

    # Start-Process joins an -ArgumentList ARRAY with spaces and does NOT quote the
    # elements, so a script path containing a space (this repo lives under "Meta apps")
    # gets split — python then tries to run "...\Meta" and the watcher dies instantly.
    # Pass ONE pre-quoted string per process so the space-bearing path survives.
    $limitArg = if ($Limit -gt 0) { " --limit $Limit" } else { "" }
    $watchArgs = "`"$Indexer`" --watch$limitArg"
    $claudeWatchArgs = "`"$ClaudeIndexer`" --watch$limitArg"
    $warpWatchArgs = "`"$WarpIndexer`" --watch$limitArg"
    $codex = Start-Process -FilePath "python" -ArgumentList $watchArgs -WorkingDirectory $KarinHome -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "karin-watch.log") -RedirectStandardError (Join-Path $logDir "karin-watch.err.log") -PassThru
    $claude = Start-Process -FilePath "python" -ArgumentList $claudeWatchArgs -WorkingDirectory $KarinHome -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "claude-watch.log") -RedirectStandardError (Join-Path $logDir "claude-watch.err.log") -PassThru
    # Warp watcher polls warp.sqlite's mtime; a rewrite of data/warp-raw.json is what makes
    # a running DeepSeek agent show up live in the browser (the app re-fetches every 5s).
    $warp = Start-Process -FilePath "python" -ArgumentList $warpWatchArgs -WorkingDirectory $KarinHome -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "warp-watch.log") -RedirectStandardError (Join-Path $logDir "warp-watch.err.log") -PassThru
    foreach ($p in @($codex, $claude, $warp)) { Add-KarinJobChild $p }
    return @($codex, $claude, $warp)
}

function Stop-KarinWatcher($Processes) {
    foreach ($p in @($Processes)) {
        if ($null -ne $p -and -not $p.HasExited) {
            Stop-Process -Id $p.Id -Force
        }
    }
}

# Cloudflare quick tunnel - relays a public https://<random>.trycloudflare.com URL
# down to the local server on $Port. No Cloudflare account or domain needed. The data
# is still served by THIS PC; the tunnel only forwards requests, so nothing is copied
# off-machine or into git. Returns the cloudflared process (or $null if unavailable).
function Start-KarinTunnel($Port) {
    $cf = Join-Path $KarinHome "tools\cloudflared.exe"
    if (-not (Test-Path -LiteralPath $cf)) {
        $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
        if ($cmd) {
            $cf = $cmd.Source
        } else {
            Write-Warning "cloudflared not found (tools\cloudflared.exe or on PATH) - skipping tunnel."
            Write-Warning "Get it: https://github.com/cloudflare/cloudflared/releases/latest (cloudflared-windows-amd64.exe -> tools\cloudflared.exe)"
            return $null
        }
    }

    $logDir = Join-Path $KarinHome "data"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $outLog = Join-Path $logDir "cloudflared.log"
    $errLog = Join-Path $logDir "cloudflared.err.log"
    foreach ($f in @($outLog, $errLog)) { if (Test-Path $f) { Remove-Item $f -Force } }

    $tunArgs = @("tunnel", "--no-autoupdate", "--url", "http://localhost:$Port")
    Initialize-KarinJob
    $proc = Start-Process -FilePath $cf -ArgumentList $tunArgs -WorkingDirectory $KarinHome -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    Add-KarinJobChild $proc

    # cloudflared prints the public URL within a few seconds - poll both logs for it.
    $publicUrl = $null
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        foreach ($f in @($outLog, $errLog)) {
            if (Test-Path $f) {
                $hit = Select-String -Path $f -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($hit) { $publicUrl = $hit.Matches[0].Value; break }
            }
        }
        if ($publicUrl) { break }
        if ($proc.HasExited) { break }
    }

    if ($publicUrl) {
        Write-Output ""
        Write-Output "======================================================================"
        Write-Output "  Karin public tunnel:  $publicUrl"
        Write-Output "  Live, served from THIS PC. Data stays on your machine and out of git."
        Write-Output "  Anyone with the URL can view it - share carefully. Ctrl+C stops it."
        Write-Output "======================================================================"
        Write-Output ""
    } else {
        Write-Warning "Tunnel process started but no public URL detected yet - check data\cloudflared.err.log"
    }
    return $proc
}

function Stop-KarinTunnel($Proc) {
    if ($null -ne $Proc -and -not $Proc.HasExited) {
        Stop-Process -Id $Proc.Id -Force
    }
}

# Step 2 - install dependencies on first run.
$NodeModules = Join-Path $KarinHome "node_modules"
if (-not $NoInstall -and -not (Test-Path -LiteralPath $NodeModules)) {
    Push-Location $KarinHome
    try {
        pnpm install
    } finally {
        Pop-Location
    }
}

# Step 3 - serve. `pnpm dev` / `pnpm preview` are long-running and hold the
# console, so open the browser FIRST, then hand the console to the server.
if ($Dev) {
    # Fast dev server. Vite prints its own URL (~http://localhost:5173/).
    $url = "http://localhost:5173/"
    Write-Output "Karin starting in DEV mode (fast Vite server, hot reload) - data/ regenerated. Opening $url"
    if (-not $NoOpen) {
        Start-Process $url | Out-Null
    }
    $Watcher = Start-KarinWatcher
    $TunnelProc = $null
    if ($Tunnel) { $TunnelProc = Start-KarinTunnel 5173 }
    Push-Location $KarinHome
    try {
        pnpm dev
    } finally {
        Stop-KarinTunnel $TunnelProc
        Stop-KarinWatcher $Watcher
        Pop-Location
    }
} else {
    # LOCAL DEPLOY: build the offline bundle (your data baked in), then serve it.
    Write-Output "Karin building LOCAL DEPLOY (offline bundle, your data baked in) - data/ regenerated. Please wait for the build..."
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
    $TunnelProc = $null
    if ($Tunnel) { $TunnelProc = Start-KarinTunnel 4173 }
    Push-Location $KarinHome
    try {
        pnpm preview --port 4173
    } finally {
        Stop-KarinTunnel $TunnelProc
        Stop-KarinWatcher $Watcher
        Pop-Location
    }
}
