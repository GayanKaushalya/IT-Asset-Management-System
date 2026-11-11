-- ITL (companies.code = 'IT') Foton branch locations
-- Display names: "Kandy - Foton", "Kelaniya - Foton", "Ja-ela - Foton"

INSERT INTO locations (company_id, code, name, city)
SELECT c.id, v.code, v.name, v.city
FROM companies c
CROSS JOIN (
    SELECT 'FOTON_KANDY' AS code, 'Kandy - Foton' AS name, 'Kandy' AS city
    UNION ALL SELECT 'FOTON_KELANIYA', 'Kelaniya - Foton', 'Kelaniya'
    -- Ja-ela ITL branch is Foton (locations.code JA_ELA → name Jaela-Foton); no separate FOTON_JA_ELA row
) AS v
WHERE c.code = 'IT'
  AND NOT EXISTS (
      SELECT 1 FROM locations l WHERE l.company_id = c.id AND l.code = v.code
  );
