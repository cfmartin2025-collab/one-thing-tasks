# Deploys the One Thing push server to Cloudflare.
# First time: run `npx wrangler login` in server\ (opens a browser to approve), then this script.
# Safe to run again: it reuses the KV namespace and keys it already made.
$ErrorActionPreference = "Stop"
$env:Path = "$env:LOCALAPPDATA\Programs\nodejs;$env:Path"
$server = Join-Path (Split-Path -Parent $PSScriptRoot) "server"
Push-Location $server
try {
  $toml = Get-Content wrangler.toml -Raw

  # 1. KV namespace (once).
  if ($toml -match 'REPLACE_WITH_KV_ID') {
    $out = npx --yes wrangler@4 kv namespace create OT 2>&1 | Out-String
    $m = [regex]::Match($out, 'id\s*=\s*"([0-9a-f]{32})"')
    if (-not $m.Success) { throw "Could not read the KV id from:`n$out" }
    $toml = $toml.Replace('REPLACE_WITH_KV_ID', $m.Groups[1].Value)
    [IO.File]::WriteAllText((Join-Path $server "wrangler.toml"), $toml, (New-Object Text.UTF8Encoding $false))
    Write-Host "KV namespace created."
  }

  # 2. VAPID keys (once). Kept locally in server\.vapid.json (git-ignored) so redeploys keep the same key.
  $vapidFile = Join-Path $server ".vapid.json"
  # Secrets go up from a file with `secret bulk`: piping text into a program from Windows PowerShell
  # adds a byte-order mark, which corrupts the key.
  if (-not (Test-Path $vapidFile) -or $args -contains "-resetSecrets") {
    node --input-type=module -e "import {writeFileSync,existsSync,readFileSync} from 'node:fs'; import {makeVapidKeys} from './src/webpush.js'; const f='.vapid.json'; const k=existsSync(f)?JSON.parse(readFileSync(f,'utf8').replace(/^﻿/,'')):await makeVapidKeys(); writeFileSync(f,JSON.stringify(k)); writeFileSync('.secrets.json',JSON.stringify({VAPID_PUBLIC:k.publicKey,VAPID_PRIVATE:JSON.stringify(k.privateJwk)}));"
    npx --yes wrangler@4 secret bulk .secrets.json | Out-Null
    Remove-Item .secrets.json -Force
    Write-Host "Push keys stored."
  }

  # 3. Deploy.
  $dep = npx --yes wrangler@4 deploy 2>&1 | Out-String
  Write-Host $dep
  $u = [regex]::Match($dep, 'https://one-thing-push\.[a-z0-9-]+\.workers\.dev')
  if ($u.Success) { Write-Host "PUSH_URL=$($u.Value)" }
} finally { Pop-Location }
