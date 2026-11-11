-- System audit trail: logins, logouts, role/access changes
CREATE TABLE IF NOT EXISTS system_audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    actor_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    target_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(64) NOT NULL,
    details         JSONB,
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_audit_created ON system_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_action ON system_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_system_audit_actor ON system_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_system_audit_target ON system_audit_logs(target_user_id);
