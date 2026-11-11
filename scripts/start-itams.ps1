# Start ITAMS API + frontend (idempotent — skips if ports already in use)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-PortInUse([int]$Port) {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$c
}

function Get-PhpExe {
    $candidates = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe",
        'C:\xampp\php\php.exe'
    )
    $php = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $php) { throw 'PHP not found. Install PHP 8.3 or XAMPP.' }
    return $php
}

# Ensure PostgreSQL is up if the service exists
$pg = Get-Service -Name 'postgresql-x64-18' -ErrorAction SilentlyContinue
if ($pg -and $pg.Status -ne 'Running') {
    try { Start-Service $pg.Name } catch { Write-Warning "Could not start PostgreSQL: $_" }
}

$php = Get-PhpExe

# --- API :8082 ---
if (Test-PortInUse 8082) {
    Write-Host 'API already listening on :8082'
} else {
    $apiOut = Join-Path $LogDir 'api.out.log'
    $apiErr = Join-Path $LogDir 'api.err.log'
    Start-Process -FilePath $php `
        -ArgumentList '-S', '0.0.0.0:8082', '-t', 'public' `
        -WorkingDirectory (Join-Path $Root 'backend') `
        -WindowStyle Hidden `
        -RedirectStandardOutput $apiOut `
        -RedirectStandardError $apiErr
    Write-Host 'Started API on :8082'
}

# --- Frontend :5174 ---
if (Test-PortInUse 5174) {
    Write-Host 'Frontend already listening on :5174'
} else {
    $feOut = Join-Path $LogDir 'frontend.out.log'
    $feErr = Join-Path $LogDir 'frontend.err.log'
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    $npm = if ($npmCmd) { $npmCmd.Source } else { 'C:\Program Files\nodejs\npm.cmd' }
    if (-not (Test-Path $npm)) { throw 'npm not found. Install Node.js.' }

    Start-Process -FilePath $npm `
        -ArgumentList 'run', 'dev' `
        -WorkingDirectory (Join-Path $Root 'frontend') `
        -WindowStyle Hidden `
        -RedirectStandardOutput $feOut `
        -RedirectStandardError $feErr
    Write-Host 'Started frontend on :5174'
}

Write-Host ''
Write-Host 'App:  http://localhost:5174/'
Write-Host 'API:  http://127.0.0.1:8082/api/health'
Write-Host "Logs: $LogDir"
