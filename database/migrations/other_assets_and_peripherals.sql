-- Other Assets: full inventory fields (Excel-style)
ALTER TABLE other_assets
    ADD COLUMN IF NOT EXISTS user_name VARCHAR(150),
    ADD COLUMN IF NOT EXISTS item_name VARCHAR(150),
    ADD COLUMN IF NOT EXISTS specification TEXT,
    ADD COLUMN IF NOT EXISTS warranty_period VARCHAR(100),
    ADD COLUMN IF NOT EXISTS handover_date DATE;

UPDATE other_assets
SET user_name = COALESCE(NULLIF(user_name, ''), pc_name)
WHERE user_name IS NULL AND pc_name IS NOT NULL;

-- Peripherals inventory (keyboards, mice, cables, adapters)
DO $$ BEGIN
    CREATE TYPE peripheral_kind AS ENUM ('keyboard', 'mouse', 'cable', 'adapter');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS peripherals (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id         BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    department_id       BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    supplier_id         BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
    asset_tag           VARCHAR(64) NOT NULL,
    peripheral_kind     peripheral_kind NOT NULL,
    user_name           VARCHAR(150),
    item_name           VARCHAR(150),
    serial_number       VARCHAR(100),
    brand               VARCHAR(100),
    model               VARCHAR(150),
    status              asset_status NOT NULL DEFAULT 'available',
    invoice_no          VARCHAR(80),
    purchase_amount_lkr NUMERIC(14,2),
    purchase_date       DATE,
    warranty_period     VARCHAR(100),
    warranty_expires_on DATE,
    specification       TEXT,
    notes               TEXT,
    handover_date       DATE,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, asset_tag)
);

CREATE INDEX IF NOT EXISTS idx_peripherals_company ON peripherals(company_id);
CREATE INDEX IF NOT EXISTS idx_peripherals_kind ON peripherals(peripheral_kind);

-- Company-specific departments
-- ITL: IT, HR, Audit, Admin, Maintenance, Import, Accounts, Sales, Legal, Other
INSERT INTO departments (company_id, location_id, code, name)
SELECT c.id, l.id, d.code, d.name
FROM companies c
JOIN locations l ON l.company_id = c.id AND l.code = 'KANDY_HO'
CROSS JOIN (VALUES
    ('IT', 'IT'),
    ('HR', 'HR'),
    ('AUDIT', 'Audit'),
    ('ADMIN', 'Admin'),
    ('MAINTENANCE', 'Maintenance'),
    ('IMPORT', 'Import'),
    ('ACCOUNTS', 'Accounts'),
    ('SALES', 'Sales'),
    ('LEGAL', 'Legal'),
    ('OTHER', 'Other')
) AS d(code, name)
WHERE c.code = 'IT'
ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE;

-- IMS / ISP: Accounts, Sales
INSERT INTO departments (company_id, location_id, code, name)
SELECT c.id, l.id, d.code, d.name
FROM companies c
JOIN locations l ON l.company_id = c.id AND l.code = 'KANDY_HO'
CROSS JOIN (VALUES
    ('ACCOUNTS', 'Accounts'),
    ('SALES', 'Sales')
) AS d(code, name)
WHERE c.code IN ('IMS', 'ISP')
ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE;

-- Soft-disable leftover seed depts that are not in the new lists
UPDATE departments d
SET is_active = FALSE
FROM companies c
WHERE d.company_id = c.id
  AND c.code = 'IT'
  AND d.code NOT IN ('IT','HR','AUDIT','ADMIN','MAINTENANCE','IMPORT','ACCOUNTS','SALES','LEGAL','OTHER');

UPDATE departments d
SET is_active = FALSE
FROM companies c
WHERE d.company_id = c.id
  AND c.code IN ('IMS', 'ISP')
  AND d.code NOT IN ('ACCOUNTS', 'SALES');
