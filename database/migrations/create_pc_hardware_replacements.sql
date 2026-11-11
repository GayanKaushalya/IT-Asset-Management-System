-- Full PC chassis / hardware replacements (same asset tag, new machine).
-- Old specs are snapshotted so Lifecycle can show Was → Now.

CREATE TABLE IF NOT EXISTS pc_hardware_replacements (
    id              BIGSERIAL PRIMARY KEY,
    pc_id           BIGINT NOT NULL REFERENCES pcs(id) ON DELETE CASCADE,
    company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    old_specs       JSONB NOT NULL DEFAULT '{}'::jsonb,
    new_specs       JSONB NOT NULL DEFAULT '{}'::jsonb,
    replace_reason  TEXT,
    notes           TEXT,
    replaced_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    replaced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pc_hw_repl_pc
    ON pc_hardware_replacements (pc_id, replaced_at DESC);

CREATE INDEX IF NOT EXISTS idx_pc_hw_repl_company
    ON pc_hardware_replacements (company_id, replaced_at DESC);
