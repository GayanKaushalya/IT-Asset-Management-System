-- Inter-company transfer support for other assets (and printers)
ALTER TABLE other_assets
    ADD COLUMN IF NOT EXISTS former_asset_tag VARCHAR(64),
    ADD COLUMN IF NOT EXISTS transferred_from_company_id INTEGER REFERENCES companies (id),
    ADD COLUMN IF NOT EXISTS company_transferred_at TIMESTAMPTZ;

ALTER TABLE printers
    ADD COLUMN IF NOT EXISTS former_asset_tag VARCHAR(64),
    ADD COLUMN IF NOT EXISTS transferred_from_company_id INTEGER REFERENCES companies (id),
    ADD COLUMN IF NOT EXISTS company_transferred_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_other_assets_former_tag ON other_assets (former_asset_tag);
CREATE INDEX IF NOT EXISTS idx_other_assets_transferred_from ON other_assets (transferred_from_company_id);
CREATE INDEX IF NOT EXISTS idx_printers_former_tag ON printers (former_asset_tag);
CREATE INDEX IF NOT EXISTS idx_printers_transferred_from ON printers (transferred_from_company_id);
