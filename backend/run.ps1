param(
    [Parameter(Position = 0)]
    [ValidateSet("test", "serve", "key")]
    [string]$Action = "serve"
)

# Prefer WinGet PHP, then XAMPP (no PATH required)
$phpCandidates = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe",
    "C:\xampp\php\php.exe"
)
$php = $phpCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $php) {
    Write-Error "PHP not found. Install PHP via winget (PHP.PHP.8.3) or XAMPP, then edit run.ps1."
    exit 1
}

Set-Location $PSScriptRoot

switch ($Action) {
    "test"  { & $php scripts\test_db.php }
    "serve" {
        Write-Host "API: http://192.168.20.6:8082/api/health"
        Write-Host "     (listening on 0.0.0.0:8082 - assign 192.168.20.6 via scripts\set-network-ip.ps1 if needed)"
        & $php -S 0.0.0.0:8082 -t public
    }
    "key"   { & $php -r "echo base64_encode(random_bytes(32)), PHP_EOL;" }
}
