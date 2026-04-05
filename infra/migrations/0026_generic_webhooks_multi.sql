ALTER TABLE generic_webhook_integrations
  ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE generic_webhook_integrations
SET name = COALESCE(NULLIF(TRIM(name), ''), 'Primary Webhook')
WHERE name IS NULL OR TRIM(name) = '';

ALTER TABLE generic_webhook_integrations
  ALTER COLUMN name SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'generic_webhook_integrations'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'generic_webhook_integrations_user_id_key'
  ) THEN
    ALTER TABLE generic_webhook_integrations
      DROP CONSTRAINT generic_webhook_integrations_user_id_key;
  END IF;
END $$;

DROP INDEX IF EXISTS generic_webhook_integrations_user_id_key;

CREATE INDEX IF NOT EXISTS generic_webhook_integrations_user_idx
  ON generic_webhook_integrations(user_id, updated_at DESC);
