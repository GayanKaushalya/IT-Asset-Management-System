-- Vendor / partner agreements (software, hardware, networking)
CREATE TABLE IF NOT EXISTS vendor_agreements (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          BIGINT REFERENCES companies(id) ON DELETE RESTRICT,
    agreement_type      VARCHAR(40) NOT NULL,
    vendor_name         VARCHAR(200) NOT NULL,
    title               VARCHAR(255) NOT NULL,
    contract_ref        VARCHAR(120),
    start_date          DATE,
    end_date            DATE,
    renewal_date        DATE,
    auto_renewing       BOOLEAN NOT NULL DEFAULT FALSE,
    status              VARCHAR(40) NOT NULL DEFAULT 'active',
    value_amount        NUMERIC(14, 2),
    currency            VARCHAR(10) NOT NULL DEFAULT 'LKR',
    contact_person      VARCHAR(200),
    contact_phone       VARCHAR(60),
    contact_email       VARCHAR(200),
    terms               TEXT,
    notes               TEXT,
    document_path       VARCHAR(500),
    document_name       VARCHAR(255),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          BIGINT,
    updated_by          BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vendor_agreements_type_chk CHECK (
        agreement_type IN ('software', 'hardware', 'networking')
    ),
    CONSTRAINT vendor_agreements_status_chk CHECK (
        status IN ('active', 'expiring', 'expired', 'cancelled', 'draft')
    )
);

CREATE INDEX IF NOT EXISTS idx_vendor_agreements_company ON vendor_agreements(company_id);
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_type ON vendor_agreements(agreement_type);
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_status ON vendor_agreements(status);
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_vendor ON vendor_agreements(vendor_name);
CREATE INDEX IF NOT EXISTS idx_vendor_agreements_end ON vendor_agreements(end_date);
