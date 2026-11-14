-- Handover Reports visibility for available other assets (same as laptops / phones).
ALTER TABLE other_assets
    ADD COLUMN IF NOT EXISTS handover_report_hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_other_assets_handover_report_queue
    ON other_assets (company_id, id)
    WHERE status = 'available' AND handover_report_hidden_at IS NULL;
