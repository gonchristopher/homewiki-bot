@echo off
REM Launcher used by the "homewiki-bot" scheduled task (see README).
REM cmd does the log redirection rather than PowerShell because PowerShell 5.1
REM writes redirected output as UTF-16, which makes the logs painful to read.
cd /d "%~dp0"

REM node from PATH normally. Task Scheduler sometimes starts the task without
REM the full user PATH, so fall back to NODE_BIN if you set it in the
REM environment, then to the common install locations. nvm4w's shim path is a
REM symlink to the active version, so it survives `nvm use`.
where node >nul 2>nul
if %errorlevel%==0 (
  node bot.js >> bot.out.log 2>> bot.err.log
  exit /b %errorlevel%
)

if defined NODE_BIN (
  "%NODE_BIN%" bot.js >> bot.out.log 2>> bot.err.log
  exit /b %errorlevel%
)

if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" bot.js >> bot.out.log 2>> bot.err.log
  exit /b %errorlevel%
)

if exist "C:\nvm4w\nodejs\node.exe" (
  "C:\nvm4w\nodejs\node.exe" bot.js >> bot.out.log 2>> bot.err.log
  exit /b %errorlevel%
)

echo node.exe not found -- set NODE_BIN or add node to PATH >> bot.err.log
exit /b 1
