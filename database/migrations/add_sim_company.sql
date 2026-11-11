-- SIM company tab (mobile phone numbers / Dialog SIMs) — parallel to ITL / IMS / ISP
INSERT INTO companies (code, name, short_name)
SELECT 'SIM', 'SIM Cards', 'SIM'
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE code = 'SIM');

INSERT INTO locations (company_id, code, name, city, is_active)
SELECT c.id, v.code, v.name, v.city, TRUE
FROM companies c
CROSS JOIN (
    SELECT 'SIM_POOL' AS code, 'Dialog SIM Pool' AS name, 'Kandy' AS city
    UNION ALL
    SELECT 'KANDY_HO', 'Kandy Head Office', 'Kandy'
) AS v
WHERE c.code = 'SIM'
  AND NOT EXISTS (
      SELECT 1 FROM locations l WHERE l.company_id = c.id AND l.code = v.code
  );

INSERT INTO departments (company_id, location_id, code, name, is_active)
SELECT c.id, l.id, d.code, d.name, TRUE
FROM companies c
JOIN locations l ON l.company_id = c.id AND l.code = 'SIM_POOL'
CROSS JOIN (
    SELECT 'IT' AS code, 'Central IT' AS name
    UNION ALL SELECT 'OPS', 'Operations'
) AS d
WHERE c.code = 'SIM'
  AND NOT EXISTS (
      SELECT 1 FROM departments x WHERE x.company_id = c.id AND x.code = d.code
  );
