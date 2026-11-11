-- Laptops: selectable warranty period (same options as PC inventory)
ALTER TABLE laptops
  ADD COLUMN IF NOT EXISTS warranty_period VARCHAR(40);
