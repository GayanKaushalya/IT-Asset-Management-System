-- All Branch PC Inventory: UPS brand (Prolink / DCP / Hikvision)
ALTER TABLE pcs
    ADD COLUMN IF NOT EXISTS ups_brand VARCHAR(50);
