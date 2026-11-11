# Run as Administrator to assign ITAMS server IP 192.168.20.6
# Right-click PowerShell → Run as administrator, then:
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   D:\ITAMS\scripts\set-network-ip.ps1

#Requires -RunAsAdministrator

$iface = 'Ethernet'
$newIp = '192.168.20.6'
$prefix = 26
$gateway = '192.168.20.62'

$current = Get-NetIPAddress -InterfaceAlias $iface -AddressFamily IPv4 -ErrorAction Stop
Write-Host "Current: $($current.IPAddress)/$($current.PrefixLength) on $iface"

if ($current.IPAddress -eq $newIp) {
    Write-Host "Already set to $newIp"
    exit 0
}

Remove-NetIPAddress -InterfaceAlias $iface -AddressFamily IPv4 -Confirm:$false
New-NetIPAddress -InterfaceAlias $iface -IPAddress $newIp -PrefixLength $prefix -DefaultGateway $gateway
Write-Host "Done. ITAMS URLs:"
Write-Host "  Frontend: http://${newIp}:5174"
Write-Host "  API:      http://${newIp}:8082/api/health"
