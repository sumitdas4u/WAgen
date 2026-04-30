-- 0066: allow inbox retry to mark outbound messages as pending while re-queued

ALTER TABLE conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_delivery_status_check;

ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_delivery_status_check
  CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'read', 'failed'));
