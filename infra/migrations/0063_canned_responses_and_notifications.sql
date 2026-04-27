-- Canned responses (saved reply shortcuts)
CREATE TABLE IF NOT EXISTS canned_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  short_code  TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canned_responses_short_code_check CHECK (length(btrim(short_code)) > 0),
  CONSTRAINT canned_responses_content_check    CHECK (length(btrim(content))     > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS canned_responses_user_code_idx
  ON canned_responses(user_id, lower(short_code));

CREATE INDEX IF NOT EXISTS canned_responses_user_idx
  ON canned_responses(user_id, created_at DESC);

-- Agent in-app notifications
CREATE TABLE IF NOT EXISTS agent_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,                -- 'mention' | 'assigned' | 'unassigned' | 'system'
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  actor_name      TEXT,
  body            TEXT NOT NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_notifications_user_created_idx
  ON agent_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_notifications_unread_idx
  ON agent_notifications(user_id, read_at)
  WHERE read_at IS NULL;
