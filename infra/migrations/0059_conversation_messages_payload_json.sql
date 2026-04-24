-- 0059: store normalized inbound payload on conversation_messages
ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS payload_json JSONB;
