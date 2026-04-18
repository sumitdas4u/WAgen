CREATE INDEX IF NOT EXISTS conversation_messages_conversation_cursor_idx
  ON conversation_messages(conversation_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS conversations_user_last_message_cursor_idx
  ON conversations(user_id, last_message_at DESC, id DESC);
