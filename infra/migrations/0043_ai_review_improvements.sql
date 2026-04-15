ALTER TABLE ai_review_queue
  ADD COLUMN IF NOT EXISTS recurrence_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ai_review_audit_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question         TEXT        NOT NULL,
  ai_response      TEXT        NOT NULL,
  confidence_score INTEGER     NOT NULL,
  triage_category  TEXT        NOT NULL CHECK (triage_category IN ('noise', 'monitor')),
  dismiss_reason   TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_review_audit_log_user_created
  ON ai_review_audit_log (user_id, created_at DESC);
