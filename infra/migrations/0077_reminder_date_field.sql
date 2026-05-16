-- Allow each reminder config to specify which contact field holds the date
-- Defaults to config_key so existing configs keep working without change
ALTER TABLE reminder_configs
  ADD COLUMN IF NOT EXISTS date_field_name VARCHAR(100);

UPDATE reminder_configs SET date_field_name = config_key WHERE date_field_name IS NULL;
