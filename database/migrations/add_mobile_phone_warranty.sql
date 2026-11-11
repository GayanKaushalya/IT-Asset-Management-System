-- Mobile phone warranty (1 year from originally assigned handover date)
ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS warranty_expires_on DATE;

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS warranty_period VARCHAR(100);

COMMENT ON COLUMN mobile_phones.warranty_expires_on IS
    'Warranty void date = originally assigned handover date + 1 year';
