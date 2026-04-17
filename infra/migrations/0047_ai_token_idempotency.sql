-- Idempotency: prevent double-charges when a caller retries with the same reference_id.
-- ON CONFLICT (user_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
-- is used in chargeUser() and creditTokensInternal().
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_token_ledger_user_ref
  ON ai_token_ledger(user_id, reference_id)
  WHERE reference_id IS NOT NULL;

-- Performance index for the daily analytics query (DATE_TRUNC grouping + range filter).
-- The existing ai_token_ledger_user_idx covers (user_id, created_at DESC) for the
-- ledger page; this partial index speeds up the debit-only analytics queries.
CREATE INDEX IF NOT EXISTS idx_ai_token_ledger_user_debit
  ON ai_token_ledger(user_id, created_at DESC)
  WHERE amount < 0;
