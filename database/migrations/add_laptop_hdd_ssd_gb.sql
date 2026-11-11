-- Laptop storage: separate HDD and SSD capacity (GB), same as PCs
ALTER TABLE laptops
  ADD COLUMN IF NOT EXISTS hdd_gb NUMERIC(10,1),
  ADD COLUMN IF NOT EXISTS ssd_gb NUMERIC(10,1);

-- Backfill from legacy single storage_gb (old form was "Storage Capacity GB SSD")
UPDATE laptops
SET ssd_gb = storage_gb
WHERE ssd_gb IS NULL
  AND storage_gb IS NOT NULL
  AND COALESCE(storage_type::text, 'unknown') IN ('ssd', 'hybrid', 'emmc', 'unknown');

UPDATE laptops
SET hdd_gb = storage_gb
WHERE hdd_gb IS NULL
  AND storage_gb IS NOT NULL
  AND storage_type::text = 'hdd';
