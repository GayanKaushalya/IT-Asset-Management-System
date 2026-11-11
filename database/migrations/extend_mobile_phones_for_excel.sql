-- Extend mobile_phones to match Excel phone inventory fields
ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS imei_number_2 VARCHAR(32),
    ADD COLUMN IF NOT EXISTS condition_code VARCHAR(80),
    ADD COLUMN IF NOT EXISTS accessories TEXT,
    ADD COLUMN IF NOT EXISTS purchase_date DATE;

CREATE INDEX IF NOT EXISTS idx_mobile_phones_imei ON mobile_phones(imei_number);
CREATE INDEX IF NOT EXISTS idx_mobile_phones_serial ON mobile_phones(serial_number);
