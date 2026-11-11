# Stop ITAMS processes listening on API/frontend ports
$ErrorActionPreference = 'Continue'

function Stop-Listeners([int]$Port, [string]$Label) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host "$Label (:$Port) — not running"
        return
    }
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
        try {
            $p = Get-Process -Id $procId -ErrorAction Stop
            Write-Host "Stopping $Label — $($p.ProcessName) (PID $procId)"
            Stop-Process -Id $procId -Force -ErrorAction Stop
        } catch {
            Write-Warning "Could not stop PID ${procId}: $_"
        }
    }
}

Stop-Listeners 8082 'API'
Stop-Listeners 5174 'Frontend'
Write-Host 'Done.'
