-- On Loan register: laptops issued temporarily (separate Asset Management tab)

ALTER TABLE laptops
    ADD COLUMN IF NOT EXISTS is_on_loan BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_laptops_is_on_loan ON laptops (is_on_loan)
    WHERE is_on_loan = TRUE;
