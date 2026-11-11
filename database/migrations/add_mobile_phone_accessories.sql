-- Mobile phones: standard accessories every user receives
ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS has_charger BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS has_data_cable BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS has_back_cover BOOLEAN NOT NULL DEFAULT TRUE;
