-- =============================================================================
-- Split assets into 5 category tables + polymorphic handovers
-- Run against Supabase (safe-ish to re-run)
-- =============================================================================

-- 1) New tables
CREATE TABLE IF NOT EXISTS laptops (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id         BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    department_id       BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    supplier_id         BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
    asset_tag           VARCHAR(64) NOT NULL,
    serial_number       VARCHAR(100),
    brand               VARCHAR(100),
    model               VARCHAR(150),
    status              asset_status NOT NULL DEFAULT 'available',
    pc_name             VARCHAR(100),
    cpu                 VARCHAR(150),
    ram_gb              NUMERIC(6,1),
    storage_gb          NUMERIC(10,1),
    storage_type        storage_type DEFAULT 'unknown',
    invoice_no          VARCHAR(80),
    purchase_amount_lkr NUMERIC(14,2),
    purchase_date       DATE,
    warranty_expires_on DATE,
    notes               TEXT,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, asset_tag)
);

CREATE TABLE IF NOT EXISTS mobile_phones (
    id                      BIGSERIAL PRIMARY KEY,
    uuid                    UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id              BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id             BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    department_id           BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    supplier_id             BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
    asset_tag               VARCHAR(64) NOT NULL,
    serial_number           VARCHAR(100),
    brand                   VARCHAR(100),
    model                   VARCHAR(150),
    status                  asset_status NOT NULL DEFAULT 'available',
    pc_name                 VARCHAR(100),
    invoice_no              VARCHAR(80),
    purchase_amount_lkr     NUMERIC(14,2),
    imei_number             VARCHAR(32),
    phone_number            VARCHAR(40),
    first_handover_person   VARCHAR(150),
    handed_over_on          DATE,
    asset_return_date       DATE,
    notes                   TEXT,
    created_by              BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by              BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, asset_tag)
);

CREATE TABLE IF NOT EXISTS pcs (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id         BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    department_id       BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    supplier_id         BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
    asset_tag           VARCHAR(64) NOT NULL,
    serial_number       VARCHAR(100),
    brand               VARCHAR(100),
    model               VARCHAR(150),
    status              asset_status NOT NULL DEFAULT 'available',
    pc_name             VARCHAR(100),
    cpu                 VARCHAR(150),
    ram_gb              NUMERIC(6,1),
    storage_gb          NUMERIC(10,1),
    storage_type        storage_type DEFAULT 'unknown',
    invoice_no          VARCHAR(80),
    purchase_amount_lkr NUMERIC(14,2),
    purchase_date       DATE,
    warranty_expires_on DATE,
    notes               TEXT,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, asset_tag)
);

CREATE TABLE IF NOT EXISTS printers (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id         BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    department_id       BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    supplier_id         BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
    asset_tag           VARCHAR(64) NOT NULL,
    serial_number       VARCHAR(100),
    brand               VARCHAR(100),
    model               VARCHAR(150),
    status              asset_status NOT NULL DEFAULT 'available',
    pc_name             VARCHAR(100),
    invoice_no          VARCHAR(80),
    purchase_amount_lkr NUMERIC(14,2),
    purchase_date       DATE,
    warranty_expires_on DATE,
    notes               TEXT,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, asset_tag)
);

CREATE TABLE IF NOT EXISTS other_assets (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id         BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    department_id       BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    supplier_id         BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
    asset_tag           VARCHAR(64) NOT NULL,
    serial_number       VARCHAR(100),
    brand               VARCHAR(100),
    model               VARCHAR(150),
    status              asset_status NOT NULL DEFAULT 'available',
    pc_name             VARCHAR(100),
    invoice_no          VARCHAR(80),
    purchase_amount_lkr NUMERIC(14,2),
    purchase_date       DATE,
    warranty_expires_on DATE,
    notes               TEXT,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, asset_tag)
);

CREATE INDEX IF NOT EXISTS idx_laptops_company ON laptops(company_id);
CREATE INDEX IF NOT EXISTS idx_mobile_phones_company ON mobile_phones(company_id);
CREATE INDEX IF NOT EXISTS idx_pcs_company ON pcs(company_id);
CREATE INDEX IF NOT EXISTS idx_printers_company ON printers(company_id);
CREATE INDEX IF NOT EXISTS idx_other_assets_company ON other_assets(company_id);

