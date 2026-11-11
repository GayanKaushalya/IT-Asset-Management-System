-- Seed Indra Group branch locations (idempotent)
-- ITL = companies.code 'IT'
-- Head offices (always first in UI): ITL=KANDY_HO, IMS=BR_201, ISP=KANDY

-- ITL (Indra Traders) — Kandy Head Office first
INSERT INTO locations (company_id, code, name, city)
SELECT c.id, v.code, v.name, v.city
FROM companies c
CROSS JOIN (
    SELECT 'KANDY_HO' AS code, 'Head Office - Kandy' AS name, 'Kandy' AS city
    UNION ALL SELECT 'RAMANAYAKE', 'Colombo', 'Colombo'
    UNION ALL SELECT 'NEGOMBO', 'Negombo', 'Negombo'
    UNION ALL SELECT 'KELANI', 'Kelaniya', 'Kelaniya'
    UNION ALL SELECT 'JA_ELA', 'Jaela-Foton', 'Jaela'
    UNION ALL SELECT 'MATHARA', 'Mathara', 'Matara'
    UNION ALL SELECT 'ANURADHAPURA', 'Anuradhapura', 'Anuradhapura'
    UNION ALL SELECT 'FOTON_KANDY', 'Kandy - Foton', 'Kandy'
    UNION ALL SELECT 'FOTON_KELANIYA', 'Kelaniya - Foton', 'Kelaniya'
) AS v
WHERE c.code = 'IT'
  AND NOT EXISTS (
      SELECT 1 FROM locations l WHERE l.company_id = c.id AND l.code = v.code
  );

-- ISP (Indra Service Park) — Kandy is head office
INSERT INTO locations (company_id, code, name, city)
SELECT c.id, v.code, v.name, v.city
FROM companies c
CROSS JOIN (
    SELECT 'KANDY' AS code, 'Kandy' AS name, 'Kandy' AS city
    UNION ALL SELECT 'KELANI', 'Kelaniya', 'Kelaniya'
    UNION ALL SELECT 'MATHARA', 'Mathara', 'Matara'
    UNION ALL SELECT 'ANURADHAPURA', 'Anuradhapura', 'Anuradhapura'
) AS v
WHERE c.code = 'ISP'
  AND NOT EXISTS (
      SELECT 1 FROM locations l WHERE l.company_id = c.id AND l.code = v.code
  );

-- IMS (Indra Motor Spares) — 201 is head office
INSERT INTO locations (company_id, code, name, city)
SELECT c.id, v.code, v.name, v.city
FROM companies c
CROSS JOIN (
    SELECT 'BR_201' AS code, '201' AS name, 'Branch 201' AS city
    UNION ALL SELECT 'HYDEPARK', 'Hydepark', 'Colombo'
    UNION ALL SELECT 'MATHARA', 'Mathara', 'Matara'
    UNION ALL SELECT 'EMBILIPITIYA', 'Embilipitiya', 'Embilipitiya'
    UNION ALL SELECT 'GAMPOLA', 'Gampola', 'Gampola'
    UNION ALL SELECT 'BR_43', '43', 'Branch 43'
    UNION ALL SELECT 'BR_140', '140', 'Branch 140'
) AS v
WHERE c.code = 'IMS'
  AND NOT EXISTS (
      SELECT 1 FROM locations l WHERE l.company_id = c.id AND l.code = v.code
  );
