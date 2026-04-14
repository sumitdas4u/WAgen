ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS marketing_consent_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS marketing_consent_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_consent_source TEXT,
  ADD COLUMN IF NOT EXISTS marketing_consent_text TEXT,
  ADD COLUMN IF NOT EXISTS marketing_consent_proof_ref TEXT,
  ADD COLUMN IF NOT EXISTS marketing_unsubscribed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_unsubscribe_source TEXT,
  ADD COLUMN IF NOT EXISTS global_opt_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_incoming_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outgoing_template_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outgoing_marketing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outgoing_utility_at TIMESTAMPTZ;

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_marketing_consent_status_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_marketing_consent_status_check
  CHECK (marketing_consent_status IN ('unknown', 'subscribed', 'unsubscribed', 'revoked'));

UPDATE contacts
SET marketing_consent_status = 'unknown'
WHERE marketing_consent_status IS NULL;

UPDATE contacts c
SET
  marketing_consent_status = 'unsubscribed',
  marketing_unsubscribed_at = COALESCE(c.marketing_unsubscribed_at, cds.last_failed_at),
  marketing_unsubscribe_source = COALESCE(c.marketing_unsubscribe_source, cds.source)
FROM contact_delivery_suppressions cds
WHERE cds.user_id = c.user_id
  AND cds.phone_number = c.phone_number
  AND cds.reason_code = 'opt_out';

WITH inbound_activity AS (
  SELECT
    c.id AS contact_id,
    MAX(cm.created_at) AS last_incoming_message_at
  FROM contacts c
  JOIN conversations conv
    ON conv.user_id = c.user_id
   AND conv.phone_number = c.phone_number
  JOIN conversation_messages cm
    ON cm.conversation_id = conv.id
   AND cm.direction = 'inbound'
  GROUP BY c.id
)
UPDATE contacts c
SET last_incoming_message_at = inbound_activity.last_incoming_message_at
FROM inbound_activity
WHERE inbound_activity.contact_id = c.id
  AND (
    c.last_incoming_message_at IS NULL
    OR inbound_activity.last_incoming_message_at > c.last_incoming_message_at
  );

WITH outbound_template_activity AS (
  SELECT
    c.id AS contact_id,
    MAX(mda.created_at) AS last_outgoing_template_at,
    MAX(mda.created_at) FILTER (WHERE mt.category = 'MARKETING') AS last_outgoing_marketing_at,
    MAX(mda.created_at) FILTER (WHERE mt.category IN ('UTILITY', 'AUTHENTICATION')) AS last_outgoing_utility_at
  FROM contacts c
  JOIN message_delivery_attempts mda
    ON mda.user_id = c.user_id
   AND mda.phone_number = c.phone_number
   AND mda.message_kind IN ('campaign_template', 'conversation_template', 'test_template')
  LEFT JOIN message_templates mt
    ON mt.id = NULLIF(mda.requested_payload_json->>'templateId', '')::uuid
  GROUP BY c.id
)
UPDATE contacts c
SET
  last_outgoing_template_at = outbound_template_activity.last_outgoing_template_at,
  last_outgoing_marketing_at = outbound_template_activity.last_outgoing_marketing_at,
  last_outgoing_utility_at = outbound_template_activity.last_outgoing_utility_at
FROM outbound_template_activity
WHERE outbound_template_activity.contact_id = c.id;

CREATE INDEX IF NOT EXISTS contacts_user_consent_idx
  ON contacts(user_id, marketing_consent_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS contacts_user_last_incoming_idx
  ON contacts(user_id, last_incoming_message_at DESC);
