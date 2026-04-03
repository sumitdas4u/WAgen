ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE campaign_messages
  ADD COLUMN IF NOT EXISTS resolved_variables_json JSONB;
