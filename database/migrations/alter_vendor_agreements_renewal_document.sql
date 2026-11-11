-- Auto-renew flag and signed contract document metadata
ALTER TABLE vendor_agreements
    ADD COLUMN IF NOT EXISTS auto_renewing BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE vendor_agreements
    ADD COLUMN IF NOT EXISTS document_path VARCHAR(500);

ALTER TABLE vendor_agreements
    ADD COLUMN IF NOT EXISTS document_name VARCHAR(255);
