-- 0016: structured message type + content for universal chat rendering

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS message_content JSONB;

-- Back-fill message_type for existing rows based on message_text patterns
UPDATE conversation_messages SET message_type = 'image'
  WHERE message_type = 'text'
    AND (message_text LIKE '[IMAGE]%' OR message_text LIKE '[Extracted image text]:%' OR message_text = '[Image received with no readable text]');

UPDATE conversation_messages SET message_type = 'video'
  WHERE message_type = 'text' AND message_text LIKE '[VIDEO]%';

UPDATE conversation_messages SET message_type = 'audio'
  WHERE message_type = 'text' AND message_text LIKE '[AUDIO]%';

UPDATE conversation_messages SET message_type = 'file'
  WHERE message_type = 'text' AND message_text LIKE '[DOCUMENT]%';

UPDATE conversation_messages SET message_type = 'location'
  WHERE message_type = 'text' AND message_text LIKE '[LOCATION]%';

UPDATE conversation_messages SET message_type = 'contact'
  WHERE message_type = 'text' AND message_text LIKE '[CONTACT]%';

UPDATE conversation_messages SET message_type = 'poll'
  WHERE message_type = 'text' AND message_text LIKE '[POLL]%';

UPDATE conversation_messages SET message_type = 'template'
  WHERE message_type = 'text' AND message_text LIKE '[Template:%';

CREATE INDEX IF NOT EXISTS conversation_messages_message_type_idx
  ON conversation_messages(message_type);
