# Fresh-install test for jev-codes — isolated from your real setup.
#
# What it proves, end to end on a "new machine":
#   1. npx downloads @kushwho/jev-codes cold (empty npm cache, no global install)
#   2. bare `npx` onboards inline (key from env, no prompt needed)
#   3. `audit --json` works against the real Jev API
#   4. the Claude Code plugin installs from the GitHub marketplace
#
# Isolation: a temp HOME (USERPROFILE), temp npm cache, and temp
# CLAUDE_CONFIG_DIR, so your real ~/.jev-codes, ~/.npm and ~/.claude are
# untouched. Nothing here needs cleanup afterwards — delete $sandbox when done.
#
# Prerequisites (run these first):
#   git push   # marketplace add reads from GitHub, so push the fix first
#
# Usage (PowerShell, from any directory):
#   $env:TYPESAFE_API_KEY = "<your key>"
#   .\scripts\test-fresh-install.ps1
#   # optional pinned version: .\scripts\test-fresh-install.ps1 -Version 0.1.2

param([string]$Version = "latest")

$ErrorActionPreference = "Stop"
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("jev-fresh-" + (Get-Random))
$fakeHome = Join-Path $sandbox "home"
$npmCache = Join-Path $sandbox "npm-cache"
$claudeCfg = Join-Path $sandbox "claude-config"
New-Item -ItemType Directory -Path $fakeHome, $npmCache, $claudeCfg | Out-Null

if (-not $env:TYPESAFE_API_KEY) {
  throw "Set TYPESAFE_API_KEY first: `$env:TYPESAFE_API_KEY = '<key>'"
}

# 1-3: cold npx + inline onboard (key comes from env, no prompt) + live audit.
# NOTE: runs in a scratch repo so the audited diff is real but meaningless.
$scratch = Join-Path $sandbox "scratch"
New-Item -ItemType Directory -Path $scratch | Out-Null
Push-Location $scratch
try {
  git init -q
  git config user.email "fresh@test"
  git config user.name "fresh"
  "console.log('fresh install probe')" | Out-File -Encoding utf8 app.js
  git add app.js

  $env:USERPROFILE = $fakeHome
  $env:npm_config_cache = $npmCache
  $env:CLAUDE_CONFIG_DIR = $claudeCfg

  Write-Host "`n=== 1. cold npx download ==="
  npx -y "@kushwho/jev-codes@$Version" --version

  Write-Host "`n=== 2. inline onboard (no args) ==="
  "n" | npx -y "@kushwho/jev-codes@$Version"

  Write-Host "`n=== 3. live audit --json ==="
  npx -y "@kushwho/jev-codes@$Version" audit --staged --json
} finally {
  Pop-Location
}

# 4: plugin install into the sandbox Claude config only.
Write-Host "`n=== 4. Claude plugin from marketplace ==="
$env:CLAUDE_CONFIG_DIR = $claudeCfg
claude plugin marketplace add Kushwho/jev-codes
claude plugin install jev-codes@kushwho-marketplace
claude plugin list

Write-Host "`nSandbox (safe to delete): $sandbox"
Write-Host "Config written by onboard: $(Join-Path $fakeHome '.jev-codes\config.json')"
