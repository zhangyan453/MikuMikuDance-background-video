@echo off
title MMDBG - MMD Background Video Tool
echo ============================================
echo   MMDBG - MMD Background Video Tool
echo ============================================
echo.

cd /d "%~dp0"

REM --- isolate from the customer's Node environment ---
REM The bundled runtime never touches the system Node.js;
REM clear inherited env vars that could alter Node behavior.
set "NODE_OPTIONS="
set "NODE_PATH="
set "NODE_ENV="

REM --- find Node.js: bundled runtime first, then system PATH ---
set "NODE_EXE="
if exist "%~dp0runtime\node\node.exe" set "NODE_EXE=%~dp0runtime\node\node.exe"
if not defined NODE_EXE (
    where node >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Node.js not found!
        echo The bundled runtime is missing or incomplete.
        echo Please re-download the full package.
        pause
        exit /b 1
    )
    set "NODE_EXE=node"
)

echo Using Node.js: %NODE_EXE%
echo Starting MMDBG service...
echo Close this window to stop the tool.
echo.

REM --- remove stale port file, start server ---
if exist "%~dp0port.txt" del "%~dp0port.txt"
start "" /b cmd /c ""%NODE_EXE%" server.mjs"

REM --- wait until the port file appears (max 20s) ---
set /a waited=0
:waitloop
if exist "%~dp0port.txt" goto gotport
timeout /t 1 /nobreak >nul
set /a waited+=1
if %waited% geq 20 goto timeout
goto waitloop

:gotport
set /p MMDBG_PORT=<"%~dp0port.txt"
echo [OK] Service ready at http://127.0.0.1:%MMDBG_PORT%
echo Opening browser...
start "" http://127.0.0.1:%MMDBG_PORT%
echo.
echo The tool keeps running while this window is open.
echo Close this window to stop the tool.
pause
exit /b 0

:timeout
echo [WARN] Service did not respond in time.
echo        Check the MMDBG-Server window for errors.
pause
exit /b 1