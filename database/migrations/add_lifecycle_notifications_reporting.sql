-- Lifecycle statuses, status history, in-app notifications
-- Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'asset_status' AND e.enumlabel = 'lost'
  ) THEN
    ALTER TYPE asset_status ADD VALUE 'lost';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS asset_status_history (
    id              BIGSERIAL PRIMARY KEY,
    asset_type      TEXT NOT NULL,
    asset_id        BIGINT NOT NULL,
    company_id      INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    note            TEXT,
    changed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_status_history_asset
    ON asset_status_history (asset_type, asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
    id              BIGSERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT,
    link            TEXT,
    asset_type      TEXT,
    asset_id        BIGINT,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id, is_read, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_company
    ON notifications (company_id, is_read, created_at DESC);

-- Broader warranty window for reporting (expired + upcoming 90d)
CREATE OR REPLACE VIEW v_warranty_alerts AS
SELECT
    a.id,
    a.company_id,
    a.asset_tag,
    a.pc_name,
    a.category,
    a.status,
    c.short_name AS company,
    c.code AS company_code,
    a.warranty_expires_on,
    (a.warranty_expires_on - CURRENT_DATE) AS days_remaining
FROM v_assets a
JOIN companies c ON c.id = a.company_id
WHERE a.warranty_expires_on IS NOT NULL
  AND a.status::text NOT IN ('disposed', 'lost')
  AND a.warranty_expires_on <= (CURRENT_DATE + INTERVAL '90 days');

-- Note: apply via backend/scripts/apply_lifecycle_migration.php
-- (enum ADD VALUE must commit before the view can reference 'lost').
