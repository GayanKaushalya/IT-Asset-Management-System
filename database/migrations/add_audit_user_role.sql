-- Audit role: same visibility as super_admin, view-only (no create/edit/delete).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'audit'
    ) THEN
        ALTER TYPE user_role ADD VALUE 'audit';
    END IF;
END $$;
