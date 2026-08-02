@echo off
setlocal

set "ROOT=%~dp0"
set "EXE=%ROOT%karin-rs\target\debug\karin-rs.exe"
set "CARGO=%USERPROFILE%\.cargo\bin\cargo.exe"

if not exist "%EXE%" (
    if not exist "%CARGO%" (
        echo karin-rs is not built, and Cargo was not found at:
        echo %CARGO%
        pause
        exit /b 1
    )
    echo Building karin-rs...
    "%CARGO%" build --manifest-path "%ROOT%karin-rs\Cargo.toml"
    if errorlevel 1 (
        echo Build failed.
        pause
        exit /b 1
    )
)

start "karin-rs" "%EXE%"
exit /b 0
