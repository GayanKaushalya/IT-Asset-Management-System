# Turn ITAMS into a working system (local PostgreSQL)

## Database (local PostgreSQL)

PostgreSQL 18 runs on this machine (`D:\PostgreSQL`).

| Setting | Value |
|---------|--------|
| Database | `itams` |
| User | `postgres` |
| Password | `itams_local` |
| Host | `127.0.0.1:5432` |

Full guide: [`docs/POSTGRES-SETUP.md`](POSTGRES-SETUP.md)

Setup / repair database:

```powershell
cd D:\ITAMS\scripts
.\setup-postgres.ps1
```

Test API connection:

```powershell
cd D:\ITAMS\backend
.\run.ps1 test
```

## Server IP (LAN)

ITAMS is intended to run at **192.168.20.6** on the office network.

If this PC still shows another address (e.g. 192.168.20.3), run **as Administrator**:

```powershell
D:\ITAMS\scripts\set-network-ip.ps1
```

## Start API + frontend

```powershell
# Terminal 1
cd D:\ITAMS\backend
.\run.ps1 serve

# Terminal 2
cd D:\ITAMS\frontend
.\run.ps1
```

### Always run on this PC (auto-start)

One script starts both API + frontend (skips if already running):

```powershell
powershell -ExecutionPolicy Bypass -File D:\ITAMS\scripts\start-itams.ps1
```

Install once so it starts at Windows logon:

```powershell
powershell -ExecutionPolicy Bypass -File D:\ITAMS\scripts\install-autostart.ps1
```

| Command | Purpose |
|---------|---------|
| `scripts\start-itams.ps1` | Start now |
| `scripts\stop-itams.ps1` | Stop API + frontend |
| `scripts\install-autostart.ps1` | Register Task Scheduler (at logon) |
| `scripts\install-autostart.ps1 -Uninstall` | Remove auto-start |

Logs: `D:\ITAMS\logs\`

Open from any PC on the LAN:

- **App:** http://192.168.20.6:5174
- **API health:** http://192.168.20.6:8082/api/health

## First login

1. Open http://192.168.20.6:5174
2. Email: `it.admin@indragroup.lk`
3. Use your existing password from before (hashes were restored from the Supabase backup)

## What you get

| Module | Features |
|--------|----------|
| Login | Email/password, session token |
| Dashboard | Live stats from local Postgres |
| Assets | List + add (popup) |
| Handovers | Check-out / check-in (person name) |
| Credentials | Encrypt/store + reveal (IT admin) |
| Access Logs | Vault reveal/create/update history |
| Audit Logs | Logins, sessions, role/access changes |
| Users | Grant access, change role, activate/deactivate |
| Backups | Settings → Backups — create / download / restore |
