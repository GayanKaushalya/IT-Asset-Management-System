-- Master sync: all schema changes for credentials + handovers (idempotent)
-- Safe to re-run on Postgres / Supabase

-- 1) Foton company + wifi credential type
INSERT INTO companies (code, name, short_name)
SELECT 'FOTON', 'Indra Foton', 'Foton'
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE code = 'FOTON');

INSERT INTO locations (company_id, code, name, city)
SELECT c.id, v.code, v.name, v.city
FROM companies c
CROSS JOIN (
    SELECT 'KANDY_HO' AS code, 'Kandy Head Office' AS name, 'Kandy' AS city
    UNION ALL
    SELECT 'CMB_BR', 'Colombo Branch', 'Colombo'
) AS v
WHERE c.code = 'FOTON'
  AND NOT EXISTS (
      SELECT 1 FROM locations l WHERE l.company_id = c.id AND l.code = v.code
  );

INSERT INTO departments (company_id, location_id, code, name)
SELECT c.id, l.id, d.code, d.name
FROM companies c
JOIN locations l ON l.company_id = c.id AND l.code = 'KANDY_HO'
CROSS JOIN (
    SELECT 'ACCOUNTS' AS code, 'Accounts Dept' AS name
    UNION ALL SELECT 'SALES', 'Sales'
    UNION ALL SELECT 'IT', 'Central IT'
    UNION ALL SELECT 'OPS', 'Operations'
) AS d
WHERE c.code = 'FOTON'
  AND NOT EXISTS (
      SELECT 1 FROM departments x WHERE x.company_id = c.id AND x.code = d.code
  );

DO $$ BEGIN
    ALTER TYPE credential_type ADD VALUE IF NOT EXISTS 'wifi';
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;

-- 2) Dedicated email accounts (shared mailbox, many users)
CREATE TABLE IF NOT EXISTS email_accounts (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    email_address       VARCHAR(191) NOT NULL,
    password_ciphertext TEXT NOT NULL,
    encryption_version  SMALLINT NOT NULL DEFAULT 1,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_email_accounts_company_email UNIQUE (company_id, email_address)
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_company ON email_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_email ON email_accounts(email_address);

CREATE TABLE IF NOT EXISTS email_account_users (
    id                  BIGSERIAL PRIMARY KEY,
    email_account_id    BIGINT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    user_name           VARCHAR(150) NOT NULL,
    location_id         BIGINT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_account_users_account ON email_account_users(email_account_id);
CREATE INDEX IF NOT EXISTS idx_email_account_users_location ON email_account_users(location_id);

-- 3) Handover persons 1..4 + dates on laptop / mobile
ALTER TABLE laptops
    ADD COLUMN IF NOT EXISTS handover_person_1 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_2 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_3 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_4 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_on_1 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_2 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_3 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_4 DATE;

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS handover_person_1 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_2 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_3 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_4 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_on_1 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_2 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_3 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_4 DATE;

UPDATE mobile_phones
SET handover_person_1 = COALESCE(NULLIF(handover_person_1, ''), first_handover_person),
    handover_on_1 = COALESCE(handover_on_1, handed_over_on)
WHERE first_handover_person IS NOT NULL OR handed_over_on IS NOT NULL;

-- 4) Original assigned + current allocated user
ALTER TABLE laptops
    ADD COLUMN IF NOT EXISTS original_assigned_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS original_assigned_on DATE,
    ADD COLUMN IF NOT EXISTS allocated_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS allocated_on DATE;

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS original_assigned_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS original_assigned_on DATE,
    ADD COLUMN IF NOT EXISTS allocated_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS allocated_on DATE;

UPDATE laptops SET
    original_assigned_person = COALESCE(original_assigned_person, handover_person_1),
    original_assigned_on = COALESCE(original_assigned_on, handover_on_1)
WHERE handover_person_1 IS NOT NULL OR handover_on_1 IS NOT NULL;

UPDATE mobile_phones SET
    original_assigned_person = COALESCE(original_assigned_person, handover_person_1, first_handover_person),
    original_assigned_on = COALESCE(original_assigned_on, handover_on_1, handed_over_on)
WHERE handover_person_1 IS NOT NULL OR first_handover_person IS NOT NULL
   OR handover_on_1 IS NOT NULL OR handed_over_on IS NOT NULL;

UPDATE laptops l SET
    allocated_person = h.assigned_person_name,
    allocated_on = h.handover_date
FROM asset_handovers h
WHERE h.asset_type = 'laptop' AND h.asset_id = l.id AND h.is_open = TRUE
  AND NULLIF(h.assigned_person_name, '') IS NOT NULL;

