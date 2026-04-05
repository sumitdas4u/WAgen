WITH normalized_contacts AS (
  SELECT
    c.id,
    c.user_id,
    regexp_replace(c.phone_number, '\D', '', 'g') AS normalized_phone,
    c.display_name,
    c.email,
    c.contact_type,
    c.tags,
    c.source_type,
    c.source_id,
    c.source_url,
    c.linked_conversation_id,
    c.created_at,
    c.updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY c.user_id, regexp_replace(c.phone_number, '\D', '', 'g')
      ORDER BY
        CASE WHEN c.linked_conversation_id IS NOT NULL THEN 0 ELSE 1 END,
        c.updated_at DESC,
        c.created_at DESC,
        c.id
    ) AS rank_in_group
  FROM contacts c
),
duplicate_contacts AS (
  SELECT *
  FROM normalized_contacts
  WHERE normalized_phone <> ''
),
survivors AS (
  SELECT *
  FROM duplicate_contacts
  WHERE rank_in_group = 1
),
duplicates AS (
  SELECT *
  FROM duplicate_contacts
  WHERE rank_in_group > 1
),
field_value_merge AS (
  SELECT DISTINCT ON (target.id, cfv.field_id)
    target.id AS target_contact_id,
    cfv.field_id,
    cfv.value
  FROM duplicates source
  JOIN survivors target
    ON target.user_id = source.user_id
   AND target.normalized_phone = source.normalized_phone
  JOIN contact_field_values cfv
    ON cfv.contact_id = source.id
  ORDER BY target.id, cfv.field_id, cfv.updated_at DESC, cfv.created_at DESC, cfv.id DESC
),
upserted_field_values AS (
  INSERT INTO contact_field_values (contact_id, field_id, value)
  SELECT target_contact_id, field_id, value
  FROM field_value_merge
  ON CONFLICT (contact_id, field_id) DO UPDATE
    SET value = COALESCE(contact_field_values.value, EXCLUDED.value),
        updated_at = NOW()
  RETURNING contact_id
),
rewired_campaign_messages AS (
  UPDATE campaign_messages cm
  SET contact_id = target.id
  FROM duplicates source
  JOIN survivors target
    ON target.user_id = source.user_id
   AND target.normalized_phone = source.normalized_phone
  WHERE cm.contact_id = source.id
    AND cm.contact_id IS DISTINCT FROM target.id
  RETURNING cm.id
),
rewired_message_delivery_attempts AS (
  UPDATE message_delivery_attempts mda
  SET contact_id = target.id
  FROM duplicates source
  JOIN survivors target
    ON target.user_id = source.user_id
   AND target.normalized_phone = source.normalized_phone
  WHERE mda.contact_id = source.id
    AND mda.contact_id IS DISTINCT FROM target.id
  RETURNING mda.id
),
rewired_contact_delivery_suppressions AS (
  UPDATE contact_delivery_suppressions cds
  SET contact_id = target.id
  FROM duplicates source
  JOIN survivors target
    ON target.user_id = source.user_id
   AND target.normalized_phone = source.normalized_phone
  WHERE cds.contact_id = source.id
    AND cds.contact_id IS DISTINCT FROM target.id
  RETURNING cds.id
),
rewired_generic_webhook_logs AS (
  UPDATE generic_webhook_logs gwl
  SET contact_id = target.id
  FROM duplicates source
  JOIN survivors target
    ON target.user_id = source.user_id
   AND target.normalized_phone = source.normalized_phone
  WHERE gwl.contact_id = source.id
    AND gwl.contact_id IS DISTINCT FROM target.id
  RETURNING gwl.id
),
merged_survivors AS (
  UPDATE contacts survivor
  SET
    phone_number = source.normalized_phone,
    display_name = COALESCE(survivor.display_name, source.display_name),
    email = COALESCE(survivor.email, source.email),
    contact_type = CASE
      WHEN survivor.contact_type = 'complaint' OR source.contact_type = 'complaint' THEN 'complaint'
      WHEN survivor.contact_type = 'feedback' OR source.contact_type = 'feedback' THEN 'feedback'
      WHEN survivor.contact_type = 'lead' OR source.contact_type = 'lead' THEN 'lead'
      ELSE 'other'
    END,
    tags = ARRAY(
      SELECT DISTINCT tag
      FROM unnest(COALESCE(survivor.tags, ARRAY[]::text[]) || COALESCE(source.tags, ARRAY[]::text[])) AS tag
      WHERE tag IS NOT NULL AND btrim(tag) <> ''
      ORDER BY tag
    ),
    source_type = CASE
      WHEN survivor.source_type IN ('manual', 'import') THEN survivor.source_type
      WHEN source.source_type IN ('manual', 'import') THEN source.source_type
      ELSE survivor.source_type
    END,
    source_id = CASE
      WHEN survivor.source_type IN ('manual', 'import') THEN COALESCE(survivor.source_id, source.source_id)
      WHEN source.source_type IN ('manual', 'import') THEN COALESCE(source.source_id, survivor.source_id)
      ELSE COALESCE(survivor.source_id, source.source_id)
    END,
    source_url = CASE
      WHEN survivor.source_type IN ('manual', 'import') THEN COALESCE(survivor.source_url, source.source_url)
      WHEN source.source_type IN ('manual', 'import') THEN COALESCE(source.source_url, survivor.source_url)
      ELSE COALESCE(survivor.source_url, source.source_url)
    END,
    linked_conversation_id = COALESCE(survivor.linked_conversation_id, source.linked_conversation_id),
    created_at = LEAST(survivor.created_at, source.created_at),
    updated_at = GREATEST(survivor.updated_at, source.updated_at, NOW())
  FROM (
    SELECT
      target.id,
      target.user_id,
      target.normalized_phone,
      MAX(source.display_name) FILTER (WHERE source.display_name IS NOT NULL) AS display_name,
      MAX(source.email) FILTER (WHERE source.email IS NOT NULL) AS email,
      (
        SELECT s.contact_type
        FROM duplicates s
        WHERE s.user_id = target.user_id
          AND s.normalized_phone = target.normalized_phone
        ORDER BY
          CASE s.contact_type
            WHEN 'complaint' THEN 4
            WHEN 'feedback' THEN 3
            WHEN 'lead' THEN 2
            ELSE 1
          END DESC,
          s.updated_at DESC,
          s.created_at DESC
        LIMIT 1
      ) AS contact_type,
      ARRAY(
        SELECT DISTINCT tag
        FROM duplicates d
        CROSS JOIN LATERAL unnest(COALESCE(d.tags, ARRAY[]::text[])) AS tag
        WHERE d.user_id = target.user_id
          AND d.normalized_phone = target.normalized_phone
          AND tag IS NOT NULL
          AND btrim(tag) <> ''
        ORDER BY tag
      ) AS tags,
      (
        SELECT s.source_type
        FROM duplicates s
        WHERE s.user_id = target.user_id
          AND s.normalized_phone = target.normalized_phone
        ORDER BY
          CASE
            WHEN s.source_type IN ('manual', 'import') THEN 0
            ELSE 1
          END,
          s.updated_at DESC,
          s.created_at DESC
        LIMIT 1
      ) AS source_type,
      (
        SELECT s.source_id
        FROM duplicates s
        WHERE s.user_id = target.user_id
          AND s.normalized_phone = target.normalized_phone
          AND s.source_id IS NOT NULL
        ORDER BY
          CASE
            WHEN s.source_type IN ('manual', 'import') THEN 0
            ELSE 1
          END,
          s.updated_at DESC,
          s.created_at DESC
        LIMIT 1
      ) AS source_id,
      (
        SELECT s.source_url
        FROM duplicates s
        WHERE s.user_id = target.user_id
          AND s.normalized_phone = target.normalized_phone
          AND s.source_url IS NOT NULL
        ORDER BY
          CASE
            WHEN s.source_type IN ('manual', 'import') THEN 0
            ELSE 1
          END,
          s.updated_at DESC,
          s.created_at DESC
        LIMIT 1
      ) AS source_url,
      (
        SELECT s.linked_conversation_id
        FROM duplicates s
        WHERE s.user_id = target.user_id
          AND s.normalized_phone = target.normalized_phone
          AND s.linked_conversation_id IS NOT NULL
        ORDER BY
          s.updated_at DESC,
          s.created_at DESC
        LIMIT 1
      ) AS linked_conversation_id,
      MIN(source.created_at) AS created_at,
      MAX(source.updated_at) AS updated_at
    FROM survivors target
    JOIN duplicates source
      ON source.user_id = target.user_id
     AND source.normalized_phone = target.normalized_phone
    GROUP BY target.id, target.user_id, target.normalized_phone
  ) AS source
  WHERE survivor.id = source.id
  RETURNING survivor.id
)
DELETE FROM contacts c
USING duplicates d
WHERE c.id = d.id;

UPDATE contacts
SET phone_number = regexp_replace(phone_number, '\D', '', 'g')
WHERE phone_number <> regexp_replace(phone_number, '\D', '', 'g');

DELETE FROM contacts
WHERE phone_number = '';

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_user_id_phone_number_key;

DROP INDEX IF EXISTS contacts_user_phone_number_normalized_idx;

CREATE UNIQUE INDEX contacts_user_phone_number_normalized_idx
  ON contacts (user_id, regexp_replace(phone_number, '\D', '', 'g'));
