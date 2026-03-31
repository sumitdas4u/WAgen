-- Contact Fields: user-defined extra fields for contacts
CREATE TABLE IF NOT EXISTS contact_fields (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  label       TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  field_type  TEXT NOT NULL CHECK (field_type IN ('TEXT', 'MULTI_TEXT', 'NUMBER', 'SWITCH', 'DATE')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_contact_fields_user_id ON contact_fields (user_id);
