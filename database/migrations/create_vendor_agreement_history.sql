-- Agreement renewals, updates, and change history
CREATE TABLE IF NOT EXISTS vendor_agreement_history (
    id              BIGSERIAL PRIMARY KEY,
    agreement_id    BIGINT NOT NULL REFERENCES vendor_agreements(id) ON DELETE CASCADE,
    event_type      VARCHAR(40) NOT NULL,
    title           VARCHAR(255) NOT NULL,
    detail          TEXT,
    changed_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vendor_agreement_history_type_chk CHECK (
        event_type IN (
            'created', 'updated', 'renewed', 'status_changed',
            'document_uploaded', 'removed', 'restored'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_agreement_history_agreement
    ON vendor_agreement_history(agreement_id, created_at DESC);
