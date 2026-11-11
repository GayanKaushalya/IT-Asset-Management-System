-- Track when IT Hardware Acceptance Form was printed (Handover Reports queue)
ALTER TABLE asset_handovers
    ADD COLUMN IF NOT EXISTS acceptance_form_printed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_handovers_acceptance_pending
    ON asset_handovers (company_id, id DESC)
    WHERE acceptance_form_printed_at IS NULL;
