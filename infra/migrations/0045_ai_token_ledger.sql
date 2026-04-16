-- AI token balance on each user
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_token_balance INT NOT NULL DEFAULT 0;

-- Full audit ledger — every debit and credit
CREATE TABLE IF NOT EXISTS ai_token_ledger (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       INT         NOT NULL,          -- positive = credit, negative = debit
  action_type  TEXT        NOT NULL,
  reference_id TEXT,                          -- optional: template_id, conversation_id, etc.
  balance_after INT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_token_ledger_user_idx
  ON ai_token_ledger(user_id, created_at DESC);
