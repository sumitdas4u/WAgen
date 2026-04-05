CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  phone_number TEXT NOT NULL,
  email TEXT,
  contact_type TEXT NOT NULL DEFAULT 'lead',
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  source_url TEXT,
  linked_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, phone_number)
);

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_contact_type_check,
  DROP CONSTRAINT IF EXISTS contacts_source_type_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_contact_type_check CHECK (contact_type IN ('lead', 'feedback', 'complaint', 'other')),
  ADD CONSTRAINT contacts_source_type_check CHECK (source_type IN ('manual', 'import', 'web', 'qr', 'api'));

CREATE INDEX IF NOT EXISTS contacts_user_updated_idx
  ON contacts(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS contacts_user_type_idx
  ON contacts(user_id, contact_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS contacts_user_source_idx
  ON contacts(user_id, source_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS contacts_linked_conversation_idx
  ON contacts(linked_conversation_id);

INSERT INTO contacts (
  user_id,
  display_name,
  phone_number,
  email,
  contact_type,
  tags,
  source_type,
  linked_conversation_id,
  created_at,
  updated_at
)
SELECT
  c.user_id,
  COALESCE(
    (
      SELECT cm.sender_name
      FROM conversation_messages cm
      WHERE cm.conversation_id = c.id
        AND cm.direction = 'inbound'
        AND cm.sender_name IS NOT NULL
      ORDER BY cm.created_at DESC
      LIMIT 1
    ),
    (
      SELECT (regexp_match(cm.message_text, 'Name=([^,]+)'))[1]
      FROM conversation_messages cm
      WHERE cm.conversation_id = c.id
        AND cm.direction = 'inbound'
        AND cm.message_text LIKE 'Lead details captured:%'
      ORDER BY cm.created_at DESC
      LIMIT 1
    )
  ) AS display_name,
  c.phone_number,
  (
    SELECT (regexp_match(cm.message_text, 'Email=([^,\s]+)'))[1]
    FROM conversation_messages cm
    WHERE cm.conversation_id = c.id
      AND cm.direction = 'inbound'
      AND cm.message_text LIKE 'Lead details captured:%'
    ORDER BY cm.created_at DESC
    LIMIT 1
  ) AS email,
  CASE
    WHEN c.lead_kind IN ('lead', 'feedback', 'complaint', 'other') THEN c.lead_kind
    ELSE 'lead'
  END AS contact_type,
  ARRAY[]::TEXT[] AS tags,
  CASE
    WHEN c.channel_type IN ('web', 'qr', 'api') THEN c.channel_type
    ELSE 'manual'
  END AS source_type,
  c.id AS linked_conversation_id,
  COALESCE(c.created_at, NOW()) AS created_at,
  COALESCE(c.updated_at, NOW()) AS updated_at
FROM conversations c
ON CONFLICT (user_id, phone_number) DO UPDATE SET
  display_name = COALESCE(contacts.display_name, EXCLUDED.display_name),
  email = COALESCE(contacts.email, EXCLUDED.email),
  contact_type = EXCLUDED.contact_type,
  linked_conversation_id = COALESCE(contacts.linked_conversation_id, EXCLUDED.linked_conversation_id),
  updated_at = GREATEST(contacts.updated_at, EXCLUDED.updated_at);
