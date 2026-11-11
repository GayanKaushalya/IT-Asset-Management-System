-- =============================================================================
-- Indra Group ITAM — Supabase (PostgreSQL) schema
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE asset_category AS ENUM ('pc','laptop','mobile_phone','printer','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE asset_status AS ENUM ('available','deployed','under_repair','disposed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE storage_type AS ENUM ('hdd','ssd','hybrid','emmc','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE handover_condition AS ENUM ('excellent','good','fair','damaged','missing_parts');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE credential_type AS ENUM ('email','erp','system_login','vpn','wifi','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('super_admin','it_admin','it_staff','viewer','employee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 1. Companies / Locations / Departments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
    
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(32) NOT NULL UNIQUE,
    name            VARCHAR(150) NOT NULL UNIQUE,
    short_name      VARCHAR(80) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS locations (
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code            VARCHAR(32) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    address_line    VARCHAR(255),
    city            VARCHAR(100),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS departments (
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id     BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    code            VARCHAR(32) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, code)
);

-- ---------------------------------------------------------------------------
-- 2. Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id         BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    department_id       BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    staff_id            VARCHAR(50) NOT NULL,
    name                VARCHAR(150) NOT NULL,
    email               VARCHAR(191) NOT NULL UNIQUE,
    phone               VARCHAR(30),
    password_hash       VARCHAR(255),
    role                user_role NOT NULL DEFAULT 'employee',
    can_decrypt_vault   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ---------------------------------------------------------------------------
-- 3. Suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT REFERENCES companies(id) ON DELETE SET NULL,
    name            VARCHAR(150) NOT NULL,
    contact_person  VARCHAR(150),
    phone           VARCHAR(30),
    email           VARCHAR(191),
    address         TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. Assets (5 category tables)
-- ---------------------------------------------------------------------------
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
    hdd_gb              NUMERIC(10,1),
    ssd_gb              NUMERIC(10,1),
    invoice_no          VARCHAR(80),
    purchase_amount_lkr NUMERIC(14,2),
    purchase_date       DATE,
    warranty_expires_on DATE,
    notes               TEXT,
    handover_person_1   VARCHAR(150),
    handover_person_2   VARCHAR(150),
    handover_person_3   VARCHAR(150),
    handover_person_4   VARCHAR(150),
    handover_on_1       DATE,
    handover_on_2       DATE,
    handover_on_3       DATE,
    handover_on_4       DATE,
    original_assigned_person VARCHAR(150),
    original_assigned_on     DATE,
    allocated_person         VARCHAR(150),
    allocated_on             DATE,
    has_mouse           BOOLEAN NOT NULL DEFAULT FALSE,
    is_legacy           BOOLEAN NOT NULL DEFAULT FALSE,
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
    imei_number_2           VARCHAR(32),
    phone_number            VARCHAR(40),
    condition_code          VARCHAR(80),
    accessories             TEXT,
    has_charger             BOOLEAN NOT NULL DEFAULT TRUE,
    has_data_cable          BOOLEAN NOT NULL DEFAULT TRUE,
    has_back_cover          BOOLEAN NOT NULL DEFAULT TRUE,
    purchase_date           DATE,
    first_handover_person   VARCHAR(150),
    handed_over_on          DATE,
    asset_return_date       DATE,
    handover_person_1       VARCHAR(150),
    handover_person_2       VARCHAR(150),
    handover_person_3       VARCHAR(150),
    handover_person_4       VARCHAR(150),
    handover_on_1           DATE,
    handover_on_2           DATE,
    handover_on_3           DATE,
    handover_on_4           DATE,
    original_assigned_person VARCHAR(150),
    original_assigned_on     DATE,
    allocated_person         VARCHAR(150),
    allocated_on             DATE,
    notes                   TEXT,
    is_legacy               BOOLEAN NOT NULL DEFAULT FALSE,
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
    hdd_gb              NUMERIC(10,1),
    ssd_gb              NUMERIC(10,1),
    windows_version     VARCHAR(80),
    invoice_no          VARCHAR(80),
    purchase_amount_lkr NUMERIC(14,2),
    purchase_date       DATE,
    warranty_period     VARCHAR(40),
    warranty_expires_on DATE,
    notes               TEXT,
    monitor_brand       VARCHAR(100),
    has_power_cable     BOOLEAN NOT NULL DEFAULT FALSE,
    has_vga_cable       BOOLEAN NOT NULL DEFAULT FALSE,
    has_keyboard        BOOLEAN NOT NULL DEFAULT FALSE,
    has_mouse           BOOLEAN NOT NULL DEFAULT FALSE,
    has_ups             BOOLEAN NOT NULL DEFAULT FALSE,
    ups_brand           VARCHAR(50),
    ups_model           VARCHAR(50),
    ups_purchase_date   DATE,
    ups_warranty_period VARCHAR(40),
    ups_warranty_expires_on DATE,
    handover_person_1   VARCHAR(150),
    handover_person_2   VARCHAR(150),
    handover_person_3   VARCHAR(150),
    handover_person_4   VARCHAR(150),
    handover_on_1       DATE,
    handover_on_2       DATE,
    handover_on_3       DATE,
    handover_on_4       DATE,
    original_assigned_person VARCHAR(150),
    original_assigned_on     DATE,
    allocated_person         VARCHAR(150),
    allocated_on             DATE,
    newly_purchased     BOOLEAN NOT NULL DEFAULT FALSE,
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
    user_name           VARCHAR(150),
    item_name           VARCHAR(150),
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

CREATE INDEX IF NOT EXISTS idx_laptops_company ON laptops(company_id);
CREATE INDEX IF NOT EXISTS idx_mobile_phones_company ON mobile_phones(company_id);
CREATE INDEX IF NOT EXISTS idx_pcs_company ON pcs(company_id);
CREATE INDEX IF NOT EXISTS idx_printers_company ON printers(company_id);
CREATE INDEX IF NOT EXISTS idx_other_assets_company ON other_assets(company_id);

-- Peripherals inventory (stock: keyboards, mice, cables, adapters)
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

-- ---------------------------------------------------------------------------
-- 5. Peripherals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS peripheral_types (
    id          SMALLSERIAL PRIMARY KEY,
    code        VARCHAR(40) NOT NULL UNIQUE,
    name        VARCHAR(80) NOT NULL,
    sort_order  SMALLINT NOT NULL DEFAULT 0
);

INSERT INTO peripheral_types (code, name, sort_order) VALUES
    ('monitor',        'Monitor',         10),
    ('ups',            'UPS',             20),
    ('ac_power_cable', 'AC Power Cable',  30),
    ('video_cable',    'Video Cable',     40),
    ('keyboard',       'Keyboard',        50),
    ('mouse',          'Mouse',           60),
    ('usb_hub',        'USB Hub',         70),
    ('pen_drive',      'Pen Drive',       80),
    ('external_hdd',   'External HDD',    90),
    ('laptop_backpack','Laptop Backpack', 100)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS asset_peripherals (
    id                  BIGSERIAL PRIMARY KEY,
    asset_type          VARCHAR(32) NOT NULL DEFAULT 'laptop',
    asset_id            BIGINT NOT NULL,
    peripheral_type_id  SMALLINT NOT NULL REFERENCES peripheral_types(id),
    quantity            SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    serial_or_note      VARCHAR(150),
    is_included         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (asset_type, asset_id, peripheral_type_id)
);

-- ---------------------------------------------------------------------------
-- 6. Handovers (polymorphic asset_type + asset_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_handovers (
    id                      BIGSERIAL PRIMARY KEY,
    uuid                    UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id              BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    asset_type              VARCHAR(32) NOT NULL DEFAULT 'laptop',
    asset_id                BIGINT NOT NULL,

    handover_date           DATE NOT NULL,
    assigned_employee_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assigned_person_name    VARCHAR(150),
    assigned_by_it_staff_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    checkout_condition      handover_condition NOT NULL DEFAULT 'good',
    checkout_remarks        TEXT,
    gate_pass_no            VARCHAR(50),

    return_date             DATE,
    return_received_by_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    return_condition        handover_condition,
    return_remarks          TEXT,

    is_open                 BOOLEAN NOT NULL DEFAULT TRUE,
    acceptance_form_printed_at TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_return_complete CHECK (
        (return_date IS NULL AND return_received_by_id IS NULL AND return_condition IS NULL)
        OR
        (return_date IS NOT NULL AND return_received_by_id IS NOT NULL AND return_condition IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_handovers_asset ON asset_handovers(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_handovers_employee ON asset_handovers(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_handovers_company ON asset_handovers(company_id);
CREATE INDEX IF NOT EXISTS idx_handovers_open ON asset_handovers(is_open) WHERE is_open = TRUE;
CREATE INDEX IF NOT EXISTS idx_handovers_acceptance_pending
    ON asset_handovers (company_id, id DESC)
    WHERE acceptance_form_printed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_handover_per_asset
    ON asset_handovers(asset_type, asset_id)
    WHERE is_open = TRUE;

CREATE TABLE IF NOT EXISTS handover_peripheral_checklist (
    id                  BIGSERIAL PRIMARY KEY,
    handover_id         BIGINT NOT NULL REFERENCES asset_handovers(id) ON DELETE CASCADE,
    peripheral_type_id  SMALLINT NOT NULL REFERENCES peripheral_types(id),
    checked_out         BOOLEAN NOT NULL DEFAULT FALSE,
    returned            BOOLEAN,
    remarks             VARCHAR(255),
    UNIQUE (handover_id, peripheral_type_id)
);

-- ---------------------------------------------------------------------------
-- 7. Credential vault
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credentials (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id         BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    assigned_user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    asset_type          VARCHAR(32),
    asset_id            BIGINT,

    credential_type     credential_type NOT NULL DEFAULT 'email',
    system_name         VARCHAR(150) NOT NULL,
    username            VARCHAR(191) NOT NULL,
    email_address       VARCHAR(191),

    password_ciphertext TEXT NOT NULL,
    encryption_version  SMALLINT NOT NULL DEFAULT 1,
    password_hint       VARCHAR(255),

    url                 VARCHAR(500),
    notes_ciphertext    TEXT,
    last_rotated_at     DATE,
    expires_at          DATE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,

    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credentials_company ON credentials(company_id);
CREATE INDEX IF NOT EXISTS idx_credentials_location ON credentials(location_id);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_credentials_type ON credentials(credential_type);

CREATE TABLE IF NOT EXISTS credential_access_logs (
    id              BIGSERIAL PRIMARY KEY,
    credential_id   BIGINT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
    accessed_by     BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action          VARCHAR(40) NOT NULL,
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cred_access_credential ON credential_access_logs(credential_id);
CREATE INDEX IF NOT EXISTS idx_cred_access_time ON credential_access_logs(created_at DESC);

-- ---------------------------------------------------------------------------
-- 7b. Company email accounts (shared mailbox, many users + locations)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 8. Seed companies / locations / departments
-- ---------------------------------------------------------------------------
INSERT INTO companies (code, name, short_name) VALUES
    ('IT',    'Indra Traders',       'ITL'),
    ('IMS',   'Indra Motor Spares',  'IMS'),
    ('ISP',   'Indra Service Park',  'ISP'),
    ('FOTON', 'Indra Foton',         'Foton'),
    ('OTHER', 'Other Emails',        'Others')
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations (company_id, code, name, city)
SELECT c.id, v.code, v.name, v.city
FROM companies c
CROSS JOIN (VALUES
    ('KANDY_HO', 'Kandy Head Office', 'Kandy'),
    ('CMB_BR',   'Colombo Branch',    'Colombo')
) AS v(code, name, city)
ON CONFLICT (company_id, code) DO NOTHING;

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
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO departments (company_id, location_id, code, name)
SELECT c.id, l.id, d.code, d.name
FROM companies c
JOIN locations l ON l.company_id = c.id AND l.code = 'KANDY_HO'
CROSS JOIN (VALUES
    ('ACCOUNTS', 'Accounts'),
    ('SALES', 'Sales')
) AS d(code, name)
WHERE c.code IN ('IMS', 'ISP')
ON CONFLICT (company_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Seed Central IT admin
-- ---------------------------------------------------------------------------
INSERT INTO users (
    company_id, location_id, department_id,
    staff_id, name, email, role, can_decrypt_vault, is_active
)
SELECT
    c.id, l.id, d.id,
    'IT-ADMIN-001',
    'Central IT Admin',
    'it.admin@indragroup.lk',
    'super_admin',
    TRUE,
    TRUE
FROM companies c
JOIN locations l ON l.company_id = c.id AND l.code = 'KANDY_HO'
JOIN departments d ON d.company_id = c.id AND d.code = 'IT'
WHERE c.code = 'IT'
  AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.email = 'it.admin@indragroup.lk'
  );

-- ---------------------------------------------------------------------------
-- 10. Dashboard views
-- ---------------------------------------------------------------------------
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

-- Verify
SELECT id, email, role FROM users;
SELECT code, name FROM companies;
SELECT category, COUNT(*) FROM v_assets GROUP BY category;
