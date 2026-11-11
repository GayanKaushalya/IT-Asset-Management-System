-- IT Expenditure Management (headers, line items, attachments, OS support rules)

CREATE TABLE IF NOT EXISTS it_expenditures (
    id                  BIGSERIAL PRIMARY KEY,
    reference_no        VARCHAR(40) NOT NULL UNIQUE,
    expense_date        DATE NOT NULL,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    location_id         BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    department_id       BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    supplier_id         BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_name       VARCHAR(200),
    invoice_no          VARCHAR(80),
    po_capex_ref        VARCHAR(100),
    expense_category    VARCHAR(80),
    payment_status      VARCHAR(30) NOT NULL DEFAULT 'pending',
    payment_date        DATE,
    amount_paid_lkr     NUMERIC(14,2) NOT NULL DEFAULT 0,
    approval_status     VARCHAR(30) NOT NULL DEFAULT 'pending',
    is_voided           BOOLEAN NOT NULL DEFAULT FALSE,
    void_reason         TEXT,
    remarks             TEXT,
    warranty_notes      TEXT,
    linked_asset_type   VARCHAR(40),
    linked_asset_id     BIGINT,
    subtotal_lkr        NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_total_lkr  NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_total_lkr       NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_lkr           NUMERIC(14,2) NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_itx_payment_status CHECK (
        payment_status IN ('pending', 'partially_paid', 'paid', 'overdue')
    ),
    CONSTRAINT chk_itx_approval_status CHECK (
        approval_status IN ('pending', 'approved', 'rejected')
    )
);

CREATE INDEX IF NOT EXISTS idx_itx_company_date ON it_expenditures (company_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_itx_payment ON it_expenditures (payment_status) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_itx_approval ON it_expenditures (approval_status) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_itx_active ON it_expenditures (is_active, expense_date DESC);

CREATE TABLE IF NOT EXISTS it_expenditure_lines (
    id                  BIGSERIAL PRIMARY KEY,
    expenditure_id      BIGINT NOT NULL REFERENCES it_expenditures(id) ON DELETE CASCADE,
    line_no             INT NOT NULL DEFAULT 1,
    item_name           VARCHAR(200) NOT NULL,
    description         TEXT,
    item_type           VARCHAR(60) NOT NULL DEFAULT 'other',
    brand               VARCHAR(100),
    model               VARCHAR(150),
    quantity            NUMERIC(12,3) NOT NULL DEFAULT 1,
    unit_price_lkr      NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_lkr        NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_lkr             NUMERIC(14,2) NOT NULL DEFAULT 0,
    line_total_lkr      NUMERIC(14,2) NOT NULL DEFAULT 0,
    counts_as_physical  BOOLEAN NOT NULL DEFAULT TRUE,
    warranty_info       VARCHAR(200),
    linked_asset_type   VARCHAR(40),
    linked_asset_id     BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (expenditure_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_itx_lines_exp ON it_expenditure_lines (expenditure_id);
CREATE INDEX IF NOT EXISTS idx_itx_lines_type ON it_expenditure_lines (item_type);
CREATE INDEX IF NOT EXISTS idx_itx_lines_item ON it_expenditure_lines (item_name);

CREATE TABLE IF NOT EXISTS it_expenditure_attachments (
    id                  BIGSERIAL PRIMARY KEY,
    expenditure_id      BIGINT NOT NULL REFERENCES it_expenditures(id) ON DELETE CASCADE,
    doc_type            VARCHAR(40) NOT NULL DEFAULT 'other',
    file_name           VARCHAR(255) NOT NULL,
    stored_path         TEXT NOT NULL,
    mime_type           VARCHAR(120),
    file_size           BIGINT,
    uploaded_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_itx_doc_type CHECK (
        doc_type IN ('invoice', 'quotation', 'receipt', 'other')
    )
);

CREATE INDEX IF NOT EXISTS idx_itx_attach_exp ON it_expenditure_attachments (expenditure_id);

-- Configurable OS / hardware lifecycle for Outdated PC report
CREATE TABLE IF NOT EXISTS it_os_support_rules (
    id                  BIGSERIAL PRIMARY KEY,
    os_family           VARCHAR(40) NOT NULL,
    edition_pattern     VARCHAR(120),
    version_label       VARCHAR(80) NOT NULL,
    match_keywords      TEXT NOT NULL,
    end_of_support_on   DATE,
    extended_support_on DATE,
    notes               TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS it_hardware_standards (
    id                  BIGSERIAL PRIMARY KEY,
    standard_key        VARCHAR(60) NOT NULL UNIQUE,
    min_ram_gb          NUMERIC(6,1),
    min_storage_gb      NUMERIC(10,1),
    max_age_years       NUMERIC(4,1),
    notes               TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO it_os_support_rules (os_family, edition_pattern, version_label, match_keywords, end_of_support_on, notes)
SELECT * FROM (VALUES
    ('windows', 'Home/Pro', 'Windows 10', 'windows 10', DATE '2025-10-14', 'Windows 10 Home & Pro standard EOS'),
    ('windows', 'Enterprise/Education', 'Windows 10 Enterprise/Education', 'windows 10 enterprise|windows 10 education', DATE '2025-10-14', 'May have ESU; flag as Needs Assessment if past EOS'),
    ('windows', NULL, 'Windows 8.1', 'windows 8.1|windows 8', DATE '2023-01-10', 'End of support'),
    ('windows', NULL, 'Windows 7', 'windows 7', DATE '2020-01-14', 'End of support'),
    ('windows', NULL, 'Windows 11', 'windows 11', NULL, 'Generally supported; verify specific release if needed')
) AS v(os_family, edition_pattern, version_label, match_keywords, end_of_support_on, notes)
WHERE NOT EXISTS (SELECT 1 FROM it_os_support_rules LIMIT 1);

INSERT INTO it_hardware_standards (standard_key, min_ram_gb, min_storage_gb, max_age_years, notes)
VALUES ('default_pc', 8, 128, 6, 'Central IT minimum PC standards')
ON CONFLICT (standard_key) DO NOTHING;
