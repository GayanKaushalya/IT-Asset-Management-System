# Indra Group — IT Asset & Credential Management (ITAM)

Central IT (Kandy Head Office) system for multi-company asset tracking and a secure credential vault across:

- **Indra Traders**
- **Indra Motor Spares**
- **Indra Service Park**

## Free cloud demo (Vercel + MySQL + Render)

Step-by-step: [`docs/DEPLOY-VERCEL-MYSQL-RENDER.md`](docs/DEPLOY-VERCEL-MYSQL-RENDER.md)

| Service | Role |
|---------|------|
| **MySQL 8** | Database (`database/schema.sql`) |
| **Render** | Pure PHP API (Docker in `backend/`) |
| **Vercel** | React frontend (`frontend/`) |

## Tech stack (locked)

| Layer | Choice | Why |
|--------|--------|-----|
| **Backend** | **Pure PHP 8.2+** (PDO, OpenSSL) | No Laravel/framework — thin router + controllers |
| **Frontend** | **TypeScript + React 18** (Vite) | Interactive dashboard charts (Recharts) |
| Database | **MySQL 8.0+** | InnoDB, utf8mb4, widely hosted |
| Auth | Bearer API token (simple) | Swap for sessions/JWT later if needed |
| Charts | Recharts | Pie / bar / line widgets |
| Vault crypto | AES-256-GCM (OpenSSL in PHP) | Passwords never stored in plaintext |

```text
ITAMS/
  backend/          # Pure PHP API
    public/         # Document root (index.php)
    src/            # Controllers, Services, Http, Database
    config/         # config.example.php → config.php
  frontend/         # React + TypeScript SPA
  database/         # schema.sql
```

## What is in this starter

| Path | Purpose |
|------|---------|
| `database/schema.sql` | Full MySQL 8 DDL + seeds + dashboard views |
| `backend/public/index.php` | Front controller / API entry |
| `backend/src/Services/CredentialEncryptionService.php` | AES-256-GCM encrypt/decrypt |
| `backend/src/Controllers/*` | Dashboard + Credential Vault APIs |
| `frontend/src/pages/Dashboard.tsx` | Dashboard with dummy chart data |

## Quick start

### 1. Database (MySQL)

```bash
mysql -u root -p -e "CREATE DATABASE indra_itam CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p indra_itam < database/schema.sql
mysql -u root -p indra_itam < database/seed_admin.sql
```

### 2. Pure PHP API

```bash
cd backend
copy config\config.example.php config\config.php
# Edit config.php: DB credentials + vault_encryption_key + api_tokens
composer dump-autoload   # optional; spl_autoload works without vendor/

# Built-in server (document root = public/)
php -S localhost:8080 -t public
```

Generate vault key:

```bash
php -r "echo base64_encode(random_bytes(32)), PHP_EOL;"
```

Local auth (dev): set `app.env` to `local` and send header `X-User-Id: 1`  
(or map a Bearer token in `config.php` → `api_tokens`).

### 3. React frontend

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install recharts
# Copy src/pages, src/components, src/services, src/types from this starter
```

Point API calls at `http://localhost:8080/api/...`.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/dashboard?warranty_days=90` | Dashboard aggregates |
| POST | `/api/credentials` | Store encrypted credential |
| POST | `/api/credentials/{id}/reveal` | Decrypt (IT admin only) |
| PUT | `/api/credentials/{id}/password` | Rotate password |

## Security notes (Credential Vault)

- Store **only** `password_ciphertext` — never plaintext.
- Decrypt only for `super_admin` / `it_admin` (or `can_decrypt_vault = true`).
- Enforce **company segregation** on every vault read/write.
- Log every `view_decrypt` / `create` / `update` in `credential_access_logs`.
- Do not commit `backend/config/config.php`.

## Reporting module (next build)

| Report | Suggested endpoint | Export |
|--------|--------------------|--------|
| Assets by Sub-Company | `GET /api/reports/assets-by-company` | CSV / PDF |
| Assets by Department | `GET /api/reports/assets-by-department` | CSV / PDF |
| Warranty Expiry | `GET /api/reports/warranty-expiry?days=90` | CSV / PDF |
| Handover / Gate Pass Receipt | `GET /api/handovers/{uuid}/gate-pass` | Printable PDF |

## Multi-company access model

- `super_admin` (Central IT, Kandy HO): all companies.
- Other roles: scoped to `users.company_id`.
- Every asset, handover, and credential row carries `company_id`.
