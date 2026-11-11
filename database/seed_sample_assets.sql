-- Sample assets for Indra Group demo (run after schema)
-- Inserts into the 5 category tables

INSERT INTO laptops (
    company_id, asset_tag, pc_name, serial_number, brand, model, status,
    cpu, ram_gb, storage_gb, purchase_amount_lkr, notes
)
SELECT c.id, v.tag, v.name, v.sn, v.brand, v.model, 'available',
       v.cpu, v.ram, v.storage, v.amount, v.notes
FROM companies c
JOIN (
    SELECT 'ITL-LP-0001' AS tag, 'IT-LAP-01' AS name, 'SN-LP-001' AS sn,
           'Dell' AS brand, 'Latitude 5540' AS model, 'i7' AS cpu, 16 AS ram, 512 AS storage,
           285000 AS amount, 'Demo laptop' AS notes
) v ON TRUE
WHERE c.code = 'IT'
  AND NOT EXISTS (SELECT 1 FROM laptops a WHERE a.asset_tag = v.tag);

INSERT INTO mobile_phones (
    company_id, asset_tag, pc_name, serial_number, brand, model, status,
    imei_number, phone_number, purchase_amount_lkr, notes
)
SELECT c.id, v.tag, v.name, v.sn, v.brand, v.model, 'available',
       v.imei, v.phone, v.amount, v.notes
FROM companies c
JOIN (
    SELECT 'ITL-MB-0001' AS tag, 'IT-MOB-01' AS name, 'SN-MB-001' AS sn,
           'Samsung' AS brand, 'A54' AS model, '356938035643809' AS imei,
           '0771234567' AS phone, 95000 AS amount, 'Demo phone' AS notes
) v ON TRUE
WHERE c.code = 'IT'
  AND NOT EXISTS (SELECT 1 FROM mobile_phones a WHERE a.asset_tag = v.tag);

INSERT INTO pcs (
    company_id, asset_tag, pc_name, serial_number, brand, model, status,
    cpu, ram_gb, storage_gb, purchase_amount_lkr, notes
)
SELECT c.id, v.tag, v.name, v.sn, v.brand, v.model, 'available',
       v.cpu, v.ram, v.storage, v.amount, v.notes
FROM companies c
JOIN (
    SELECT 'ITL-PC-0001' AS tag, 'IT-PC-01' AS name, 'SN-PC-001' AS sn,
           'HP' AS brand, 'ProDesk 400' AS model, 'i5' AS cpu, 8 AS ram, 256 AS storage,
           175000 AS amount, 'Demo PC' AS notes
) v ON TRUE
WHERE c.code = 'IT'
  AND NOT EXISTS (SELECT 1 FROM pcs a WHERE a.asset_tag = v.tag);
