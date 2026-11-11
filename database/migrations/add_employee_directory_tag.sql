-- Tag for directory browse / name suggestions: Current | Probation | Former
ALTER TABLE employees ADD COLUMN IF NOT EXISTS directory_tag VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_employees_directory_tag ON employees(directory_tag);
