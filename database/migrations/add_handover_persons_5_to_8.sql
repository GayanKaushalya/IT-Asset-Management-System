-- Extend denormalized handover / assignment chain to 8 persons
ALTER TABLE laptops
    ADD COLUMN IF NOT EXISTS handover_person_5 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_6 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_7 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_8 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_on_5 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_6 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_7 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_8 DATE;

ALTER TABLE mobile_phones
    ADD COLUMN IF NOT EXISTS handover_person_5 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_6 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_7 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_8 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_on_5 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_6 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_7 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_8 DATE;

ALTER TABLE pcs
    ADD COLUMN IF NOT EXISTS handover_person_5 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_6 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_7 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_8 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_on_5 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_6 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_7 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_8 DATE;

-- Backfill slots 5–8 from asset_handovers when present
WITH ranked AS (
    SELECT ah.asset_id,
           ah.asset_type,
           ah.assigned_person_name,
           ah.handover_date,
           ROW_NUMBER() OVER (PARTITION BY ah.asset_type, ah.asset_id ORDER BY ah.id) AS rn
    FROM asset_handovers ah
    WHERE ah.asset_type IN ('laptop', 'mobile_phone', 'pc')
      AND NULLIF(ah.assigned_person_name, '') IS NOT NULL
)
UPDATE laptops l SET
    handover_person_5 = COALESCE(l.handover_person_5, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 5)),
    handover_on_5     = COALESCE(l.handover_on_5,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 5)),
    handover_person_6 = COALESCE(l.handover_person_6, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 6)),
    handover_on_6     = COALESCE(l.handover_on_6,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 6)),
    handover_person_7 = COALESCE(l.handover_person_7, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 7)),
    handover_on_7     = COALESCE(l.handover_on_7,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 7)),
    handover_person_8 = COALESCE(l.handover_person_8, (SELECT assigned_person_name FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 8)),
    handover_on_8     = COALESCE(l.handover_on_8,     (SELECT handover_date FROM ranked r WHERE r.asset_type = 'laptop' AND r.asset_id = l.id AND r.rn = 8));

WITH ranked AS (
    SELECT ah.asset_id,
           ah.assigned_person_name,
           ah.handover_date,
           ROW_NUMBER() OVER (PARTITION BY ah.asset_id ORDER BY ah.id) AS rn
    FROM asset_handovers ah
    WHERE ah.asset_type = 'mobile_phone'
      AND NULLIF(ah.assigned_person_name, '') IS NOT NULL
)
UPDATE mobile_phones m SET
    handover_person_5 = COALESCE(m.handover_person_5, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 5)),
    handover_on_5     = COALESCE(m.handover_on_5,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 5)),
    handover_person_6 = COALESCE(m.handover_person_6, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 6)),
    handover_on_6     = COALESCE(m.handover_on_6,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 6)),
    handover_person_7 = COALESCE(m.handover_person_7, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 7)),
    handover_on_7     = COALESCE(m.handover_on_7,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 7)),
    handover_person_8 = COALESCE(m.handover_person_8, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = m.id AND r.rn = 8)),
    handover_on_8     = COALESCE(m.handover_on_8,     (SELECT handover_date FROM ranked r WHERE r.asset_id = m.id AND r.rn = 8));

WITH ranked AS (
    SELECT ah.asset_id,
           ah.assigned_person_name,
           ah.handover_date,
           ROW_NUMBER() OVER (PARTITION BY ah.asset_id ORDER BY ah.id) AS rn
    FROM asset_handovers ah
    WHERE ah.asset_type = 'pc'
      AND NULLIF(ah.assigned_person_name, '') IS NOT NULL
)
UPDATE pcs p SET
    handover_person_5 = COALESCE(p.handover_person_5, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = p.id AND r.rn = 5)),
    handover_on_5     = COALESCE(p.handover_on_5,     (SELECT handover_date FROM ranked r WHERE r.asset_id = p.id AND r.rn = 5)),
    handover_person_6 = COALESCE(p.handover_person_6, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = p.id AND r.rn = 6)),
    handover_on_6     = COALESCE(p.handover_on_6,     (SELECT handover_date FROM ranked r WHERE r.asset_id = p.id AND r.rn = 6)),
    handover_person_7 = COALESCE(p.handover_person_7, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = p.id AND r.rn = 7)),
    handover_on_7     = COALESCE(p.handover_on_7,     (SELECT handover_date FROM ranked r WHERE r.asset_id = p.id AND r.rn = 7)),
    handover_person_8 = COALESCE(p.handover_person_8, (SELECT assigned_person_name FROM ranked r WHERE r.asset_id = p.id AND r.rn = 8)),
    handover_on_8     = COALESCE(p.handover_on_8,     (SELECT handover_date FROM ranked r WHERE r.asset_id = p.id AND r.rn = 8));
