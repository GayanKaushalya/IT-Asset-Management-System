# Start ITAMS API + Vite (faster local PHP with OPcache when available)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host "ITAMS API  → http://127.0.0.1:8082"
Write-Host "ITAMS Web  → http://127.0.0.1:5174"
Write-Host ""

$phpArgs = @(
  '-d', 'opcache.enable_cli=1',
  '-d', 'opcache.memory_consumption=128',
  '-d', 'opcache.validate_timestamps=1',
  '-S', '127.0.0.1:8082',
  '-t', 'public'
)

Start-Process -FilePath 'php' -ArgumentList $phpArgs -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Minimized
Start-Process -FilePath 'npm' -ArgumentList @('run', 'dev') -WorkingDirectory (Join-Path $root 'frontend') -WindowStyle Minimized

Write-Host 'Started (minimized windows). Close those windows to stop.'
