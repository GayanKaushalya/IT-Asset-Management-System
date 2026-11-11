-- PC storage: separate HDD and SSD capacity (GB)
ALTER TABLE pcs
  ADD COLUMN IF NOT EXISTS hdd_gb NUMERIC(10,1),
  ADD COLUMN IF NOT EXISTS ssd_gb NUMERIC(10,1);

-- Prefer existing storage_gb as SSD when type is ssd/hybrid/unknown; HDD when type is hdd
UPDATE pcs
SET ssd_gb = storage_gb
WHERE ssd_gb IS NULL
  AND storage_gb IS NOT NULL
  AND COALESCE(storage_type::text, 'unknown') IN ('ssd', 'hybrid', 'emmc', 'unknown');

UPDATE pcs
SET hdd_gb = storage_gb
WHERE hdd_gb IS NULL
  AND storage_gb IS NOT NULL
  AND storage_type::text = 'hdd';
