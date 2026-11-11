-- Add Foton company + wifi credential type
INSERT INTO companies (code, name, short_name)
SELECT 'FOTON', 'Indra Foton', 'Foton'
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE code = 'FOTON');

INSERT INTO locations (company_id, code, name, city)
SELECT c.id, v.code, v.name, v.city
FROM companies c
CROSS JOIN (
    SELECT 'KANDY_HO' AS code, 'Kandy Head Office' AS name, 'Kandy' AS city
    UNION ALL
    SELECT 'CMB_BR', 'Colombo Branch', 'Colombo'
) AS v
WHERE c.code = 'FOTON'
  AND NOT EXISTS (
      SELECT 1 FROM locations l WHERE l.company_id = c.id AND l.code = v.code
  );

INSERT INTO departments (company_id, location_id, code, name)
SELECT c.id, l.id, d.code, d.name
FROM companies c
JOIN locations l ON l.company_id = c.id AND l.code = 'KANDY_HO'
CROSS JOIN (
    SELECT 'ACCOUNTS' AS code, 'Accounts Dept' AS name
    UNION ALL SELECT 'SALES', 'Sales'
    UNION ALL SELECT 'IT', 'Central IT'
    UNION ALL SELECT 'OPS', 'Operations'
) AS d
WHERE c.code = 'FOTON'
  AND NOT EXISTS (
      SELECT 1 FROM departments x WHERE x.company_id = c.id AND x.code = d.code
  );

DO $$ BEGIN
    ALTER TYPE credential_type ADD VALUE IF NOT EXISTS 'wifi';
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;
