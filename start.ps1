# Sequence — one-command launch for Windows PowerShell.
#
#   .\start.ps1                     start the app (pick a repo in the UI)
#   .\start.ps1 C:\path\to\repo     scan that repo on startup
#   .\start.ps1 --port 4173         pass CLI flags through
#   .\start.ps1 --no-open           start without opening a browser
#
# WHY THIS FILE EXISTS
# `./start.sh` does NOT work in PowerShell. PowerShell does not execute .sh
# files; Windows hands them to whatever app is associated with the extension —
# for many developers that is an editor, so `./start.sh` silently OPENS THE
# SCRIPT IN THE EDITOR instead of starting anything. The prompt returns at once
# and the only output is the editor's own logs. Use this file instead.
#
# Everything runs locally on 127.0.0.1 — nothing is uploaded.

$ErrorActionPreference = 'Stop'

$UserCwd = (Get-Location).Path
$Root    = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Show-Usage {
  @'
Sequence - one-command launch.

  .\start.ps1                   start the app (pick a repo in the UI)
  .\start.ps1 C:\path\to\repo   scan that repo on startup
  .\start.ps1 --port 4173       pass CLI flags through
  .\start.ps1 --no-open         start without opening a browser

This is help, not a crash. Run .\start.ps1 with no extra words to start the app.
'@ | Write-Host
}

$rest = @($args)
if ($rest.Count -gt 0 -and ($rest[0] -eq '-h' -or $rest[0] -eq '--help')) { Show-Usage; exit 0 }

# A leading argument that is not a flag is a repo path, resolved against the
# directory the user typed the command in - not against Sequence's own root.
$RepoFromPos = ''
if ($rest.Count -gt 0 -and -not $rest[0].StartsWith('-')) {
  $given = $rest[0]
  $rest  = @($rest | Select-Object -Skip 1)
  $candidate = if ([System.IO.Path]::IsPathRooted($given)) { $given } else { Join-Path $UserCwd $given }
  if (Test-Path -LiteralPath $candidate -PathType Container) {
    $RepoFromPos = (Resolve-Path -LiteralPath $candidate).Path
  } else {
    Write-Error "start.ps1: not a directory: $given"
    Show-Usage
    exit 1
  }
}

# 1. node must exist at all - the clearest possible failure if it does not.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is not on PATH. Install Node 20+ from https://nodejs.org and reopen PowerShell." -ForegroundColor Red
  exit 1
}

# 2. pnpm (via corepack, which ships with Node 16.13+)
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "> enabling pnpm via corepack..."
  corepack enable 2>$null
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "corepack could not enable pnpm. Install it: https://pnpm.io/installation" -ForegroundColor Red
    exit 1
  }
}

# 3. install deps if missing OR manifests newer than the last install marker.
#    Missing-only is the same trap step 4 documents for dist: after `git pull`
#    node_modules/ exists but a new dependency is undeclared in the tree, so
#    the build dies on an unresolvable import. pnpm writes
#    node_modules/.modules.yaml on every install — a package.json / lockfile
#    newer than that marker means the tree is behind what the repo declares.
#    (web2 — packages/web was deleted 2026-08-20)
$needsInstall = $false
$installReason = ''
if (-not (Test-Path 'node_modules') -or -not (Test-Path 'packages/web2/node_modules')) {
  $needsInstall = $true; $installReason = 'first run'
} elseif (-not (Test-Path 'node_modules/.modules.yaml')) {
  $needsInstall = $true; $installReason = 'no pnpm install marker — tree is in an unknown state'
} else {
  $markerAt = (Get-Item 'node_modules/.modules.yaml').LastWriteTimeUtc
  $manifests = @('package.json', 'pnpm-lock.yaml') + @(Get-ChildItem -Path 'packages/*/package.json' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  $newerManifest = $manifests |
    Where-Object { Test-Path $_ } |
    ForEach-Object { Get-Item $_ } |
    Where-Object { $_.LastWriteTimeUtc -gt $markerAt } |
    Select-Object -First 1
  if ($newerManifest) {
    $needsInstall = $true
    $installReason = "$($newerManifest.Name) changed since the last install"
  }
}
if ($needsInstall) {
  Write-Host "> installing dependencies - $installReason..."
  pnpm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# 4. build when the compiled output is missing OR older than the source.
#    Missing-only is a trap: after `git pull` the dist is still there, just
#    stale, so a launcher that skips the build serves the OLD app and the fix
#    you just pulled appears not to have shipped.
$needsBuild = $false
$reason = ''
$cliJs   = 'packages/analyzer/dist/cli.js'
$webHtml = 'packages/web2/dist/index.html'
if (-not (Test-Path $cliJs) -or -not (Test-Path $webHtml)) {
  $needsBuild = $true; $reason = 'first run'
} else {
  $builtAt = (Get-Item $webHtml).LastWriteTimeUtc
  # 'site' was dropped 2026-08-20 - the marketing site is retired.
  $newer = Get-ChildItem -Path 'packages/*/src' -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.ts','.tsx','.css','.html' -and $_.LastWriteTimeUtc -gt $builtAt } |
    Select-Object -First 1
  if ($newer) { $needsBuild = $true; $reason = "source changed since the last build ($($newer.FullName))" }
}
# 4b. leftover v1 dist is gitignored and load-bearing on old machines — say so.
if (Test-Path 'packages/web/dist') {
  Write-Host "> note: leftover packages/web/dist from v1 — ignored, the app is served from packages/web2/dist"
}
if ($needsBuild) {
  Write-Host "> building - $reason..."
  pnpm build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# 5. local env, same contract as start.sh
if (Test-Path '.env.local') {
  Write-Host "> loading local env from .env.local..."
  Get-Content '.env.local' | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
      $k, $v = $line.Split('=', 2)
      [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"').Trim("'"))
    }
  }
}

Write-Host "> starting Sequence..."
if ($RepoFromPos) {
  node $cliJs app --repo $RepoFromPos @rest
} elseif ($rest.Count -eq 0) {
  node $cliJs app
} else {
  node $cliJs app @rest
}
exit $LASTEXITCODE
