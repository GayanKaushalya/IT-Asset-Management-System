-- New vs old (pre-Excel) laptop / phone entries:
-- new → top of list; old/legacy → bottom. Asset tags still use next sequence.
ALTER TABLE laptops
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mobile_phones
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_laptops_is_legacy
  ON laptops (is_legacy);

CREATE INDEX IF NOT EXISTS idx_mobile_phones_is_legacy
  ON mobile_phones (is_legacy);
