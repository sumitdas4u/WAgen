-- 0057: per-message webhook_url on conversation_messages
-- Allows callers of send-message / send-text to register a delivery callback
-- URL that is fired when Meta's status webhook (sent/delivered/read/failed) fires
-- for that message's wamid.
ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS webhook_url TEXT;
