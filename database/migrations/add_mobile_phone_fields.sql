-- Mobile phone fields on assets
ALTER TABLE assets ADD COLUMN IF NOT EXISTS imei_number VARCHAR(32);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS phone_number VARCHAR(40);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS first_handover_person VARCHAR(150);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS handed_over_on DATE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_return_date DATE;
