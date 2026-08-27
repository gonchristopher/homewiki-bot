@echo off
REM Launcher used by the "homewiki-bot" scheduled task (see README).
REM cmd does the log redirection rather than PowerShell because PowerShell 5.1
REM writes redirected output as UTF-16, which makes the logs painful to read.
cd /d "%~dp0"

REM Logs live in logs\, not next to the code, and each run gets a fresh pair.
REM The previous pair is archived under the time it was rotated
REM (logs\bot.out-2026-08-27-113708.log). Without this the two files grow
REM without bound and every restart is buried mid-file, which made "is the new
REM code actually running?" needlessly hard to answer.
REM
REM These are not ordinary logs: every question and answer passes through them,
REM so the archive is a running transcript of the household's medical and
REM financial conversations. Keep the folder out of anything you share.
if not defined LOG_DIR set "LOG_DIR=logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Older versions wrote to the repo root. Move those in rather than orphaning
REM them, so the history stays in one place and stops cluttering the checkout.
if exist "bot.out.log" move /y "bot.out.log" "%LOG_DIR%\bot.out.log" >nul
if exist "bot.err.log" move /y "bot.err.log" "%LOG_DIR%\bot.err.log" >nul

REM Archives are pruned to the newest LOG_ARCHIVES_KEEP of each stream (must be
REM 1 or more). Note the interaction with the task's restart-on-failure: a bot
REM that is crash-looping rotates that fast too, so the archive explaining the
REM FIRST crash can age out quickly. Raise this if you're chasing a loop.
if not defined LOG_ARCHIVES_KEEP set "LOG_ARCHIVES_KEEP=15"

REM %date% and %time% are locale-dependent -- they render as 27/08/2026 or
REM 8/27/2026 depending on the machine, and both contain characters that are
REM illegal in a filename. PowerShell gives one sortable spelling everywhere.
set "STAMP="
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd-HHmmss"') do set "STAMP=%%i"
REM If PowerShell isn't reachable, archive under a fixed name rather than
REM building "bot.out-.log": one stale archive beats losing the rotation.
if not defined STAMP set "STAMP=previous"

call :rotate bot.out
call :rotate bot.err

REM node from PATH normally. Task Scheduler sometimes starts the task without
REM the full user PATH, so fall back to NODE_BIN if you set it in the
REM environment, then to the common install locations. nvm4w's shim path is a
REM symlink to the active version, so it survives `nvm use`.
where node >nul 2>nul
if %errorlevel%==0 (
  node bot.js >> "%LOG_DIR%\bot.out.log" 2>> "%LOG_DIR%\bot.err.log"
  exit /b %errorlevel%
)

if defined NODE_BIN (
  "%NODE_BIN%" bot.js >> "%LOG_DIR%\bot.out.log" 2>> "%LOG_DIR%\bot.err.log"
  exit /b %errorlevel%
)

if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" bot.js >> "%LOG_DIR%\bot.out.log" 2>> "%LOG_DIR%\bot.err.log"
  exit /b %errorlevel%
)

if exist "C:\nvm4w\nodejs\node.exe" (
  "C:\nvm4w\nodejs\node.exe" bot.js >> "%LOG_DIR%\bot.out.log" 2>> "%LOG_DIR%\bot.err.log"
  exit /b %errorlevel%
)

echo node.exe not found -- set NODE_BIN or add node to PATH >> "%LOG_DIR%\bot.err.log"
exit /b 1

REM Archive one stream if the last run actually wrote to it. An empty file is
REM left alone -- during a restart loop empty archives would be the bulk of the
REM folder and would push the useful ones out.
:rotate
if not exist "%LOG_DIR%\%~1.log" goto :eof
for %%A in ("%LOG_DIR%\%~1.log") do if %%~zA equ 0 goto :eof
move /y "%LOG_DIR%\%~1.log" "%LOG_DIR%\%~1-%STAMP%.log" >nul
for /f "skip=%LOG_ARCHIVES_KEEP% delims=" %%f in ('dir /b /o-d "%LOG_DIR%\%~1-*.log" 2^>nul') do del "%LOG_DIR%\%%f"
goto :eof
