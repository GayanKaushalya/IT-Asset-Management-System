# ITAMS — local PostgreSQL 18 setup
# Run from PowerShell (postgres superuser password required on first run if not trust auth)
#
#   cd D:\ITAMS\scripts
#   .\setup-postgres.ps1
#
# Fresh reinstall (drops database — all data lost):
#   .\setup-postgres.ps1 -Fresh

param(
    [switch]$Fresh,
    [switch]$RestoreBackup,
    [string]$PgSuperPassword = 'itams_local',
    [string]$AppDbPassword = 'itams_local'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$psqlCandidates = @(
    'C:\Program Files\PostgreSQL\18\bin\psql.exe',
    'C:\Program Files\PostgreSQL\17\bin\psql.exe',
    'C:\Program Files\PostgreSQL\16\bin\psql.exe'
)
$psql = $psqlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $psql) {
    Write-Error "psql not found. Install PostgreSQL 18 from https://www.postgresql.org/download/windows/ or winget install PostgreSQL.PostgreSQL.18"
}

$pgService = Get-Service -Name 'postgresql-x64-18' -ErrorAction SilentlyContinue
if ($pgService -and $pgService.Status -ne 'Running') {
    Write-Host "Starting PostgreSQL service..."
    Start-Service $pgService.Name
}

$env:PGPASSWORD = $PgSuperPassword
$pgHost = '127.0.0.1'
$pgPort = '5432'
$superUser = 'postgres'
$dbName = 'itams'
$appUser = 'itams'

function Invoke-Psql {
    param(
        [string]$Sql,
        [string]$Database = 'postgres'
    )
    & $psql -U $superUser -h $pgHost -p $pgPort -d $Database -v ON_ERROR_STOP=1 -c $Sql
}

function Get-PsqlScalar {
    param([string]$Sql, [string]$Database = 'postgres')
    $out = & $psql -U $superUser -h $pgHost -p $pgPort -d $Database -Atc $Sql 2>$null
    if ($null -eq $out) { return '' }
    if ($out -is [array]) { return ($out -join '').Trim() }
    return "$out".Trim()
}

function Invoke-PsqlFile {
    param(
        [string]$Path,
        [string]$Database = $dbName
    )
    if (-not (Test-Path $Path)) {
        throw "SQL file not found: $Path"
    }
    Write-Host "  -> $(Split-Path $Path -Leaf)"
    & $psql -U $superUser -h $pgHost -p $pgPort -d $Database -v ON_ERROR_STOP=1 -f $Path | Out-Null
}

Write-Host "PostgreSQL: $psql"
Write-Host "Database:   $dbName on ${pgHost}:${pgPort}"
Write-Host ""

# App user (for pgAdmin / least privilege; API can use postgres or itams)
$roleExists = Get-PsqlScalar "SELECT 1 FROM pg_roles WHERE rolname='$appUser'"
if ($roleExists -ne '1') {
    Invoke-Psql "CREATE ROLE $appUser LOGIN PASSWORD '$AppDbPassword';"
} else {
    Invoke-Psql "ALTER ROLE $appUser WITH PASSWORD '$AppDbPassword';"
}

if ($Fresh) {
    Write-Host "Fresh: dropping database $dbName..."
    Invoke-Psql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$dbName' AND pid <> pg_backend_pid();" | Out-Null
    Invoke-Psql "DROP DATABASE IF EXISTS $dbName;"
}

$dbExists = Get-PsqlScalar "SELECT 1 FROM pg_database WHERE datname='$dbName'"
if ($dbExists -ne '1') {
    Write-Host "Creating database $dbName..."
    Invoke-Psql "CREATE DATABASE $dbName OWNER $superUser ENCODING 'UTF8' TEMPLATE template0;"
}

Invoke-Psql "GRANT ALL PRIVILEGES ON DATABASE $dbName TO $appUser;" -Database postgres
Invoke-Psql "GRANT ALL ON SCHEMA public TO $appUser;" -Database $dbName
Invoke-Psql "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $appUser;" -Database $dbName
Invoke-Psql "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $appUser;" -Database $dbName
Invoke-Psql "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $appUser;" -Database $dbName
Invoke-Psql "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $appUser;" -Database $dbName

$tableCount = Get-PsqlScalar "SELECT count(*) FROM pg_tables WHERE schemaname='public'" -Database $dbName
if ([int]$tableCount -lt 5) {
    Write-Host "Applying schema..."
    Invoke-PsqlFile "$root\database\schema.supabase.sql"
    Invoke-PsqlFile "$root\database\system_auth.sql"
    Invoke-PsqlFile "$root\database\migrations\sync_all_recent_changes.sql"
    $extra = @(
        'create_email_accounts.sql',
        'other_assets_and_peripherals.sql',
        'add_acceptance_form_printed.sql',
        'extend_mobile_phones_for_excel.sql',
        'add_mobile_phone_accessories.sql',
        'add_mobile_phone_warranty.sql',
        'add_pc_accessories.sql',
        'add_pc_ups_brand.sql',
        'add_handover_report_hidden.sql',
        'add_other_assets_handover_report_hidden.sql',
        'seed_branch_locations.sql'
    )
    foreach ($f in $extra) {
        $p = Join-Path "$root\database\migrations" $f
        if (Test-Path $p) { Invoke-PsqlFile $p }
    }
    Invoke-Psql "CREATE TABLE IF NOT EXISTS assets_legacy (id BIGSERIAL PRIMARY KEY);" -Database $dbName
} else {
    Write-Host "Schema already present ($tableCount tables) - skipping DDL."
}

if ($RestoreBackup) {
    $backup = Get-ChildItem "$root\backups\itams_supabase_backup_*.sql" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $backup) {
        Write-Warning "No backup file in backups\ - skipping restore."
    } else {
        Write-Host "Restoring $($backup.Name)..."
        $raw = Get-Content $backup.FullName -Raw -Encoding UTF8
        $raw = [regex]::Replace($raw, 'TRUNCATE TABLE "[^"]+" CASCADE;\r?\n', '')
        $header = "SET session_replication_role = replica;`nSET client_encoding = 'UTF8';`nTRUNCATE TABLE api_access_tokens, asset_handovers, asset_peripherals, assets_legacy, credential_access_logs, credentials, email_account_users, email_accounts, handover_peripheral_checklist, laptops, mobile_phones, other_assets, pcs, peripherals, printers, departments, locations, suppliers, peripheral_types, users, companies RESTART IDENTITY CASCADE;`n`n"
        $restoreFile = Join-Path $root 'backups\_local_restore_tmp.sql'
        Set-Content $restoreFile ($header + $raw) -Encoding UTF8 -NoNewline
        & $psql -U $superUser -h $pgHost -p $pgPort -d $dbName -v ON_ERROR_STOP=1 -f $restoreFile | Out-Null
        Remove-Item $restoreFile -Force -ErrorAction SilentlyContinue
        Write-Host "Restore complete."
    }
}

Write-Host ""
Write-Host "=== Connection (pgAdmin or psql) ==="
Write-Host "  Host:     $pgHost"
Write-Host "  Port:     $pgPort"
Write-Host "  Database: $dbName"
Write-Host "  User:     $superUser  (or $appUser)"
Write-Host "  Password: $AppDbPassword"
Write-Host ""
Write-Host "backend/config/config.php should use:"
Write-Host "  host => '$pgHost', port => '$pgPort', name => '$dbName'"
Write-Host "  user => 'postgres', pass => '$AppDbPassword'"
Write-Host ""
Write-Host "Test: cd D:\ITAMS\backend; .\run.ps1 test"
