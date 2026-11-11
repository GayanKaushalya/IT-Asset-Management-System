# Run as Administrator — allow LAN access to ITAMS on ports 5174 and 8082
#Requires -RunAsAdministrator

$rules = @(
    @{ Name = 'ITAMS Frontend (5174)'; Port = 5174 },
    @{ Name = 'ITAMS API (8082)'; Port = 8082 }
)

foreach ($r in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Rule already exists: $($r.Name)"
        continue
    }
    New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $r.Port | Out-Null
    Write-Host "Added: $($r.Name)"
}

Write-Host "Done. Other PCs can reach http://192.168.20.6:5174 after IP is assigned."
