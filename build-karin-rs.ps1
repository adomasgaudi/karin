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

# Cargo links the binary twice: it builds `deps\karin_rs.exe` and hard-links it
# to `karin-rs.exe`. Both names are the SAME file, so parking only one leaves the
# running process holding the other and the linker still fails. Park both.
$targets = @($exe, (Join-Path $outDir 'deps\karin_rs.exe'))
$stamp = Get-Date -Format 'HHmmss'

foreach ($dir in @($outDir, (Join-Path $outDir 'deps'))) {
    # Sweep up binaries parked by earlier runs, now that they may be free.
    Get-ChildItem $dir -Filter '*.inuse-*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
        try { Remove-Item $_.FullName -Force } catch { }
    }
}

foreach ($target in $targets) {
    if (-not (Test-Path $target)) { continue }
    try {
        Remove-Item $target -Force
    } catch {
        # Held by a running Karin. A unique name, so several parked copies can
        # coexist if the owner keeps more than one window open.
        $parked = "$([IO.Path]::GetFileNameWithoutExtension($target)).inuse-$stamp.exe"
        Rename-Item $target $parked
        Write-Host "karin-rs is running; parked $([IO.Path]::GetFileName($target)) as $parked"
    }
}

$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
$args = @('build', '--manifest-path', (Join-Path $root 'karin-rs\Cargo.toml'))
if (-not $Debug) { $args += '--release' }

& $cargo @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "built $exe"
Write-Host "A running Karin keeps the old build until it is closed and reopened."
