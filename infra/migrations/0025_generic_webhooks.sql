CREATE TABLE IF NOT EXISTS generic_webhook_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  webhook_key TEXT NOT NULL UNIQUE,
  secret_token TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_payload_flat_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generic_webhook_integrations_user_idx
  ON generic_webhook_integrations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS generic_webhook_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES generic_webhook_integrations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  match_mode TEXT NOT NULL DEFAULT 'all' CHECK (match_mode IN ('all', 'any')),
  conditions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  contact_action_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_action_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generic_webhook_workflows_user_idx
  ON generic_webhook_workflows(user_id, integration_id, sort_order, updated_at DESC);

CREATE TABLE IF NOT EXISTS generic_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES generic_webhook_integrations(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES generic_webhook_workflows(id) ON DELETE SET NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'skipped', 'failed')),
  customer_name TEXT,
  customer_phone TEXT,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  error_message TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generic_webhook_logs_user_idx
  ON generic_webhook_logs(user_id, integration_id, created_at DESC);

CREATE INDEX IF NOT EXISTS generic_webhook_logs_workflow_idx
  ON generic_webhook_logs(workflow_id, created_at DESC);

DROP TRIGGER IF EXISTS generic_webhook_integrations_touch_updated_at ON generic_webhook_integrations;
CREATE TRIGGER generic_webhook_integrations_touch_updated_at
BEFORE UPDATE ON generic_webhook_integrations
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS generic_webhook_workflows_touch_updated_at ON generic_webhook_workflows;
CREATE TRIGGER generic_webhook_workflows_touch_updated_at
BEFORE UPDATE ON generic_webhook_workflows
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
