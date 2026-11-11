-- UPS purchase date (warranty expiry is derived from this + ups_warranty_period)
ALTER TABLE pcs
  ADD COLUMN IF NOT EXISTS ups_purchase_date DATE;
