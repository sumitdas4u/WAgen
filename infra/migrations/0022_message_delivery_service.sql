ALTER TABLE campaign_messages
  DROP CONSTRAINT IF EXISTS campaign_messages_status_check;

ALTER TABLE campaign_messages
  ADD CONSTRAINT campaign_messages_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'));

CREATE TABLE IF NOT EXISTS message_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_message_id UUID REFERENCES campaign_messages(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES whatsapp_business_connections(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  linked_number TEXT,
  phone_number_id TEXT,
  message_kind TEXT NOT NULL
    CHECK (message_kind IN ('campaign_template', 'conversation_template', 'conversation_flow', 'conversation_text', 'direct_text', 'test_template')),
  status TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed', 'retry_scheduled')),
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  error_category TEXT
    CHECK (error_category IN ('transient', 'permanent', 'business_logic', 'unknown')),
  error_code TEXT,
  error_message TEXT,
  provider_message_id TEXT,
  requested_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_delivery_attempts_user_created_idx
  ON message_delivery_attempts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS message_delivery_attempts_campaign_idx
  ON message_delivery_attempts(campaign_id, created_at DESC)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS message_delivery_attempts_status_idx
  ON message_delivery_attempts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS message_delivery_attempts_provider_message_idx
  ON message_delivery_attempts(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wamid TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  error_code TEXT,
  event_timestamp TIMESTAMPTZ,
  event_key TEXT NOT NULL UNIQUE,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS delivery_webhook_events_wamid_idx
  ON delivery_webhook_events(wamid, created_at DESC);

CREATE INDEX IF NOT EXISTS delivery_webhook_events_unprocessed_idx
  ON delivery_webhook_events(created_at DESC)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS contact_delivery_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_label TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('send_failure', 'webhook_failure', 'manual')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, phone_number)
);

CREATE INDEX IF NOT EXISTS contact_delivery_suppressions_user_idx
  ON contact_delivery_suppressions(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS contact_delivery_suppressions_contact_idx
  ON contact_delivery_suppressions(contact_id)
  WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_delivery_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES whatsapp_business_connections(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL
    CHECK (alert_type IN ('high_failure_rate', 'webhook_delay', 'api_downtime')),
  severity TEXT NOT NULL
    CHECK (severity IN ('info', 'warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved')),
  summary TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_delivery_alerts_user_idx
  ON message_delivery_alerts(user_id, status, triggered_at DESC);

CREATE INDEX IF NOT EXISTS message_delivery_alerts_campaign_idx
  ON message_delivery_alerts(campaign_id, status, triggered_at DESC)
  WHERE campaign_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_delivery_alerts_open_unique_idx
  ON message_delivery_alerts(
    user_id,
    alert_type,
    COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(connection_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'open';

DROP TRIGGER IF EXISTS message_delivery_attempts_touch_updated_at ON message_delivery_attempts;
CREATE TRIGGER message_delivery_attempts_touch_updated_at
  BEFORE UPDATE ON message_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS contact_delivery_suppressions_touch_updated_at ON contact_delivery_suppressions;
CREATE TRIGGER contact_delivery_suppressions_touch_updated_at
  BEFORE UPDATE ON contact_delivery_suppressions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS message_delivery_alerts_touch_updated_at ON message_delivery_alerts;
CREATE TRIGGER message_delivery_alerts_touch_updated_at
  BEFORE UPDATE ON message_delivery_alerts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
