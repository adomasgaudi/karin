# Build karin-rs without ever disturbing a running instance.
#
# Windows refuses to delete or overwrite a running .exe, which is what a plain
# `cargo build --release` tries to do — so the build failed whenever the owner
# had Karin open, which is most of the time. It will, however, happily RENAME a
# running .exe: the process holds the file by handle, not by path.
#
# So: move the old binary aside, let cargo write a fresh one, and sweep up the
# leftovers on a later run once nothing is holding them. The running window is
# untouched and keeps working; the next launch picks up the new build.

param([switch]$Debug)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$profileName = if ($Debug) { 'debug' } else { 'release' }
$outDir = Join-Path $root "karin-rs\target\$profileName"
$exe = Join-Path $outDir 'karin-rs.exe'

# Sweep up binaries parked by earlier runs, now that they may be free.
Get-ChildItem $outDir -Filter 'karin-rs.inuse*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
    try { Remove-Item $_.FullName -Force } catch { }
}

if (Test-Path $exe) {
    try {
        Remove-Item $exe -Force
    } catch {
        # Held by a running Karin. A unique name, so several parked copies can
        # coexist if the owner keeps more than one window open.
        $parked = "karin-rs.inuse-$(Get-Date -Format 'HHmmss').exe"
        Rename-Item $exe $parked
        Write-Host "karin-rs is running; parked the old binary as $parked"
    }
}

$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
$args = @('build', '--manifest-path', (Join-Path $root 'karin-rs\Cargo.toml'))
if (-not $Debug) { $args += '--release' }

& $cargo @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "built $exe"
Write-Host "A running Karin keeps the old build until it is closed and reopened."
