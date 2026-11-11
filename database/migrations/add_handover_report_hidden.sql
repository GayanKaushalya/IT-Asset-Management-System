-- Persist Handover Reports visibility for available laptops / mobile phones.
-- NULL = show on Handover Reports; set = removed after print or manual clear.
ALTER TABLE laptops
    ADD COLUMN IF NOT EXISTS handover_report_hidden_at TIMESTAMPTZ;

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS handover_report_hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_laptops_handover_report_queue
    ON laptops (company_id, id)
    WHERE status = 'available' AND handover_report_hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_phones_handover_report_queue
    ON mobile_phones (company_id, id)
    WHERE status = 'available' AND handover_report_hidden_at IS NULL;
