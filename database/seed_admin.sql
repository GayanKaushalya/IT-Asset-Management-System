-- Seed a Central IT super_admin for first login / API testing
-- Run AFTER schema.sql (MySQL)

INSERT INTO users (
    company_id, location_id, department_id,
    staff_id, name, email, role, can_decrypt_vault, is_active
)
SELECT
    c.id,
    l.id,
    d.id,
    'IT-ADMIN-001',
    'Central IT Admin',
    'it.admin@indragroup.lk',
    'super_admin',
    1,
    1
FROM companies c
JOIN locations l ON l.company_id = c.id AND l.code = 'KANDY_HO'
JOIN departments d ON d.company_id = c.id AND d.code = 'IT'
WHERE c.code = 'IT'
AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.email = 'it.admin@indragroup.lk'
);

-- Note the user id for Render env: API_TOKENS=demo-token:1
-- SELECT id, email, role FROM users;
