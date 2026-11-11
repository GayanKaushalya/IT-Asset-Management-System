-- PCs tab = newly purchased register (stays listed even when Assigned)
ALTER TABLE pcs
  ADD COLUMN IF NOT EXISTS newly_purchased BOOLEAN NOT NULL DEFAULT FALSE;

-- Do not mass-backfill here — curation is intentional.
-- New PC creates set newly_purchased = TRUE in the API.
-- Available stock / Ja-ela can still be flagged manually or via curation scripts.

CREATE INDEX IF NOT EXISTS idx_pcs_newly_purchased
  ON pcs (newly_purchased)
  WHERE newly_purchased = TRUE;