UPDATE mobile_phones m SET
    allocated_person = h.assigned_person_name,
    allocated_on = h.handover_date
FROM asset_handovers h
WHERE h.asset_type = 'mobile_phone' AND h.asset_id = m.id AND h.is_open = TRUE
  AND NULLIF(h.assigned_person_name, '') IS NOT NULL;

UPDATE asset_handovers
SET handover_date = COALESCE(handover_date, created_at::date, CURRENT_DATE)
WHERE handover_date IS NULL
  AND asset_type IN ('laptop', 'mobile_phone');

-- Backfill slots 1..4 from history where empty
WITH ranked AS (
    SELECT ah.asset_id, ah.asset_type, ah.assigned_person_name, ah.handover_date,
           ROW_NUMBER() OVER (PARTITION BY ah.asset_type, ah.asset_id ORDER BY ah.id) AS rn
    FROM asset_handovers ah
    WHERE ah.asset_type IN ('laptop', 'mobile_phone')
      AND NULLIF(ah.assigned_person_name, '') IS NOT NULL
)
UPDATE laptops l SET
    handover_person_1 = COALESCE(l.handover_person_1, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 1)),
    handover_on_1     = COALESCE(l.handover_on_1,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 1)),
    handover_person_2 = COALESCE(l.handover_person_2, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 2)),
    handover_on_2     = COALESCE(l.handover_on_2,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 2)),
    handover_person_3 = COALESCE(l.handover_person_3, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 3)),
    handover_on_3     = COALESCE(l.handover_on_3,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 3)),
    handover_person_4 = COALESCE(l.handover_person_4, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 4)),
    handover_on_4     = COALESCE(l.handover_on_4,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 4));

WITH ranked AS (
    SELECT ah.asset_id, ah.assigned_person_name, ah.handover_date,
           ROW_NUMBER() OVER (PARTITION BY ah.asset_id ORDER BY ah.id) AS rn
    FROM asset_handovers ah
    WHERE ah.asset_type = 'mobile_phone'
      AND NULLIF(ah.assigned_person_name, '') IS NOT NULL
)
UPDATE mobile_phones m SET
    handover_person_1 = COALESCE(m.handover_person_1, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 1)),
    handover_on_1     = COALESCE(m.handover_on_1,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 1)),
    handover_person_2 = COALESCE(m.handover_person_2, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 2)),
    handover_on_2     = COALESCE(m.handover_on_2,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 2)),
    handover_person_3 = COALESCE(m.handover_person_3, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 3)),
    handover_on_3     = COALESCE(m.handover_on_3,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 3)),
    handover_person_4 = COALESCE(m.handover_person_4, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 4)),
    handover_on_4     = COALESCE(m.handover_on_4,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 4)),
    first_handover_person = COALESCE(m.first_handover_person, m.handover_person_1),
    handed_over_on = COALESCE(m.handed_over_on, m.handover_on_1);

-- 5) Sync IT status badges: Allocated (deployed) vs Available
-- Does not overwrite under_repair / disposed
UPDATE laptops l SET
    status = 'deployed',
    updated_at = NOW()
WHERE l.status IN ('available', 'deployed')
  AND (
      NULLIF(l.allocated_person, '') IS NOT NULL
      OR EXISTS (
          SELECT 1 FROM asset_handovers h
          WHERE h.asset_type = 'laptop' AND h.asset_id = l.id AND h.is_open = TRUE
      )
  );

UPDATE laptops l SET
    status = 'available',
    updated_at = NOW()
WHERE l.status = 'deployed'
  AND NULLIF(l.allocated_person, '') IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM asset_handovers h
      WHERE h.asset_type = 'laptop' AND h.asset_id = l.id AND h.is_open = TRUE
  );

UPDATE mobile_phones m SET
    status = 'deployed',
    updated_at = NOW()
WHERE m.status IN ('available', 'deployed')
  AND (
      NULLIF(m.allocated_person, '') IS NOT NULL
      OR EXISTS (
          SELECT 1 FROM asset_handovers h
          WHERE h.asset_type = 'mobile_phone' AND h.asset_id = m.id AND h.is_open = TRUE
      )
  );

UPDATE mobile_phones m SET
    status = 'available',
    updated_at = NOW()
WHERE m.status = 'deployed'
  AND NULLIF(m.allocated_person, '') IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM asset_handovers h
      WHERE h.asset_type = 'mobile_phone' AND h.asset_id = m.id AND h.is_open = TRUE
  );
