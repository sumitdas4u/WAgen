CREATE TABLE IF NOT EXISTS message_templates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id         UUID        NOT NULL REFERENCES whatsapp_business_connections(id) ON DELETE CASCADE,
  template_id           TEXT,
  name                  TEXT        NOT NULL,
  category              TEXT        NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  language              TEXT        NOT NULL DEFAULT 'en_US',
  status                TEXT        NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED')),
  quality_score         TEXT,
  components_json       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  meta_rejection_reason TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_templates_user_idx
  ON message_templates(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS message_templates_connection_idx
  ON message_templates(connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS message_templates_template_id_idx
  ON message_templates(template_id)
  WHERE template_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_connection_name_lang_uq
  ON message_templates(connection_id, name, language)
  WHERE status <> 'DISABLED';

DROP TRIGGER IF EXISTS message_templates_touch_updated_at ON message_templates;
CREATE TRIGGER message_templates_touch_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
