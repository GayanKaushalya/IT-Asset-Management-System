-- WiFi (and other vault) credentials: optional branch / location + index
ALTER TABLE credentials
    ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_credentials_location ON credentials(location_id);
