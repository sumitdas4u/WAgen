ALTER TABLE message_delivery_attempts
  DROP CONSTRAINT message_delivery_attempts_message_kind_check;

ALTER TABLE message_delivery_attempts
  ADD CONSTRAINT message_delivery_attempts_message_kind_check
  CHECK (message_kind IN (
    'campaign_template',
    'conversation_template',
    'conversation_flow',
    'conversation_text',
    'direct_text',
    'test_template',
    'sequence_template'
  ));
