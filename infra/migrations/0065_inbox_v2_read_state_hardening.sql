-- 0065: Inbox v2 read-state and notification schema hardening.
-- These objects support mark-read, unread counts, and in-app notification reads.

CREATE TABLE IF NOT EXISTS conversation_read_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_read_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, conversation_id)
);

ALTER TABLE conversation_read_state
  ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE conversation_read_state
SET unread_count = 0
WHERE unread_count IS NULL;

UPDATE conversation_read_state
SET updated_at = NOW()
WHERE updated_at IS NULL;

ALTER TABLE conversation_read_state
  ALTER COLUMN unread_count SET DEFAULT 0,
  ALTER COLUMN unread_count SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE conversation_read_state
  DROP CONSTRAINT IF EXISTS conversation_read_state_unread_count_check,
  ADD CONSTRAINT conversation_read_state_unread_count_check CHECK (unread_count >= 0);

CREATE INDEX IF NOT EXISTS conversation_read_state_conversation_idx
  ON conversation_read_state(conversation_id);

CREATE TABLE IF NOT EXISTS agent_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  actor_name TEXT,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_notifications
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS actor_name TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE agent_notifications
SET type = 'system'
WHERE type IS NULL OR btrim(type) = '';

UPDATE agent_notifications
SET body = ''
WHERE body IS NULL;

UPDATE agent_notifications
SET created_at = NOW()
WHERE created_at IS NULL;

ALTER TABLE agent_notifications
  ALTER COLUMN type SET DEFAULT 'system',
  ALTER COLUMN type SET NOT NULL,
  ALTER COLUMN body SET DEFAULT '',
  ALTER COLUMN body SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS agent_notifications_user_read_idx
  ON agent_notifications(user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_notifications_conversation_idx
  ON agent_notifications(conversation_id, created_at DESC);
