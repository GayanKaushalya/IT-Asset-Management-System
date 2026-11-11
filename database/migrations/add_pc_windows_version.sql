-- PC operating system / Windows version
ALTER TABLE pcs
  ADD COLUMN IF NOT EXISTS windows_version VARCHAR(80);
