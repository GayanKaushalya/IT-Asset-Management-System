-- Run in Supabase → SQL Editor (removes employee requirement from handovers)
-- Safe to re-run.

DROP VIEW IF EXISTS v_open_handovers;

ALTER TABLE asset_handovers
  ADD COLUMN IF NOT EXISTS assigned_person_name VARCHAR(150);

ALTER TABLE asset_handovers
  ALTER COLUMN assigned_employee_id DROP NOT NULL;

-- Drop old FK and recreate as nullable ON DELETE SET NULL
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'asset_handovers'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'assigned_employee_id'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE asset_handovers DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE asset_handovers
  DROP CONSTRAINT IF EXISTS asset_handovers_assigned_employee_id_fkey;

ALTER TABLE asset_handovers
  ADD CONSTRAINT asset_handovers_assigned_employee_id_fkey
  FOREIGN KEY (assigned_employee_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE OR REPLACE VIEW v_open_handovers AS
SELECT
    h.id,
    h.uuid,
    h.company_id,
    h.gate_pass_no,
    h.handover_date,
    a.asset_tag,
    a.pc_name,
    a.category,
    COALESCE(NULLIF(h.assigned_person_name, ''), e.name) AS assigned_person_name,
    e.staff_id AS employee_staff_id,
    e.name AS employee_name,
    it.name AS it_staff_name
FROM asset_handovers h
JOIN assets a ON a.id = h.asset_id
LEFT JOIN users e ON e.id = h.assigned_employee_id
JOIN users it ON it.id = h.assigned_by_it_staff_id
WHERE h.is_open = TRUE;
