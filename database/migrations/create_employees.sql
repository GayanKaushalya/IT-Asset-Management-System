-- Indra Group organization directory (HR employees — not login users)
CREATE TABLE IF NOT EXISTS employees (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    staff_id            VARCHAR(50) NOT NULL,
    name                VARCHAR(200) NOT NULL,
    title               VARCHAR(10),
    epf_number          VARCHAR(50),
    employment_status   VARCHAR(40) NOT NULL DEFAULT 'Current',
    directory_tag       VARCHAR(40),
    designation         VARCHAR(200),
    work_location       VARCHAR(200),
    department_name     VARCHAR(200),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(employment_status);
CREATE INDEX IF NOT EXISTS idx_employees_location ON employees(work_location);
