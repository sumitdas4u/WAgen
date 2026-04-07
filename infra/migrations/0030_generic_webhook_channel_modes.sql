ALTER TABLE generic_webhook_workflows
  ADD COLUMN IF NOT EXISTS channel_mode TEXT;

UPDATE generic_webhook_workflows
SET channel_mode = 'api'
WHERE channel_mode IS NULL OR TRIM(channel_mode) = '';

ALTER TABLE generic_webhook_workflows
  ALTER COLUMN channel_mode SET NOT NULL;

ALTER TABLE generic_webhook_workflows
  DROP CONSTRAINT IF EXISTS generic_webhook_workflows_channel_mode_check;

ALTER TABLE generic_webhook_workflows
  ADD CONSTRAINT generic_webhook_workflows_channel_mode_check
  CHECK (channel_mode IN ('api', 'qr'));

ALTER TABLE generic_webhook_workflows
  ADD COLUMN IF NOT EXISTS qr_flow_action_json JSONB NOT NULL DEFAULT '{}'::jsonb;
