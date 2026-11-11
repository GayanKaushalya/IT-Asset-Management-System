# Register a Windows Scheduled Task so ITAMS starts at user logon.
# Run once:  powershell -ExecutionPolicy Bypass -File D:\ITAMS\scripts\install-autostart.ps1
# Optional:  -AtStartup  (runs at boot before login; needs admin)

param(
    [switch]$AtStartup,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'ITAMS Auto Start'
$StartScript = Join-Path $PSScriptRoot 'start-itams.ps1'

if (-not (Test-Path $StartScript)) {
    throw "Missing start script: $StartScript"
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task: $TaskName"
    exit 0
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""

if ($AtStartup) {
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
} else {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

Write-Host "Registered: $TaskName"
if ($AtStartup) {
    Write-Host 'Mode: At system startup (SYSTEM)'
} else {
    Write-Host "Mode: At logon for $env:USERNAME"
}
Write-Host ''
Write-Host 'Test now:'
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$StartScript`""
Write-Host ''
Write-Host 'Remove later:'
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Uninstall"
Write-Host ''
Write-Host 'Task Scheduler: taskschd.msc - look for ITAMS Auto Start'
