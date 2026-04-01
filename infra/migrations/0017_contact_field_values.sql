-- Contact Field Values: stores actual custom field values per contact
CREATE TABLE IF NOT EXISTS contact_field_values (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  field_id   UUID NOT NULL REFERENCES contact_fields(id) ON DELETE CASCADE,
  value      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contact_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_field_values_contact_id ON contact_field_values(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_field_values_field_id ON contact_field_values(field_id);
