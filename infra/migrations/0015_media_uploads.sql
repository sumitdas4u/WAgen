-- 0015: media_uploads table for chat attachments + media_url on conversation_messages

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS media_url TEXT;

CREATE TABLE IF NOT EXISTS media_uploads (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  mime_type   TEXT        NOT NULL,
  filename    TEXT,
  data        TEXT        NOT NULL,
  size_bytes  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_uploads_user_id_idx    ON media_uploads(user_id);
CREATE INDEX IF NOT EXISTS media_uploads_created_at_idx ON media_uploads(created_at);
