# Deploy: Vercel (React) + MySQL + Render (PHP)

```text
Browser → Vercel (frontend)
              ↓
         Render (pure PHP API)
              ↓  DATABASE_URL=mysql://...
         MySQL 8 (local, Railway, Aiven, etc.)
```

---

## 0. Push code to GitHub

```powershell
cd d:\ITAMS
git init
git add .
git commit -m "Indra ITAM — PHP + MySQL + React"
git branch -M main
git remote add origin https://github.com/YOUR_USER/indra-itam.git
git push -u origin main
```

---

## 1. MySQL database

### Option A — Local (XAMPP / Laragon / MySQL Installer)

```sql
CREATE DATABASE indra_itam CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Then import:

```powershell
mysql -u root -p indra_itam < d:\ITAMS\database\schema.sql
mysql -u root -p indra_itam < d:\ITAMS\database\seed_admin.sql
```

### Option B — Free/cheap cloud MySQL

Pick one MySQL host, create a database, then run `schema.sql` + `seed_admin.sql` in their SQL console:

| Provider | Notes |
|----------|--------|
| [Railway](https://railway.app) | MySQL plugin + connection URL |
| [Aiven](https://aiven.io) | Free trial MySQL |
| [TiDB Cloud Serverless](https://www.pingcap.com/tidb-cloud/) | MySQL-compatible free tier |
| [db4free.net](https://www.db4free.net) | Free demo only (unreliable) |

Connection URL format for Render:

```text
mysql://USER:PASSWORD@HOST:3306/DATABASE
```

Confirm admin user:

```sql
SELECT id, email, role FROM users;
```

---

## 2. Render (PHP API)

1. [render.com](https://render.com) → **New Web Service** → your GitHub repo  
2. Settings:

| Field | Value |
|--------|--------|
| Root Directory | `backend` |
| Runtime | **Docker** |
| Plan | Free |

3. Environment:

| Key | Value |
|-----|--------|
| `APP_ENV` | `production` |
| `APP_DEBUG` | `false` |
| `DATABASE_URL` | `mysql://user:pass@host:3306/indra_itam` |
| `VAULT_ENCRYPTION_KEY` | base64 32-byte key |
| `API_TOKENS` | `demo-token:1` |
| `CORS_ORIGIN` | set after Vercel URL exists |

4. Test: `https://YOUR-API.onrender.com/api/health`

---

## 3. Vercel (React)

| Field | Value |
|--------|--------|
| Root Directory | `frontend` |
| Framework | Vite |
| `VITE_API_URL` | `https://YOUR-API.onrender.com` |
| `VITE_API_TOKEN` | `demo-token` |

Then set Render `CORS_ORIGIN` to your Vercel URL and redeploy.

---

## Checklist

- [ ] MySQL: `schema.sql` + `seed_admin.sql`  
- [ ] Render `/api/health` OK  
- [ ] `DATABASE_URL` starts with `mysql://`  
- [ ] Vercel env points at Render  
- [ ] CORS matches Vercel domain  
