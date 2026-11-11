-- ITAMS monitoring queries (run in pgAdmin: Query Tool on database "itams")

-- Overview counts
SELECT 'companies' AS item, count(*)::int AS total FROM companies
UNION ALL SELECT 'users', count(*)::int FROM users
UNION ALL SELECT 'laptops', count(*)::int FROM laptops
UNION ALL SELECT 'mobile_phones', count(*)::int FROM mobile_phones
UNION ALL SELECT 'pcs', count(*)::int FROM pcs
UNION ALL SELECT 'credentials', count(*)::int FROM credentials
UNION ALL SELECT 'email_accounts', count(*)::int FROM email_accounts
UNION ALL SELECT 'open_handovers', count(*)::int FROM asset_handovers WHERE is_open = true
ORDER BY item;

-- Assets by company
SELECT c.code, c.short_name, count(*) AS assets
FROM (
    SELECT company_id FROM laptops
    UNION ALL SELECT company_id FROM mobile_phones
    UNION ALL SELECT company_id FROM pcs
    UNION ALL SELECT company_id FROM printers
    UNION ALL SELECT company_id FROM other_assets
) a
JOIN companies c ON c.id = a.company_id
GROUP BY c.code, c.short_name
ORDER BY assets DESC;

-- Recent handovers
SELECT h.id, c.code AS company, h.asset_type, h.assigned_person_name,
       h.handover_date, h.is_open, h.gate_pass_no
FROM asset_handovers h
JOIN companies c ON c.id = h.company_id
ORDER BY h.updated_at DESC
LIMIT 20;

-- Laptops deployed vs available
SELECT status, count(*) FROM laptops GROUP BY status ORDER BY count DESC;

-- Users
SELECT id, email, name, role, is_active, last_login_at FROM users ORDER BY id;
