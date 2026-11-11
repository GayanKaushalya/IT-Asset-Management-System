
BEGIN;

-- Helper: strip existing title then apply employee title or heuristic via CASE
-- Laptops
UPDATE laptops l
SET allocated_person = CASE
        WHEN l.allocated_person IS NULL OR btrim(l.allocated_person) = '' THEN l.allocated_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(l.allocated_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(l.allocated_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND l.allocated_person IS NOT NULL AND btrim(l.allocated_person) <> '';

UPDATE laptops l
SET original_assigned_person = CASE
        WHEN l.original_assigned_person IS NULL OR btrim(l.original_assigned_person) = '' THEN l.original_assigned_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(l.original_assigned_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(l.original_assigned_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND l.original_assigned_person IS NOT NULL AND btrim(l.original_assigned_person) <> '';

UPDATE laptops l SET
  handover_person_1 = CASE WHEN handover_person_1 IS NULL OR btrim(handover_person_1)='' THEN handover_person_1
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(l.handover_person_1), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_1), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_2 = CASE WHEN handover_person_2 IS NULL OR btrim(handover_person_2)='' THEN handover_person_2
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(l.handover_person_2), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_2), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_3 = CASE WHEN handover_person_3 IS NULL OR btrim(handover_person_3)='' THEN handover_person_3
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(l.handover_person_3), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_3), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_4 = CASE WHEN handover_person_4 IS NULL OR btrim(handover_person_4)='' THEN handover_person_4
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(l.handover_person_4), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_4), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  updated_at = NOW()
WHERE COALESCE(handover_person_1, handover_person_2, handover_person_3, handover_person_4) IS NOT NULL;

-- Mobile phones
UPDATE mobile_phones m
SET allocated_person = CASE
        WHEN m.allocated_person IS NULL OR btrim(m.allocated_person) = '' THEN m.allocated_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(m.allocated_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(m.allocated_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND m.allocated_person IS NOT NULL AND btrim(m.allocated_person) <> '';

UPDATE mobile_phones m
SET original_assigned_person = CASE
        WHEN m.original_assigned_person IS NULL OR btrim(m.original_assigned_person) = '' THEN m.original_assigned_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(m.original_assigned_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(m.original_assigned_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND m.original_assigned_person IS NOT NULL AND btrim(m.original_assigned_person) <> '';

UPDATE mobile_phones m
SET first_handover_person = CASE
        WHEN m.first_handover_person IS NULL OR btrim(m.first_handover_person) = '' THEN m.first_handover_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(m.first_handover_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(m.first_handover_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND m.first_handover_person IS NOT NULL AND btrim(m.first_handover_person) <> '';

UPDATE mobile_phones m SET
  handover_person_1 = CASE WHEN handover_person_1 IS NULL OR btrim(handover_person_1)='' THEN handover_person_1
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(m.handover_person_1), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_1), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_2 = CASE WHEN handover_person_2 IS NULL OR btrim(handover_person_2)='' THEN handover_person_2
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(m.handover_person_2), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_2), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_3 = CASE WHEN handover_person_3 IS NULL OR btrim(handover_person_3)='' THEN handover_person_3
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(m.handover_person_3), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_3), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_4 = CASE WHEN handover_person_4 IS NULL OR btrim(handover_person_4)='' THEN handover_person_4
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(m.handover_person_4), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_4), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  updated_at = NOW()
WHERE COALESCE(handover_person_1, handover_person_2, handover_person_3, handover_person_4) IS NOT NULL;

-- Remaining asset names without employee match: default Mr. if no title yet
UPDATE laptops SET allocated_person = 'Mr. ' || btrim(allocated_person), updated_at = NOW()
WHERE allocated_person IS NOT NULL AND btrim(allocated_person) <> ''
  AND allocated_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

UPDATE laptops SET original_assigned_person = 'Mr. ' || btrim(original_assigned_person), updated_at = NOW()
WHERE original_assigned_person IS NOT NULL AND btrim(original_assigned_person) <> ''
  AND original_assigned_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

UPDATE mobile_phones SET allocated_person = 'Mr. ' || btrim(allocated_person), updated_at = NOW()
WHERE allocated_person IS NOT NULL AND btrim(allocated_person) <> ''
  AND allocated_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

UPDATE mobile_phones SET original_assigned_person = 'Mr. ' || btrim(original_assigned_person), updated_at = NOW()
WHERE original_assigned_person IS NOT NULL AND btrim(original_assigned_person) <> ''
  AND original_assigned_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

UPDATE mobile_phones SET first_handover_person = 'Mr. ' || btrim(first_handover_person), updated_at = NOW()
WHERE first_handover_person IS NOT NULL AND btrim(first_handover_person) <> ''
  AND first_handover_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

COMMIT;
