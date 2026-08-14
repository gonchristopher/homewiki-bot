' Launcher for the "homewiki-bot" scheduled task (see README).
'
' The task points at wscript.exe rather than powershell.exe because wscript is a
' GUI-subsystem host and never allocates a console, so nothing appears on screen.
' `powershell -WindowStyle Hidden` does NOT achieve that: Task Scheduler starts
' it as an interactive console app, so the console exists before PowerShell can
' hide anything, and the cmd.exe child inherits it. That left a black window on
' the desktop for the life of the bot -- which is not just untidy, it's a way to
' kill the bot by accident, as a stray Ctrl-C in bot.err.log showed.
'
' Run(cmd, 0, True): 0 hides the window, True waits for it. The wait is load
' bearing -- the task instance has to stay alive as long as the bot does, because
' the 5-minute repetition relies on MultipleInstances=IgnoreNew seeing the task
' still running. Without the wait, every firing would start another bot.

Dim sh, here
Set sh = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run """" & here & "run-bot.cmd""", 0, True
