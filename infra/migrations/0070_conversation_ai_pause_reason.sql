ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_pause_reason TEXT;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_ai_pause_reason_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_ai_pause_reason_check
  CHECK (
    ai_pause_reason IS NULL
    OR ai_pause_reason IN (
      'manual',
      'outbound_template',
      'assigned_agent',
      'external_bot',
      'agent_number',
      'flow_handoff'
    )
  );

UPDATE conversations c
SET ai_pause_reason = 'outbound_template'
WHERE c.ai_pause_reason IS NULL
  AND c.manual_takeover = TRUE
  AND c.ai_paused = TRUE
  AND c.assigned_agent_profile_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM conversation_messages cm
    WHERE cm.conversation_id = c.id
      AND cm.direction = 'outbound'
      AND (
        cm.message_type = 'template'
        OR cm.content_type = 'template'
        OR cm.message_content->>'type' = 'template'
        OR cm.message_text ILIKE '[Template:%'
      )
      AND cm.created_at = (
        SELECT MAX(cm2.created_at)
        FROM conversation_messages cm2
        WHERE cm2.conversation_id = c.id
          AND cm2.direction = 'outbound'
      )
  );
