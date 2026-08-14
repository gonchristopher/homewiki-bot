# Registers the "homewiki-bot" Scheduled Task on Windows: starts at logon and
# self-heals every 5 minutes if the bot dies. No admin rights needed -- it's a
# per-user task.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
#
# Remove it again with:  schtasks /delete /tn homewiki-bot /f
#
# The design notes (why wscript, why a separate repetition trigger) are in the
# README under "Running it permanently".

$ErrorActionPreference = 'Stop'

$taskName = 'homewiki-bot'
$repoRoot = Split-Path -Parent $PSScriptRoot
$vbs      = Join-Path $repoRoot 'run-bot.vbs'

if (-not (Test-Path $vbs)) { throw "run-bot.vbs not found at $vbs" }

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Write-Host "Task '$taskName' already exists -- replacing it."
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# wscript.exe is a GUI-subsystem host, so no console window ever appears.
# `powershell -WindowStyle Hidden` does NOT achieve that -- Task Scheduler
# starts it as a console app, leaving a black window on the desktop.
$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
                                  -Argument "`"$vbs`"" `
                                  -WorkingDirectory $repoRoot

# Trigger 1: at logon, delayed 30s so cloud-synced folders (OneDrive, iCloud)
# have a moment to mount before the bot reads the wiki.
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$atLogon.Delay = 'PT30S'

# Trigger 2: the self-heal. This MUST be its own trigger -- a repetition hung
# off the logon trigger only arms when that trigger fires, so nothing ever
# re-checks until the next logon.
$heal = New-ScheduledTaskTrigger -Once -At (Get-Date) `
          -RepetitionInterval (New-TimeSpan -Minutes 5)

# IgnoreNew is what makes the 5-minute repetition safe: while the bot is alive
# a firing is a no-op; if it died, the firing starts it.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
              -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action `
  -Trigger @($atLogon, $heal) -Settings $settings `
  -Description 'Telegram bridge to a local Claude Code session (homewiki-bot)' | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "Registered and started '$taskName'."
Write-Host "  schtasks /query /tn $taskName /fo list /v   # check it (Next Run Time must not be blank)"
Write-Host "  schtasks /end   /tn $taskName               # stop"
Write-Host "  schtasks /run   /tn $taskName               # start"
Write-Host "  Get-Content $repoRoot\bot.out.log -Wait     # follow the log"
