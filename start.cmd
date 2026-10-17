@echo off
REM Sequence - one-command launch for Windows (cmd.exe, or double-click).
REM
REM   start.cmd                    start the app (pick a repo in the UI)
REM   start.cmd C:\path\to\repo    scan that repo on startup
REM   start.cmd --port 4173        pass CLI flags through
REM
REM `./start.sh` does NOT work on Windows: PowerShell and cmd do not execute
REM .sh files, so Windows opens the script in whatever app owns the .sh
REM extension - often an editor. This wrapper hands off to start.ps1.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
exit /b %ERRORLEVEL%
