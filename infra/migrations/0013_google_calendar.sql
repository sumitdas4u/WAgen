CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  google_account_id TEXT,
  display_name TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'connected',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS google_calendar_connections_user_idx
  ON google_calendar_connections(user_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS google_calendar_connections_touch_updated_at ON google_calendar_connections;
CREATE TRIGGER google_calendar_connections_touch_updated_at
BEFORE UPDATE ON google_calendar_connections
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
