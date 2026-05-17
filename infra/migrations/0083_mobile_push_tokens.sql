CREATE TABLE IF NOT EXISTS mobile_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'unknown' CHECK (platform IN ('android', 'ios', 'unknown')),
  device_name TEXT,
  app_version TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mobile_push_tokens_user_enabled_idx
  ON mobile_push_tokens(user_id, enabled, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS mobile_push_tokens_token_idx
  ON mobile_push_tokens(expo_push_token);
