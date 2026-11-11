-- PC handover slots (same pattern as laptops / mobile phones) for All Branch inventory
ALTER TABLE pcs
    ADD COLUMN IF NOT EXISTS handover_person_1 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_2 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_3 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_person_4 VARCHAR(150),
    ADD COLUMN IF NOT EXISTS handover_on_1 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_2 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_3 DATE,
    ADD COLUMN IF NOT EXISTS handover_on_4 DATE,
    ADD COLUMN IF NOT EXISTS original_assigned_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS original_assigned_on DATE,
    ADD COLUMN IF NOT EXISTS allocated_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS allocated_on DATE;
