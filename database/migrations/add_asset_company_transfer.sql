-- Track inter-company asset transfers (ITL ↔ IMS ↔ ISP) with retag history
ALTER TABLE laptops
    ADD COLUMN IF NOT EXISTS former_asset_tag VARCHAR(64),
    ADD COLUMN IF NOT EXISTS transferred_from_company_id INTEGER REFERENCES companies (id),
    ADD COLUMN IF NOT EXISTS company_transferred_at TIMESTAMPTZ;

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS former_asset_tag VARCHAR(64),
    ADD COLUMN IF NOT EXISTS transferred_from_company_id INTEGER REFERENCES companies (id),
    ADD COLUMN IF NOT EXISTS company_transferred_at TIMESTAMPTZ;

ALTER TABLE pcs
    ADD COLUMN IF NOT EXISTS former_asset_tag VARCHAR(64),
    ADD COLUMN IF NOT EXISTS transferred_from_company_id INTEGER REFERENCES companies (id),
    ADD COLUMN IF NOT EXISTS company_transferred_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS asset_company_transfers (
    id              BIGSERIAL PRIMARY KEY,
    asset_type      VARCHAR(32) NOT NULL,
    asset_id        INTEGER NOT NULL,
    from_company_id INTEGER NOT NULL REFERENCES companies (id),
    to_company_id   INTEGER NOT NULL REFERENCES companies (id),
    from_location_id INTEGER REFERENCES locations (id),
    to_location_id   INTEGER REFERENCES locations (id),
    from_asset_tag  VARCHAR(64) NOT NULL,
    to_asset_tag    VARCHAR(64) NOT NULL,
    note            TEXT,
    transferred_by  INTEGER REFERENCES users (id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_company_transfers_asset
    ON asset_company_transfers (asset_type, asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_laptops_former_tag ON laptops (former_asset_tag);
CREATE INDEX IF NOT EXISTS idx_mobile_phones_former_tag ON mobile_phones (former_asset_tag);
CREATE INDEX IF NOT EXISTS idx_pcs_former_tag ON pcs (former_asset_tag);
CREATE INDEX IF NOT EXISTS idx_laptops_transferred_from ON laptops (transferred_from_company_id);
CREATE INDEX IF NOT EXISTS idx_mobile_phones_transferred_from ON mobile_phones (transferred_from_company_id);
CREATE INDEX IF NOT EXISTS idx_pcs_transferred_from ON pcs (transferred_from_company_id);
