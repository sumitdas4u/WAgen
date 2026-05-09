-- Append-only engagement event log (drives time-series graphs)
CREATE TABLE IF NOT EXISTS campaign_engagement_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_msg_id  UUID        REFERENCES campaign_messages(id) ON DELETE SET NULL,
  contact_id       UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  event_type       TEXT        NOT NULL
                     CHECK (event_type IN ('clicked_button','clicked_url','replied_any','replied_quote')),
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_engagement_campaign_time_idx
  ON campaign_engagement_events(campaign_id, occurred_at);

-- Per-recipient engagement timestamps
ALTER TABLE campaign_messages
  ADD COLUMN IF NOT EXISTS clicked_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quote_replied_at TIMESTAMPTZ;

-- Fast aggregate counters
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS clicked_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replied_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quote_replied_count INTEGER NOT NULL DEFAULT 0;
