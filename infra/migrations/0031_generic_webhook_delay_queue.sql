ALTER TABLE generic_webhook_logs
  DROP CONSTRAINT IF EXISTS generic_webhook_logs_status_check;

ALTER TABLE generic_webhook_logs
  ADD CONSTRAINT generic_webhook_logs_status_check
  CHECK (status IN ('queued', 'completed', 'skipped', 'failed'));

CREATE TABLE IF NOT EXISTS generic_webhook_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id UUID,
  workflow_id UUID,
  log_id UUID REFERENCES generic_webhook_logs(id) ON DELETE SET NULL,
  request_id TEXT NOT NULL,
  channel_mode TEXT NOT NULL CHECK (channel_mode IN ('api', 'qr')),
  recipient_name TEXT,
  recipient_phone TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT NOT NULL,
  contact_email TEXT,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  template_id UUID,
  flow_id UUID,
  variable_values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  workflow_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_message TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generic_webhook_jobs_status_scheduled_idx
  ON generic_webhook_jobs(status, scheduled_at ASC);

CREATE INDEX IF NOT EXISTS generic_webhook_jobs_user_idx
  ON generic_webhook_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS generic_webhook_jobs_integration_workflow_idx
  ON generic_webhook_jobs(integration_id, workflow_id, created_at DESC);

DROP TRIGGER IF EXISTS generic_webhook_jobs_touch_updated_at ON generic_webhook_jobs;
CREATE TRIGGER generic_webhook_jobs_touch_updated_at
BEFORE UPDATE ON generic_webhook_jobs
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
