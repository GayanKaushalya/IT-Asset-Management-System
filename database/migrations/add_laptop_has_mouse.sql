-- Track whether a mouse was issued with a laptop
ALTER TABLE laptops
    ADD COLUMN IF NOT EXISTS has_mouse BOOLEAN NOT NULL DEFAULT FALSE;