-- 2) Unified view for dashboard / handovers
CREATE OR REPLACE VIEW v_assets AS
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       purchase_date, warranty_expires_on, created_at, updated_at,
       'laptop'::text AS category
FROM laptops
UNION ALL
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       NULL::date, NULL::date, created_at, updated_at,
       'mobile_phone'::text AS category
FROM mobile_phones
UNION ALL
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       purchase_date, warranty_expires_on, created_at, updated_at,
       'pc'::text AS category
FROM pcs
UNION ALL
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       purchase_date, warranty_expires_on, created_at, updated_at,
       'printer'::text AS category
FROM printers
UNION ALL
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       purchase_date, warranty_expires_on, created_at, updated_at,
       'other'::text AS category
FROM other_assets;

-- 3) Migrate existing assets rows (if legacy table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'assets'
  ) THEN
    INSERT INTO laptops (
      id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
      brand, model, status, pc_name, cpu, ram_gb, storage_gb, storage_type,
      invoice_no, purchase_amount_lkr, purchase_date, warranty_expires_on, notes,
      created_by, updated_by, created_at, updated_at
    )
    SELECT id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
           brand, model, status, pc_name, cpu, ram_gb, storage_gb, COALESCE(storage_type, 'unknown'),
           invoice_no, purchase_amount_lkr, purchase_date, warranty_expires_on, notes,
           created_by, updated_by, created_at, updated_at
    FROM assets WHERE category = 'laptop'
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO mobile_phones (
      id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
      brand, model, status, pc_name, invoice_no, purchase_amount_lkr,
      imei_number, phone_number, first_handover_person, handed_over_on, asset_return_date, notes,
      created_by, updated_by, created_at, updated_at
    )
    SELECT id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
           brand, model, status, pc_name, invoice_no, purchase_amount_lkr,
           imei_number, phone_number, first_handover_person, handed_over_on, asset_return_date, notes,
           created_by, updated_by, created_at, updated_at
    FROM assets WHERE category = 'mobile_phone'
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO pcs (
      id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
      brand, model, status, pc_name, cpu, ram_gb, storage_gb, storage_type,
      invoice_no, purchase_amount_lkr, purchase_date, warranty_expires_on, notes,
      created_by, updated_by, created_at, updated_at
    )
    SELECT id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
           brand, model, status, pc_name, cpu, ram_gb, storage_gb, COALESCE(storage_type, 'unknown'),
           invoice_no, purchase_amount_lkr, purchase_date, warranty_expires_on, notes,
           created_by, updated_by, created_at, updated_at
    FROM assets WHERE category = 'pc'
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO printers (
      id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
      brand, model, status, pc_name, invoice_no, purchase_amount_lkr, purchase_date, warranty_expires_on, notes,
      created_by, updated_by, created_at, updated_at
    )
    SELECT id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
           brand, model, status, pc_name, invoice_no, purchase_amount_lkr, purchase_date, warranty_expires_on, notes,
           created_by, updated_by, created_at, updated_at
    FROM assets WHERE category = 'printer'
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO other_assets (
      id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
      brand, model, status, pc_name, invoice_no, purchase_amount_lkr, purchase_date, warranty_expires_on, notes,
      created_by, updated_by, created_at, updated_at
    )
    SELECT id, uuid, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
           brand, model, status, pc_name, invoice_no, purchase_amount_lkr, purchase_date, warranty_expires_on, notes,
           created_by, updated_by, created_at, updated_at
    FROM assets WHERE category = 'other'
    ON CONFLICT (id) DO NOTHING;

    -- Sync sequences
    PERFORM setval(pg_get_serial_sequence('laptops', 'id'), COALESCE((SELECT MAX(id) FROM laptops), 1), true);
    PERFORM setval(pg_get_serial_sequence('mobile_phones', 'id'), COALESCE((SELECT MAX(id) FROM mobile_phones), 1), true);
    PERFORM setval(pg_get_serial_sequence('pcs', 'id'), COALESCE((SELECT MAX(id) FROM pcs), 1), true);
    PERFORM setval(pg_get_serial_sequence('printers', 'id'), COALESCE((SELECT MAX(id) FROM printers), 1), true);
    PERFORM setval(pg_get_serial_sequence('other_assets', 'id'), COALESCE((SELECT MAX(id) FROM other_assets), 1), true);
  END IF;
