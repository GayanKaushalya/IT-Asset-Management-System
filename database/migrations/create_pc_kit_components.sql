-- PC kit components: assignable parts (SSD, mouse, keyboard, UPS, …) with replace history
CREATE TABLE IF NOT EXISTS pc_kit_components (
    id                   BIGSERIAL PRIMARY KEY,
    pc_id                BIGINT NOT NULL REFERENCES pcs(id) ON DELETE CASCADE,
    component_kind       VARCHAR(40) NOT NULL,
    is_current           BOOLEAN NOT NULL DEFAULT TRUE,
    brand                VARCHAR(120),
    model                VARCHAR(120),
    serial_number        VARCHAR(120),
    capacity_gb          NUMERIC(10, 2),
    invoice_no           VARCHAR(120),
    purchase_date        DATE,
    purchase_amount_lkr  NUMERIC(14, 2),
    warranty_period      VARCHAR(80),
    warranty_expires_on  DATE,
    notes                TEXT,
    replace_reason       TEXT,
    disposition          VARCHAR(40),
    disposed_at          TIMESTAMPTZ,
    replaced_at          TIMESTAMPTZ,
    replaced_by          BIGINT,
    created_by           BIGINT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pc_kit_components_kind_chk CHECK (
        component_kind IN (
            'ssd', 'hdd', 'mouse', 'keyboard', 'ups', 'monitor',
            'power_cable', 'vga_cable'
        )
    ),
    CONSTRAINT pc_kit_components_disposition_chk CHECK (
        disposition IS NULL OR disposition IN ('replaced', 'removed', 'disposed')
    )
);

CREATE INDEX IF NOT EXISTS idx_pc_kit_pc ON pc_kit_components(pc_id);
CREATE INDEX IF NOT EXISTS idx_pc_kit_kind ON pc_kit_components(pc_id, component_kind);
CREATE INDEX IF NOT EXISTS idx_pc_kit_current ON pc_kit_components(pc_id, is_current)
    WHERE is_current = TRUE;

-- One current component per kind per PC
CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_kit_current_kind
    ON pc_kit_components(pc_id, component_kind)
    WHERE is_current = TRUE;
