@echo off
setlocal

rem Fallback launcher: builds the release binary if it is missing, then runs it.
rem The Desktop shortcut points straight at the .exe instead, so no console
rem window ever appears. Only the release profile sets windows_subsystem, so a
rem debug build always flashes a terminal — never point the shortcut at one.

set "ROOT=%~dp0"
set "EXE=%ROOT%karin-rs\target\release\karin-rs.exe"
set "CARGO=%USERPROFILE%\.cargo\bin\cargo.exe"

if not exist "%EXE%" (
    if not exist "%CARGO%" (
        echo karin-rs is not built, and Cargo was not found at:
        echo %CARGO%
        pause
        exit /b 1
    )
    echo Building karin-rs...
    "%CARGO%" build --release --manifest-path "%ROOT%karin-rs\Cargo.toml"
    if errorlevel 1 (
        echo Build failed.
        pause
        exit /b 1
    )
)

start "karin-rs" "%EXE%"
exit /b 0
