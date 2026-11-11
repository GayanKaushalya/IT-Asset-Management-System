# Create ITAM tables on Supabase

Supabase = **PostgreSQL**. Do **not** use `database/schema.sql` (that file is MySQL).
Use: **`database/schema.supabase.sql`**

---

## A. Create tables in Supabase

1. Open https://supabase.com → your project  
2. Left menu → **SQL Editor** → **New query**  
3. Open file `d:\ITAMS\database\schema.supabase.sql`  
4. Copy **all** of it → paste into SQL Editor → click **Run**  
5. You should see companies + admin user at the end  

Check:

```sql
SELECT code, name FROM companies;
SELECT id, email, role FROM users;
```

---

## B. Get connection details

1. Supabase → **Project Settings** (gear) → **Database**  
2. Find **Connection string** → **URI**  

Example:

```text
postgresql://postgres.[PROJECT-REF]:YOUR_PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

Or Direct connection:

```text
Host:     db.xxxxxxxx.supabase.co
Port:     5432
Database: postgres
User:     postgres
Password: (the one you set when creating the project)
```

Always use **SSL** (`sslmode=require`).

---

## C. Connect from PHP (`backend/config/config.php`)

```php
<?php
return [
    'app' => [
        'name' => 'Indra Group ITAM',
        'env' => 'local',
        'debug' => true,
        'url' => 'http://localhost:8080',
        'cors_origin' => 'http://localhost:5173',
    ],

    'db' => [
        // Easiest: paste the full Supabase URI here
        'url' => 'postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres?sslmode=require',

        // Or use separate fields instead of url:
        // 'driver' => 'pgsql',
        // 'host' => 'db.YOUR_PROJECT_REF.supabase.co',
        // 'port' => '5432',
        // 'name' => 'postgres',
        // 'user' => 'postgres',
        // 'pass' => 'YOUR_PASSWORD',
        // 'sslmode' => 'require',
    ],

    'vault_encryption_key' => 'PASTE_BASE64_32_BYTE_KEY',

    'api_tokens' => [
        'demo-token' => ['user_id' => 1], // use the id from SELECT id FROM users
    ],
];
```

Also works as one env var on Render:

```text
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres?sslmode=require
```

---

## D. PHP extension required

Your PHP must have **`pdo_pgsql`** enabled (not only `pdo_mysql`).

- XAMPP/Laragon: enable `extension=pdo_pgsql` + `extension=pgsql` in `php.ini`  
- Docker/Render: image needs `pdo_pgsql` installed  

---

## Important

| File | Use on |
|------|--------|
| `schema.supabase.sql` | **Supabase / PostgreSQL** ← use this |
| `schema.sql` | MySQL only |

Password in the URI: if it has special characters (`@ # %`), URL-encode them.
