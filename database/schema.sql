-- =============================================================================
-- Indra Group ITAM & Credential Management System
-- MySQL 8.0+ Schema
-- Multi-company segregation: Indra Traders | Indra Motor Spares | Indra Service Park
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- 1. Multi-Company & Location
-- ---------------------------------------------------------------------------
CREATE TABLE companies (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(32) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    short_name      VARCHAR(80) NOT NULL,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_companies_code (code),
    UNIQUE KEY uq_companies_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE locations (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      BIGINT UNSIGNED NOT NULL,
    code            VARCHAR(32) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    address_line    VARCHAR(255) NULL,
    city            VARCHAR(100) NULL,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_locations_company_code (company_id, code),
    CONSTRAINT fk_locations_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE departments (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      BIGINT UNSIGNED NOT NULL,
    location_id     BIGINT UNSIGNED NULL,
    code            VARCHAR(32) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_departments_company_code (company_id, code),
    CONSTRAINT fk_departments_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
    CONSTRAINT fk_departments_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Users / Employees
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid                CHAR(36) NOT NULL DEFAULT (UUID()),
    company_id          BIGINT UNSIGNED NOT NULL,
    location_id         BIGINT UNSIGNED NULL,
    department_id       BIGINT UNSIGNED NULL,
    staff_id            VARCHAR(50) NOT NULL,
    name                VARCHAR(150) NOT NULL,
    email               VARCHAR(191) NOT NULL,
    phone               VARCHAR(30) NULL,
    password_hash       VARCHAR(255) NULL,
    role                ENUM('super_admin','it_admin','it_staff','viewer','employee') NOT NULL DEFAULT 'employee',
    can_decrypt_vault   TINYINT(1) NOT NULL DEFAULT 0,
    is_active           TINYINT(1) NOT NULL DEFAULT 1,
    last_login_at       DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_uuid (uuid),
    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_company_staff (company_id, staff_id),
    KEY idx_users_company (company_id),
    KEY idx_users_department (department_id),
    KEY idx_users_role (role),
    CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
    CONSTRAINT fk_users_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
    CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id      BIGINT UNSIGNED NULL,
    name            VARCHAR(150) NOT NULL,
    contact_person  VARCHAR(150) NULL,
    phone           VARCHAR(30) NULL,
    email           VARCHAR(191) NULL,
    address         TEXT NULL,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_suppliers_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. IT Assets (5 category tables)
-- ---------------------------------------------------------------------------
CREATE TABLE laptops (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid                CHAR(36) NOT NULL DEFAULT (UUID()),
    company_id          BIGINT UNSIGNED NOT NULL,
    location_id         BIGINT UNSIGNED NULL,
    department_id       BIGINT UNSIGNED NULL,
    supplier_id         BIGINT UNSIGNED NULL,
    asset_tag           VARCHAR(64) NOT NULL,
    serial_number       VARCHAR(100) NULL,
    brand               VARCHAR(100) NULL,
    model               VARCHAR(150) NULL,
    status              ENUM('available','deployed','under_repair','disposed') NOT NULL DEFAULT 'available',
    pc_name             VARCHAR(100) NULL,
    cpu                 VARCHAR(150) NULL,
    ram_gb              DECIMAL(6,1) NULL,
    storage_gb          DECIMAL(10,1) NULL,
    storage_type        ENUM('hdd','ssd','hybrid','emmc','unknown') DEFAULT 'unknown',
    invoice_no          VARCHAR(80) NULL,
    purchase_amount_lkr DECIMAL(14,2) NULL,
    purchase_date       DATE NULL,
    warranty_expires_on DATE NULL,
    notes               TEXT NULL,
    handover_person_1   VARCHAR(150) NULL,
    handover_person_2   VARCHAR(150) NULL,
    handover_person_3   VARCHAR(150) NULL,
    handover_person_4   VARCHAR(150) NULL,
    handover_on_1       DATE NULL,
    handover_on_2       DATE NULL,
    handover_on_3       DATE NULL,
    handover_on_4       DATE NULL,
    original_assigned_person VARCHAR(150) NULL,
    original_assigned_on     DATE NULL,
    allocated_person         VARCHAR(150) NULL,
    allocated_on             DATE NULL,
    created_by          BIGINT UNSIGNED NULL,
    updated_by          BIGINT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_laptops_tag (company_id, asset_tag),
    KEY idx_laptops_company (company_id),
    CONSTRAINT fk_laptops_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mobile_phones (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid                    CHAR(36) NOT NULL DEFAULT (UUID()),
    company_id              BIGINT UNSIGNED NOT NULL,
    location_id             BIGINT UNSIGNED NULL,
    department_id           BIGINT UNSIGNED NULL,
    supplier_id             BIGINT UNSIGNED NULL,
    asset_tag               VARCHAR(64) NOT NULL,
    serial_number           VARCHAR(100) NULL,
    brand                   VARCHAR(100) NULL,
    model                   VARCHAR(150) NULL,
    status                  ENUM('available','deployed','under_repair','disposed') NOT NULL DEFAULT 'available',
    pc_name                 VARCHAR(100) NULL,
    invoice_no              VARCHAR(80) NULL,
    purchase_amount_lkr     DECIMAL(14,2) NULL,
    imei_number             VARCHAR(32) NULL,
    phone_number            VARCHAR(40) NULL,
    first_handover_person   VARCHAR(150) NULL,
    handed_over_on          DATE NULL,
    asset_return_date       DATE NULL,
    handover_person_1       VARCHAR(150) NULL,
    handover_person_2       VARCHAR(150) NULL,
    handover_person_3       VARCHAR(150) NULL,
    handover_person_4       VARCHAR(150) NULL,
    handover_on_1           DATE NULL,
    handover_on_2           DATE NULL,
    handover_on_3           DATE NULL,
    handover_on_4           DATE NULL,
    original_assigned_person VARCHAR(150) NULL,
    original_assigned_on     DATE NULL,
    allocated_person         VARCHAR(150) NULL,
    allocated_on             DATE NULL,
    notes                   TEXT NULL,
    created_by              BIGINT UNSIGNED NULL,
    updated_by              BIGINT UNSIGNED NULL,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_mobile_phones_tag (company_id, asset_tag),
    KEY idx_mobile_phones_company (company_id),
    CONSTRAINT fk_mobile_phones_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pcs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid                CHAR(36) NOT NULL DEFAULT (UUID()),
    company_id          BIGINT UNSIGNED NOT NULL,
    location_id         BIGINT UNSIGNED NULL,
    department_id       BIGINT UNSIGNED NULL,
    supplier_id         BIGINT UNSIGNED NULL,
    asset_tag           VARCHAR(64) NOT NULL,
    serial_number       VARCHAR(100) NULL,
    brand               VARCHAR(100) NULL,
    model               VARCHAR(150) NULL,
    status              ENUM('available','deployed','under_repair','disposed') NOT NULL DEFAULT 'available',
    pc_name             VARCHAR(100) NULL,
    cpu                 VARCHAR(150) NULL,
    ram_gb              DECIMAL(6,1) NULL,
    storage_gb          DECIMAL(10,1) NULL,
    storage_type        ENUM('hdd','ssd','hybrid','emmc','unknown') DEFAULT 'unknown',
    invoice_no          VARCHAR(80) NULL,
    purchase_amount_lkr DECIMAL(14,2) NULL,
    purchase_date       DATE NULL,
    warranty_expires_on DATE NULL,
    notes               TEXT NULL,
    created_by          BIGINT UNSIGNED NULL,
    updated_by          BIGINT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pcs_tag (company_id, asset_tag),
    KEY idx_pcs_company (company_id),
    CONSTRAINT fk_pcs_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE printers (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid                CHAR(36) NOT NULL DEFAULT (UUID()),
    company_id          BIGINT UNSIGNED NOT NULL,
    location_id         BIGINT UNSIGNED NULL,
    department_id       BIGINT UNSIGNED NULL,
    supplier_id         BIGINT UNSIGNED NULL,
    asset_tag           VARCHAR(64) NOT NULL,
    serial_number       VARCHAR(100) NULL,
    brand               VARCHAR(100) NULL,
    model               VARCHAR(150) NULL,
    status              ENUM('available','deployed','under_repair','disposed') NOT NULL DEFAULT 'available',
    pc_name             VARCHAR(100) NULL,
    invoice_no          VARCHAR(80) NULL,
    purchase_amount_lkr DECIMAL(14,2) NULL,
    purchase_date       DATE NULL,
    warranty_expires_on DATE NULL,
    notes               TEXT NULL,
    created_by          BIGINT UNSIGNED NULL,
    updated_by          BIGINT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_printers_tag (company_id, asset_tag),
    KEY idx_printers_company (company_id),
    CONSTRAINT fk_printers_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE other_assets (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid                CHAR(36) NOT NULL DEFAULT (UUID()),
    company_id          BIGINT UNSIGNED NOT NULL,
    location_id         BIGINT UNSIGNED NULL,
    department_id       BIGINT UNSIGNED NULL,
    supplier_id         BIGINT UNSIGNED NULL,
    asset_tag           VARCHAR(64) NOT NULL,
    serial_number       VARCHAR(100) NULL,
    brand               VARCHAR(100) NULL,
    model               VARCHAR(150) NULL,
    status              ENUM('available','deployed','under_repair','disposed') NOT NULL DEFAULT 'available',
    pc_name             VARCHAR(100) NULL,
    invoice_no          VARCHAR(80) NULL,
    purchase_amount_lkr DECIMAL(14,2) NULL,
    purchase_date       DATE NULL,
    warranty_expires_on DATE NULL,
    notes               TEXT NULL,
    created_by          BIGINT UNSIGNED NULL,
    updated_by          BIGINT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_other_assets_tag (company_id, asset_tag),
    KEY idx_other_assets_company (company_id),
    CONSTRAINT fk_other_assets_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_assets AS
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       purchase_date, warranty_expires_on, created_at, updated_at,
       'laptop' AS category
FROM laptops
UNION ALL
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       NULL, NULL, created_at, updated_at,
       'mobile_phone' AS category
FROM mobile_phones
UNION ALL
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       purchase_date, warranty_expires_on, created_at, updated_at,
       'pc' AS category
FROM pcs
UNION ALL
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       purchase_date, warranty_expires_on, created_at, updated_at,
       'printer' AS category
FROM printers
UNION ALL
SELECT id, company_id, location_id, department_id, supplier_id, asset_tag, serial_number,
       brand, model, status, pc_name, invoice_no, purchase_amount_lkr, notes,
       purchase_date, warranty_expires_on, created_at, updated_at,
       'other' AS category
FROM other_assets;

-- ---------------------------------------------------------------------------
-- 5. Peripheral checklist
-- ---------------------------------------------------------------------------
CREATE TABLE peripheral_types (
    id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(40) NOT NULL,
    name        VARCHAR(80) NOT NULL,
    sort_order  SMALLINT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_peripheral_types_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    ('laptop_backpack','Laptop Backpack', 100);

CREATE TABLE asset_peripherals (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    asset_type          VARCHAR(32) NOT NULL DEFAULT 'laptop',
    asset_id            BIGINT UNSIGNED NOT NULL,
    peripheral_type_id  SMALLINT UNSIGNED NOT NULL,
    quantity            SMALLINT NOT NULL DEFAULT 1,
    serial_or_note      VARCHAR(150) NULL,
    is_included         TINYINT(1) NOT NULL DEFAULT 1,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_asset_peripheral (asset_type, asset_id, peripheral_type_id),
    CONSTRAINT chk_asset_peripheral_qty CHECK (quantity > 0),
    CONSTRAINT fk_asset_peripherals_type FOREIGN KEY (peripheral_type_id) REFERENCES peripheral_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6. Asset Handover / Check-out & Return
-- ---------------------------------------------------------------------------
CREATE TABLE asset_handovers (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid                    CHAR(36) NOT NULL DEFAULT (UUID()),
    company_id              BIGINT UNSIGNED NOT NULL,
    asset_type              VARCHAR(32) NOT NULL DEFAULT 'laptop',
    asset_id                BIGINT UNSIGNED NOT NULL,

    handover_date           DATE NOT NULL,
    assigned_employee_id    BIGINT UNSIGNED NULL,
    assigned_person_name    VARCHAR(150) NULL,
    assigned_by_it_staff_id BIGINT UNSIGNED NOT NULL,
    checkout_condition      ENUM('excellent','good','fair','damaged','missing_parts') NOT NULL DEFAULT 'good',
    checkout_remarks        TEXT NULL,
    gate_pass_no            VARCHAR(50) NULL,

    return_date             DATE NULL,
    return_received_by_id   BIGINT UNSIGNED NULL,
    return_condition        ENUM('excellent','good','fair','damaged','missing_parts') NULL,
    return_remarks          TEXT NULL,

    is_open                 TINYINT(1) NOT NULL DEFAULT 1,
    open_asset_key          VARCHAR(80)
        GENERATED ALWAYS AS (CASE WHEN is_open = 1 THEN CONCAT(asset_type, ':', asset_id) ELSE NULL END) STORED,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_handovers_uuid (uuid),
    UNIQUE KEY uq_open_handover_per_asset (open_asset_key),
    KEY idx_handovers_asset (asset_type, asset_id),
    KEY idx_handovers_employee (assigned_employee_id),
    KEY idx_handovers_open (is_open),
    KEY idx_handovers_company (company_id),
    CONSTRAINT fk_handovers_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
    CONSTRAINT fk_handovers_employee FOREIGN KEY (assigned_employee_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_handovers_it_staff FOREIGN KEY (assigned_by_it_staff_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_handovers_return_by FOREIGN KEY (return_received_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_return_complete CHECK (
        (return_date IS NULL AND return_received_by_id IS NULL AND return_condition IS NULL)
        OR
        (return_date IS NOT NULL AND return_received_by_id IS NOT NULL AND return_condition IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE handover_peripheral_checklist (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    handover_id         BIGINT UNSIGNED NOT NULL,
    peripheral_type_id  SMALLINT UNSIGNED NOT NULL,
    checked_out         TINYINT(1) NOT NULL DEFAULT 0,
    returned            TINYINT(1) NULL,
    remarks             VARCHAR(255) NULL,
    UNIQUE KEY uq_handover_peripheral (handover_id, peripheral_type_id),
    CONSTRAINT fk_hpc_handover FOREIGN KEY (handover_id) REFERENCES asset_handovers(id) ON DELETE CASCADE,
    CONSTRAINT fk_hpc_type FOREIGN KEY (peripheral_type_id) REFERENCES peripheral_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 7. Credential & Email Vault
-- ---------------------------------------------------------------------------
CREATE TABLE credentials (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid                CHAR(36) NOT NULL DEFAULT (UUID()),
    company_id          BIGINT UNSIGNED NOT NULL,
    location_id         BIGINT UNSIGNED NULL,
    assigned_user_id    BIGINT UNSIGNED NULL,
    asset_type          VARCHAR(32) NULL,
    asset_id            BIGINT UNSIGNED NULL,

    credential_type     ENUM('email','erp','system_login','vpn','wifi','other') NOT NULL DEFAULT 'email',
    system_name         VARCHAR(150) NOT NULL,
    username            VARCHAR(191) NOT NULL,
    email_address       VARCHAR(191) NULL,

    password_ciphertext TEXT NOT NULL,
    encryption_version  SMALLINT NOT NULL DEFAULT 1,
    password_hint       VARCHAR(255) NULL,

    url                 VARCHAR(500) NULL,
    notes_ciphertext    TEXT NULL,
    last_rotated_at     DATE NULL,
    expires_at          DATE NULL,
    is_active           TINYINT(1) NOT NULL DEFAULT 1,

    created_by          BIGINT UNSIGNED NULL,
    updated_by          BIGINT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_credentials_uuid (uuid),
    KEY idx_credentials_company (company_id),
    KEY idx_credentials_location (location_id),
    KEY idx_credentials_user (assigned_user_id),
    KEY idx_credentials_type (credential_type),
    CONSTRAINT fk_credentials_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
    CONSTRAINT fk_credentials_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
    CONSTRAINT fk_credentials_user FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_credentials_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_credentials_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE credential_access_logs (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    credential_id   BIGINT UNSIGNED NOT NULL,
    accessed_by     BIGINT UNSIGNED NOT NULL,
    action          VARCHAR(40) NOT NULL,
    ip_address      VARCHAR(45) NULL,
    user_agent      VARCHAR(255) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_cred_access_credential (credential_id),
    KEY idx_cred_access_time (created_at),
    CONSTRAINT fk_cred_logs_credential FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
    CONSTRAINT fk_cred_logs_user FOREIGN KEY (accessed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_accounts (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid                CHAR(36) NOT NULL DEFAULT (UUID()),
    company_id          BIGINT UNSIGNED NOT NULL,
    email_address       VARCHAR(191) NOT NULL,
    password_ciphertext TEXT NOT NULL,
    encryption_version  SMALLINT NOT NULL DEFAULT 1,
    is_active           TINYINT(1) NOT NULL DEFAULT 1,
    created_by          BIGINT UNSIGNED NULL,
    updated_by          BIGINT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_email_accounts_uuid (uuid),
    UNIQUE KEY uq_email_accounts_company_email (company_id, email_address),
    KEY idx_email_accounts_company (company_id),
    CONSTRAINT fk_email_accounts_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
    CONSTRAINT fk_email_accounts_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_email_accounts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_account_users (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email_account_id    BIGINT UNSIGNED NOT NULL,
    user_name           VARCHAR(150) NOT NULL,
    location_id         BIGINT UNSIGNED NOT NULL,
    is_active           TINYINT(1) NOT NULL DEFAULT 1,
    created_by          BIGINT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_email_account_users_account (email_account_id),
    KEY idx_email_account_users_location (location_id),
    CONSTRAINT fk_email_users_account FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_email_users_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_email_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- 8. Seed: Indra Group sub-companies & sample locations
-- ---------------------------------------------------------------------------
INSERT INTO companies (code, name, short_name) VALUES
    ('IT',    'Indra Traders',       'ITL'),
    ('IMS',   'Indra Motor Spares',  'IMS'),
    ('ISP',   'Indra Service Park',  'ISP'),
    ('FOTON', 'Indra Foton',         'Foton');

INSERT INTO locations (company_id, code, name, city)
SELECT c.id, v.code, v.name, v.city
FROM companies c
CROSS JOIN (
    SELECT 'KANDY_HO' AS code, 'Kandy Head Office' AS name, 'Kandy' AS city
    UNION ALL
    SELECT 'CMB_BR', 'Colombo Branch', 'Colombo'
) AS v;

INSERT INTO departments (company_id, location_id, code, name)
SELECT c.id, l.id, d.code, d.name
FROM companies c
JOIN locations l ON l.company_id = c.id AND l.code = 'KANDY_HO'
CROSS JOIN (
    SELECT 'ACCOUNTS' AS code, 'Accounts Dept' AS name
    UNION ALL SELECT 'SALES', 'Sales'
    UNION ALL SELECT 'IT', 'Central IT'
    UNION ALL SELECT 'OPS', 'Operations'
) AS d;

-- ---------------------------------------------------------------------------
-- 9. Dashboard / report views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_dashboard_assets_by_company AS
SELECT
    c.id AS company_id,
    c.short_name,
    c.name AS company_name,
    COUNT(a.id) AS total_assets,
    COALESCE(SUM(a.purchase_amount_lkr), 0) AS total_value_lkr
FROM companies c
LEFT JOIN v_assets a ON a.company_id = c.id AND a.status <> 'disposed'
GROUP BY c.id, c.short_name, c.name;

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
    c.short_name AS company,
    a.asset_tag,
    a.pc_name,
    a.category,
    a.warranty_expires_on,
    DATEDIFF(a.warranty_expires_on, CURDATE()) AS days_remaining
FROM v_assets a
JOIN companies c ON c.id = a.company_id
WHERE a.warranty_expires_on IS NOT NULL
  AND a.status <> 'disposed'
  AND a.warranty_expires_on BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY);

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
WHERE h.is_open = 1;
