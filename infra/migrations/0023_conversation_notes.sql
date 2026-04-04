CREATE TABLE IF NOT EXISTS conversation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_notes_content_check CHECK (length(btrim(content)) > 0)
);

CREATE INDEX IF NOT EXISTS conversation_notes_conversation_idx
  ON conversation_notes(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_notes_user_idx
  ON conversation_notes(user_id, created_at DESC);
