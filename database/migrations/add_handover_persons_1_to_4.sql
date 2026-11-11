-- Store up to 4 handover persons on laptop + mobile phone rows
ALTER TABLE laptops
    ADD COLUMN IF NOT EXISTS handover_person_1 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_2 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_3 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_4 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_on_1 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_2 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_3 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_4 DATE;

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS handover_person_1 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_2 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_3 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_4 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_on_1 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_2 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_3 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_4 DATE;

-- Backfill slot 1 from legacy mobile columns when empty
UPDATE mobile_phones
SET handover_person_1 = COALESCE(NULLIF(handover_person_1, ''), first_handover_person),
    handover_on_1 = COALESCE(handover_on_1, handed_over_on)
WHERE first_handover_person IS NOT NULL OR handed_over_on IS NOT NULL;

-- Backfill slots from existing asset_handovers history (first 4 in order)
WITH ranked AS (
    SELECT ah.asset_id,
           ah.asset_type,
           ah.assigned_person_name,
           ah.handover_date,
           ROW_NUMBER() OVER (PARTITION BY ah.asset_type, ah.asset_id ORDER BY ah.id) AS rn
    FROM asset_handovers ah
    WHERE ah.asset_type IN ('laptop', 'mobile_phone')
      AND NULLIF(ah.assigned_person_name, '') IS NOT NULL
)
UPDATE laptops l SET
    handover_person_1 = COALESCE(l.handover_person_1, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 1)),
    handover_on_1     = COALESCE(l.handover_on_1,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 1)),
    handover_person_2 = COALESCE(l.handover_person_2, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 2)),
    handover_on_2     = COALESCE(l.handover_on_2,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 2)),
    handover_person_3 = COALESCE(l.handover_person_3, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 3)),
    handover_on_3     = COALESCE(l.handover_on_3,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 3)),
    handover_person_4 = COALESCE(l.handover_person_4, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 4)),
    handover_on_4     = COALESCE(l.handover_on_4,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 4));

WITH ranked AS (
    SELECT ah.asset_id,
           ah.asset_type,
           ah.assigned_person_name,
           ah.handover_date,
           ROW_NUMBER() OVER (PARTITION BY ah.asset_type, ah.asset_id ORDER BY ah.id) AS rn
    FROM asset_handovers ah
    WHERE ah.asset_type = 'mobile_phone'
      AND NULLIF(ah.assigned_person_name, '') IS NOT NULL
)
UPDATE mobile_phones m SET
    handover_person_1 = COALESCE(m.handover_person_1, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 1)),
    handover_on_1     = COALESCE(m.handover_on_1,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 1)),
    handover_person_2 = COALESCE(m.handover_person_2, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 2)),
    handover_on_2     = COALESCE(m.handover_on_2,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 2)),
    handover_person_3 = COALESCE(m.handover_person_3, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 3)),
    handover_on_3     = COALESCE(m.handover_on_3,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 3)),
    handover_person_4 = COALESCE(m.handover_person_4, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 4)),
    handover_on_4     = COALESCE(m.handover_on_4,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 4)),
    first_handover_person = COALESCE(m.first_handover_person, m.handover_person_1, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 1)),
    handed_over_on = COALESCE(m.handed_over_on, m.handover_on_1, (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 1));
