-- Speed up asset list filters (company + location + status)
CREATE INDEX IF NOT EXISTS idx_laptops_company_location ON laptops(company_id, location_id);
CREATE INDEX IF NOT EXISTS idx_laptops_location ON laptops(location_id);
CREATE INDEX IF NOT EXISTS idx_laptops_status ON laptops(status);
CREATE INDEX IF NOT EXISTS idx_laptops_serial ON laptops(serial_number);

CREATE INDEX IF NOT EXISTS idx_mobile_phones_company_location ON mobile_phones(company_id, location_id);
CREATE INDEX IF NOT EXISTS idx_mobile_phones_location ON mobile_phones(location_id);
CREATE INDEX IF NOT EXISTS idx_mobile_phones_status ON mobile_phones(status);

CREATE INDEX IF NOT EXISTS idx_pcs_company_location ON pcs(company_id, location_id);
CREATE INDEX IF NOT EXISTS idx_pcs_location ON pcs(location_id);
CREATE INDEX IF NOT EXISTS idx_pcs_status ON pcs(status);

CREATE INDEX IF NOT EXISTS idx_printers_company_location ON printers(company_id, location_id);
CREATE INDEX IF NOT EXISTS idx_printers_status ON printers(status);

CREATE INDEX IF NOT EXISTS idx_other_assets_company_location ON other_assets(company_id, location_id);
CREATE INDEX IF NOT EXISTS idx_other_assets_status ON other_assets(status);
