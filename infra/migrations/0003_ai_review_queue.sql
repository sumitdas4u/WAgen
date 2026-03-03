CREATE TABLE IF NOT EXISTS ai_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  question TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  trigger_signals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'pending',
  resolution_answer TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_review_queue
  DROP CONSTRAINT IF EXISTS ai_review_queue_confidence_score_check,
  DROP CONSTRAINT IF EXISTS ai_review_queue_status_check;

ALTER TABLE ai_review_queue
  ADD CONSTRAINT ai_review_queue_confidence_score_check CHECK (confidence_score >= 0 AND confidence_score <= 100),
  ADD CONSTRAINT ai_review_queue_status_check CHECK (status IN ('pending', 'resolved'));

CREATE INDEX IF NOT EXISTS ai_review_queue_user_status_idx
  ON ai_review_queue(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_review_queue_conversation_idx
  ON ai_review_queue(conversation_id, created_at DESC);
