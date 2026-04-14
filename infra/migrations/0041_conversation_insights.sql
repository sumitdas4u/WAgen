-- 0031: conversation_insights table for daily report
CREATE TABLE IF NOT EXISTS conversation_insights (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             TEXT        NOT NULL CHECK (type IN ('lead', 'complaint', 'feedback')),
  summary          TEXT        NOT NULL,
  sentiment        TEXT        CHECK (sentiment IN ('positive', 'neutral', 'negative', 'angry', 'frustrated')),
  priority_score   INTEGER     NOT NULL DEFAULT 50 CHECK (priority_score >= 0 AND priority_score <= 100),
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'pending')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id)
);

CREATE INDEX IF NOT EXISTS conversation_insights_user_type_score_idx
  ON conversation_insights(user_id, type, priority_score DESC, created_at DESC);

DROP TRIGGER IF EXISTS conversation_insights_touch_updated_at ON conversation_insights;
CREATE TRIGGER conversation_insights_touch_updated_at
  BEFORE UPDATE ON conversation_insights
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();
