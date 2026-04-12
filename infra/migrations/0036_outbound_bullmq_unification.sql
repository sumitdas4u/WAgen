CREATE TABLE IF NOT EXISTS outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'conversation_api',
      'conversation_qr',
      'conversation_web',
      'template_api',
      'campaign_send',
      'sequence_send',
      'generic_webhook'
    )
  ),
  channel TEXT NOT NULL CHECK (channel IN ('api', 'qr', 'web', 'webhook')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  job_key TEXT NOT NULL UNIQUE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  campaign_message_id UUID REFERENCES campaign_messages(id) ON DELETE CASCADE,
  sequence_enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
  sequence_step_index INTEGER,
  generic_webhook_log_id UUID REFERENCES generic_webhook_logs(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grouping_key TEXT,
  sender_name TEXT,
  display_text TEXT,
  media_url TEXT,
  media_mime_type TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  variable_values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  usage_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_message_id TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outbound_messages_status_scheduled_idx
  ON outbound_messages(status, scheduled_at ASC);

CREATE INDEX IF NOT EXISTS outbound_messages_grouping_idx
  ON outbound_messages(grouping_key, created_at ASC);

CREATE INDEX IF NOT EXISTS outbound_messages_conversation_idx
  ON outbound_messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS outbound_messages_campaign_idx
  ON outbound_messages(campaign_message_id);

CREATE INDEX IF NOT EXISTS outbound_messages_sequence_idx
  ON outbound_messages(sequence_enrollment_id, sequence_step_index);

CREATE INDEX IF NOT EXISTS outbound_messages_webhook_idx
  ON outbound_messages(generic_webhook_log_id);

DROP TRIGGER IF EXISTS outbound_messages_touch_updated_at ON outbound_messages;
CREATE TRIGGER outbound_messages_touch_updated_at
BEFORE UPDATE ON outbound_messages
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE sequence_enrollments
  DROP CONSTRAINT IF EXISTS sequence_enrollments_status_check;

ALTER TABLE sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_status_check
  CHECK (status IN ('active', 'sending', 'completed', 'failed', 'stopped'));
