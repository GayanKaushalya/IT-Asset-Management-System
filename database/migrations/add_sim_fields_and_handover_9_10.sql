-- SIM inventory: flag SIMs under ITL/IMS/ISP + extend mobile handover chain to 10

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS is_sim BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS handover_person_9 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_10 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_on_9 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_10 DATE;

CREATE INDEX IF NOT EXISTS idx_mobile_phones_is_sim ON mobile_phones (is_sim)
    WHERE is_sim = TRUE;

-- Backfill: anything under the SIM company, or explicitly modeled as a SIM
UPDATE mobile_phones m
SET is_sim = TRUE
FROM companies c
WHERE c.id = m.company_id
  AND (
      c.code = 'SIM'
      OR UPPER(TRIM(COALESCE(m.model, ''))) = 'SIM'
      OR UPPER(TRIM(COALESCE(m.accessories, ''))) LIKE '%SIM CARD%'
  );
