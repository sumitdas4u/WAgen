ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES whatsapp_business_connections(id) ON DELETE SET NULL;

UPDATE campaigns c
SET connection_id = mt.connection_id
FROM message_templates mt
WHERE c.template_id = mt.id
  AND c.connection_id IS NULL;

CREATE INDEX IF NOT EXISTS campaigns_user_connection_idx
  ON campaigns(user_id, connection_id, updated_at DESC);

ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES whatsapp_business_connections(id) ON DELETE SET NULL;

WITH sequence_template_connections AS (
  SELECT
    ss.sequence_id,
    MIN(mt.connection_id) AS connection_id,
    COUNT(DISTINCT mt.connection_id) AS connection_count
  FROM sequence_steps ss
  JOIN message_templates mt ON mt.id = ss.message_template_id
  GROUP BY ss.sequence_id
)
UPDATE sequences s
SET connection_id = stc.connection_id
FROM sequence_template_connections stc
WHERE s.id = stc.sequence_id
  AND s.connection_id IS NULL
  AND stc.connection_count = 1;

CREATE INDEX IF NOT EXISTS sequences_user_connection_idx
  ON sequences(user_id, connection_id, updated_at DESC);

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES whatsapp_business_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS flows_user_connection_idx
  ON flows(user_id, connection_id, updated_at DESC);
