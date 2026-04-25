-- 0060: inbox-v2 conversation fields (status machine, priority, snooze, unread tracking)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_priority ON conversations(user_id, priority);
