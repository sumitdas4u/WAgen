-- 0020: campaigns + campaign_messages for bulk messaging

CREATE TABLE IF NOT EXISTS campaigns (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  status               TEXT        NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled')),
  template_id          UUID        REFERENCES message_templates(id) ON DELETE SET NULL,
  template_variables   JSONB       NOT NULL DEFAULT '{}',
  target_segment_id    UUID        REFERENCES contact_segments(id) ON DELETE SET NULL,
  scheduled_at         TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  total_count          INTEGER     NOT NULL DEFAULT 0,
  sent_count           INTEGER     NOT NULL DEFAULT 0,
  delivered_count      INTEGER     NOT NULL DEFAULT 0,
  read_count           INTEGER     NOT NULL DEFAULT 0,
  failed_count         INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaigns_user_status_idx
  ON campaigns(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id    UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  phone_number  TEXT        NOT NULL,
  wamid         TEXT,
  status        TEXT        NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  retry_count   INTEGER     NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  error_code    TEXT,
  error_message TEXT,
  sent_at       TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_messages_campaign_status_idx
  ON campaign_messages(campaign_id, status);

CREATE INDEX IF NOT EXISTS campaign_messages_wamid_idx
  ON campaign_messages(wamid)
  WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaign_messages_retry_idx
  ON campaign_messages(next_retry_at)
  WHERE status = 'queued' AND retry_count > 0;

CREATE OR REPLACE FUNCTION touch_updated_at_campaigns()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS campaigns_touch_updated_at ON campaigns;
CREATE TRIGGER campaigns_touch_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS campaign_messages_touch_updated_at ON campaign_messages;
CREATE TRIGGER campaign_messages_touch_updated_at
  BEFORE UPDATE ON campaign_messages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
