-- 0049: add source_type to conversation_messages for message info tracking

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'broadcast', 'sequence', 'bot', 'api', 'system'));
