-- Dedicated email accounts: one mailbox, many users with locations
CREATE TABLE IF NOT EXISTS email_accounts (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    email_address       VARCHAR(191) NOT NULL,
    password_ciphertext TEXT NOT NULL,
    encryption_version  SMALLINT NOT NULL DEFAULT 1,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_email_accounts_company_email UNIQUE (company_id, email_address)
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_company ON email_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_email ON email_accounts(email_address);

CREATE TABLE IF NOT EXISTS email_account_users (
    id                  BIGSERIAL PRIMARY KEY,
    email_account_id    BIGINT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    user_name           VARCHAR(150) NOT NULL,
    location_id         BIGINT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_account_users_account ON email_account_users(email_account_id);
CREATE INDEX IF NOT EXISTS idx_email_account_users_location ON email_account_users(location_id);
