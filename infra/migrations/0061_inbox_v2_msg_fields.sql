-- 0061: inbox-v2 message fields (content types, private notes, threading, echo dedup, error tracking)
ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS in_reply_to_id UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS echo_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- Dedup outbound messages by echo_id (NULL echo_ids = inbound, not deduplicated)
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_echo_id
  ON conversation_messages(conversation_id, echo_id)
  WHERE echo_id IS NOT NULL;

-- Composite cursor index for efficient pagination
CREATE INDEX IF NOT EXISTS idx_messages_cursor
  ON conversation_messages(conversation_id, created_at DESC, id DESC);
