-- Mark built-in contact fields (birthday, anniversary) as system fields that cannot be deleted
ALTER TABLE contact_fields
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing birthday/anniversary fields
UPDATE contact_fields SET is_system = true
WHERE name IN ('birthday', 'anniversary');
