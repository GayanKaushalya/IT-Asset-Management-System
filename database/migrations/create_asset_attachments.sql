-- Asset file attachments (invoices, photos, docs) for all asset categories
CREATE TABLE IF NOT EXISTS asset_attachments (
    id                  BIGSERIAL PRIMARY KEY,
    asset_type          VARCHAR(32) NOT NULL,
    asset_id            BIGINT NOT NULL,
    file_name           VARCHAR(255) NOT NULL,
    stored_path         TEXT NOT NULL,
    mime_type           VARCHAR(120),
    file_size           BIGINT,
    uploaded_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_attachments_asset
    ON asset_attachments (asset_type, asset_id);
