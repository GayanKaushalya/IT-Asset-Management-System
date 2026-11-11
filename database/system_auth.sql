-- Run in Supabase SQL Editor (adds login tokens table)
CREATE TABLE IF NOT EXISTS api_access_tokens (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR(64) NOT NULL UNIQUE,
    label        VARCHAR(100),
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_access_tokens(user_id);

-- Ensure admin can use vault
UPDATE users
SET can_decrypt_vault = TRUE,
    role = 'super_admin'
WHERE email = 'it.admin@indragroup.lk';
