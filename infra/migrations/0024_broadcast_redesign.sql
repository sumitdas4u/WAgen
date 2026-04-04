ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS broadcast_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (broadcast_type IN ('standard', 'retarget'));

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS source_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS retarget_status TEXT
    CHECK (retarget_status IN ('sent', 'delivered', 'read', 'failed', 'skipped'));

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS audience_source_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS media_overrides_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS campaigns_source_campaign_idx
  ON campaigns(source_campaign_id, created_at DESC)
  WHERE source_campaign_id IS NOT NULL;
