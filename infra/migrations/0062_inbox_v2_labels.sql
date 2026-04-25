-- 0062: inbox-v2 labels system + conversation_labels join table + supporting indexes
CREATE TABLE IF NOT EXISTS labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_labels_user_id ON labels(user_id);

CREATE TABLE IF NOT EXISTS conversation_labels (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_labels_conv_id ON conversation_labels(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_labels_label_id ON conversation_labels(label_id);
