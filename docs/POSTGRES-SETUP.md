# Local PostgreSQL setup (ITAMS)

ITAMS uses **PostgreSQL 18** on this server — not Supabase cloud.

## Current install

| Setting | Value |
|---------|--------|
| Service | `postgresql-x64-18` |
| Data directory | `D:\PostgreSQL` |
| Host | `127.0.0.1` |
| Port | `5432` |
| Database | `itams` |
| Superuser | `postgres` |
| App user | `itams` (optional, same password) |
| Password | `itams_local` (change in production) |

## One-command setup

Creates database, users, schema, and grants (safe to re-run):

```powershell
cd D:\ITAMS\scripts
.\setup-postgres.ps1
```

**Fresh database** (deletes all data):

```powershell
.\setup-postgres.ps1 -Fresh
```

**Fresh + restore from Supabase backup**:

```powershell
.\setup-postgres.ps1 -Fresh -RestoreBackup
```

## Monitor data with pgAdmin (dashboard)

**pgAdmin 4** is already installed with PostgreSQL 18. Use it to browse tables, run queries, and watch live data (similar to the old Supabase table editor).

### Open pgAdmin

Start menu → **pgAdmin 4**, or run:

```powershell
& "C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime\pgAdmin4.exe"
```

First launch: set a **master password** for pgAdmin (local only, not your DB password).

### Connect to ITAMS

1. Left panel → **Servers** → right-click → **Register → Server…**
2. **General** tab → Name: `ITAMS Local`
3. **Connection** tab:

   | Field | Value |
   |-------|--------|
   | Host | `127.0.0.1` |
   | Port | `5432` |
   | Maintenance database | `itams` |
   | Username | `postgres` |
   | Password | `itams_local` |

4. Check **Save password** → **Save**

### Browse tables (like Supabase)

Expand: **ITAMS Local → Databases → itams → Schemas → public → Tables**

Right-click any table → **View/Edit Data → All Rows**

Useful tables:

| Table | What you see |
|-------|----------------|
| `companies` | Sub-companies (IT, IMS, ISP…) |
| `laptops` | Laptop inventory |
| `mobile_phones` | Phone inventory |
| `asset_handovers` | Check-out / check-in history |
| `credentials` | Vault entries (encrypted passwords) |
| `users` | Login accounts |
| `email_accounts` | Shared mailboxes |

### Run monitoring queries

1. Right-click database **itams** → **Query Tool**
2. Open file `D:\ITAMS\database\monitor-queries.sql` (File → Open)
3. Click **Execute** (F5) — shows counts, assets by company, recent handovers

### Dashboard / stats (optional)

pgAdmin → **Dashboard** tab (when server is selected) shows connections, DB size, and activity graphs.

For a web-style dashboard, use the **ITAMS app** itself: http://192.168.20.6:5174 (Dashboard page reads the same Postgres data).

## Command line (psql)

```powershell
$env:PGPASSWORD = 'itams_local'
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -d itams
```

Useful checks:

```sql
SELECT code, name FROM companies;
SELECT count(*) FROM laptops;
SELECT id, email, role FROM users;
```

## Link to ITAMS API

`backend/config/config.php`:

```php
'db' => [
    'driver' => 'pgsql',
    'host' => '127.0.0.1',
    'port' => '5432',
    'name' => 'itams',
    'user' => 'postgres',
    'pass' => 'itams_local',
    'sslmode' => 'disable',
],
```

Test from the project:

```powershell
cd D:\ITAMS\backend
.\run.ps1 test
```

## Backup

Manual dump:

```powershell
$env:PGPASSWORD = 'itams_local'
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -h 127.0.0.1 -d itams -F p -f "D:\ITAMS\backups\itams_local_$(Get-Date -Format yyyyMMdd_HHmmss).sql"
```

Or use the existing PHP backup script:

```powershell
php D:\ITAMS\database\backup_supabase.php
```

## Service management

```powershell
Get-Service postgresql-x64-18
Restart-Service postgresql-x64-18   # requires admin
```

## Install PostgreSQL (new machine)

```powershell
winget install PostgreSQL.PostgreSQL.18
```

During install: set superuser password, data directory (e.g. `D:\PostgreSQL`), port `5432`.

Then run `D:\ITAMS\scripts\setup-postgres.ps1 -RestoreBackup` to load your data.
