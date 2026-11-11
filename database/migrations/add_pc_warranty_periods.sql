-- PC device warranty period + UPS warranty period
ALTER TABLE pcs
  ADD COLUMN IF NOT EXISTS warranty_period VARCHAR(40),
  ADD COLUMN IF NOT EXISTS ups_warranty_period VARCHAR(40),
  ADD COLUMN IF NOT EXISTS ups_warranty_expires_on DATE;
