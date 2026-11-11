-- Original assigned user (1st recipient, kept forever) + current allocated user
ALTER TABLE laptops
    ADD COLUMN IF NOT EXISTS original_assigned_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS original_assigned_on DATE,
    ADD COLUMN IF NOT EXISTS allocated_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS allocated_on DATE;

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS original_assigned_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS original_assigned_on DATE,
    ADD COLUMN IF NOT EXISTS allocated_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS allocated_on DATE;

-- Backfill original = 1st handover slot (or legacy mobile fields)
UPDATE laptops SET
    original_assigned_person = COALESCE(original_assigned_person, handover_person_1),
    original_assigned_on = COALESCE(original_assigned_on, handover_on_1)
WHERE handover_person_1 IS NOT NULL OR handover_on_1 IS NOT NULL;

UPDATE mobile_phones SET
    original_assigned_person = COALESCE(original_assigned_person, handover_person_1, first_handover_person),
    original_assigned_on = COALESCE(original_assigned_on, handover_on_1, handed_over_on)
WHERE handover_person_1 IS NOT NULL OR first_handover_person IS NOT NULL
   OR handover_on_1 IS NOT NULL OR handed_over_on IS NOT NULL;

-- Backfill current allocated from open handovers
UPDATE laptops l SET
    allocated_person = h.assigned_person_name,
    allocated_on = h.handover_date
FROM asset_handovers h
WHERE h.asset_type = 'laptop' AND h.asset_id = l.id AND h.is_open = TRUE
  AND NULLIF(h.assigned_person_name, '') IS NOT NULL;

UPDATE mobile_phones m SET
    allocated_person = h.assigned_person_name,
    allocated_on = h.handover_date
FROM asset_handovers h
WHERE h.asset_type = 'mobile_phone' AND h.asset_id = m.id AND h.is_open = TRUE
  AND NULLIF(h.assigned_person_name, '') IS NOT NULL;

-- Ensure every handover history row has a handover_date
UPDATE asset_handovers
SET handover_date = COALESCE(handover_date, created_at::date, CURRENT_DATE)
WHERE handover_date IS NULL
  AND asset_type IN ('laptop', 'mobile_phone');
