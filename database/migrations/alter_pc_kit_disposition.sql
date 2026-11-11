-- Track how a kit component left the PC (replaced / removed / disposed)
ALTER TABLE pc_kit_components
    ADD COLUMN IF NOT EXISTS disposition VARCHAR(40);

ALTER TABLE pc_kit_components
    ADD COLUMN IF NOT EXISTS disposed_at TIMESTAMPTZ;

UPDATE pc_kit_components
SET disposition = CASE
    WHEN is_current = TRUE THEN NULL
    WHEN replace_reason ILIKE '%dispos%' OR replace_reason ILIKE '%scrap%' THEN 'disposed'
    WHEN replace_reason ILIKE '%remov%' THEN 'removed'
    ELSE 'replaced'
END
WHERE is_current = FALSE AND disposition IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pc_kit_components_disposition_chk'
    ) THEN
        ALTER TABLE pc_kit_components
            ADD CONSTRAINT pc_kit_components_disposition_chk
            CHECK (disposition IS NULL OR disposition IN ('replaced', 'removed', 'disposed'));
    END IF;
END $$;