END $$;

-- 4) Handovers: polymorphic asset_type + asset_id
ALTER TABLE asset_handovers
  ADD COLUMN IF NOT EXISTS asset_type VARCHAR(32);

UPDATE asset_handovers h
SET asset_type = a.category::text
FROM assets a
WHERE h.asset_id = a.id
  AND (h.asset_type IS NULL OR h.asset_type = '');

UPDATE asset_handovers SET asset_type = 'laptop' WHERE asset_type IS NULL;

ALTER TABLE asset_handovers
  ALTER COLUMN asset_type SET DEFAULT 'laptop';

ALTER TABLE asset_handovers
  ALTER COLUMN asset_type SET NOT NULL;

-- Drop FK to old assets table if present
DO $$
DECLARE fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'asset_handovers'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'asset_id'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE asset_handovers DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

DROP INDEX IF EXISTS uq_open_handover_per_asset;
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_handover_per_asset
  ON asset_handovers(asset_type, asset_id)
  WHERE is_open = TRUE;

-- Credentials: drop hard FK to assets if present
DO $$
DECLARE fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'credentials'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'asset_id'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE credentials DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE credentials ADD COLUMN IF NOT EXISTS asset_type VARCHAR(32);

-- Peripherals: keep but drop FK so deletes don't break during transition
DO $$
DECLARE fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'asset_peripherals'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'asset_id'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE asset_peripherals DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE asset_peripherals ADD COLUMN IF NOT EXISTS asset_type VARCHAR(32) DEFAULT 'laptop';

-- 5) Rebuild dashboard views on v_assets
DROP VIEW IF EXISTS v_open_handovers;
DROP VIEW IF EXISTS v_warranty_upcoming;
DROP VIEW IF EXISTS v_dashboard_assets_by_status;
DROP VIEW IF EXISTS v_dashboard_assets_by_company;

CREATE OR REPLACE VIEW v_dashboard_assets_by_company AS
SELECT
    c.id AS company_id,
    c.code,
    c.short_name,
    c.name AS company_name,
    COUNT(a.id) AS total_assets,
    COALESCE(SUM(a.purchase_amount_lkr), 0) AS total_value_lkr
FROM companies c
LEFT JOIN v_assets a ON a.company_id = c.id AND a.status <> 'disposed'
GROUP BY c.id, c.code, c.short_name, c.name;

CREATE OR REPLACE VIEW v_dashboard_assets_by_status AS
SELECT
    company_id,
    status,
    COUNT(*) AS asset_count
FROM v_assets
GROUP BY company_id, status;

CREATE OR REPLACE VIEW v_warranty_upcoming AS
SELECT
    a.id,
    a.company_id,
    a.asset_tag,
    a.pc_name,
    a.category,
    c.short_name AS company,
    a.warranty_expires_on,
    (a.warranty_expires_on - CURRENT_DATE) AS days_remaining
FROM v_assets a
JOIN companies c ON c.id = a.company_id
WHERE a.warranty_expires_on IS NOT NULL
  AND a.status <> 'disposed'
  AND a.warranty_expires_on BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '90 days');

CREATE OR REPLACE VIEW v_open_handovers AS
SELECT
    h.id,
    h.uuid,
    h.company_id,
    h.gate_pass_no,
    h.handover_date,
    h.asset_type,
    a.asset_tag,
    a.pc_name,
    a.category,
    COALESCE(NULLIF(h.assigned_person_name, ''), e.name) AS assigned_person_name,
    e.staff_id AS employee_staff_id,
    e.name AS employee_name,
    it.name AS it_staff_name
FROM asset_handovers h
JOIN v_assets a ON a.id = h.asset_id AND a.category = h.asset_type
LEFT JOIN users e ON e.id = h.assigned_employee_id
JOIN users it ON it.id = h.assigned_by_it_staff_id
WHERE h.is_open = TRUE;

-- 6) Rename legacy table (keep backup; app no longer uses it)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'assets'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'assets_legacy'
  ) THEN
    ALTER TABLE assets RENAME TO assets_legacy;
  END IF;
END $$;
