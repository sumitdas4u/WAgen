-- Phase 1 foundation for AI-credit billing.
-- Conversations remain unlimited for product usage; AI automation is tracked here.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS annual_price INTEGER NOT NULL DEFAULT 0 CHECK (annual_price >= 0),
  ADD COLUMN IF NOT EXISTS ai_tokens_monthly INTEGER NOT NULL DEFAULT 0 CHECK (ai_tokens_monthly >= 0);

UPDATE plans
SET
  name = 'Starter',
  price_monthly = 799,
  annual_price = 7990,
  monthly_credits = 300,
  ai_tokens_monthly = 300,
  agent_limit = 5,
  whatsapp_number_limit = 1,
  metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object(
    'billingUnit', 'ai_credit',
    'conversations', 'unlimited',
    'annualCopy', '2 months free'
  )
WHERE code = 'starter';

UPDATE plans
SET
  name = 'Growth',
  price_monthly = 1499,
  annual_price = 14990,
  monthly_credits = 700,
  ai_tokens_monthly = 700,
  agent_limit = 10,
  whatsapp_number_limit = 2,
  metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object(
    'billingUnit', 'ai_credit',
    'conversations', 'unlimited',
    'annualCopy', '2 months free'
  )
WHERE code = 'pro';

UPDATE plans
SET
  name = 'Pro',
  price_monthly = 2999,
  annual_price = 29990,
  monthly_credits = 1500,
  ai_tokens_monthly = 1500,
  agent_limit = 30,
  whatsapp_number_limit = 3,
  metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object(
    'billingUnit', 'ai_credit',
    'conversations', 'unlimited',
    'annualCopy', '2 months free'
  )
WHERE code = 'business';

ALTER TABLE ai_token_ledger
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS module TEXT,
  ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  ADD COLUMN IF NOT EXISTS completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  ADD COLUMN IF NOT EXISTS total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS estimated_cost_inr NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (estimated_cost_inr >= 0),
  ADD COLUMN IF NOT EXISTS estimated_credits_reserved INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_deducted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'finalized';

ALTER TABLE ai_token_ledger
  DROP CONSTRAINT IF EXISTS ai_token_ledger_status_check;

ALTER TABLE ai_token_ledger
  ADD CONSTRAINT ai_token_ledger_status_check
  CHECK (status IN ('reserved', 'finalized', 'reversed', 'failed', 'credit'));

COMMENT ON COLUMN ai_token_ledger.action_type IS
  'Open-ended AI credit action key. Includes AI actions and billing lifecycle credits such as plan_monthly_reset, recharge_purchase, admin_adjustment, admin_reset, and billing_migration_backfill.';

COMMENT ON COLUMN ai_token_ledger.amount IS
  'AI credits delta: positive values add credits, negative values deduct credits.';

UPDATE ai_token_ledger
SET
  credits_deducted = ABS(amount),
  status = CASE WHEN amount >= 0 THEN 'credit' ELSE 'finalized' END
WHERE credits_deducted = 0;

UPDATE ai_token_ledger l
SET workspace_id = u.workspace_id
FROM users u
WHERE l.user_id = u.id
  AND l.workspace_id IS NULL;

UPDATE credit_wallet cw
SET
  total_credits = 50,
  remaining_credits = LEAST(remaining_credits, 50),
  updated_at = NOW()
FROM workspaces w
JOIN subscriptions s ON s.workspace_id = w.id
WHERE cw.workspace_id = w.id
  AND s.status = 'trial'
  AND cw.total_credits > 50;

UPDATE users u
SET ai_token_balance = LEAST(u.ai_token_balance, 50)
FROM workspaces w
JOIN subscriptions s ON s.workspace_id = w.id
WHERE u.id = w.owner_id
  AND s.status = 'trial'
  AND u.ai_token_balance > 50;

UPDATE users u
SET ai_token_balance = CASE
  WHEN s.status = 'trial' THEN 50
  ELSE COALESCE(NULLIF(p.ai_tokens_monthly, 0), 50)
END
FROM workspaces w
JOIN subscriptions s ON s.workspace_id = w.id
LEFT JOIN plans p ON p.id = s.plan_id
WHERE u.id = w.owner_id
  AND u.ai_token_balance = 0
  AND s.status IN ('trial', 'active');

INSERT INTO ai_token_ledger (
  user_id,
  workspace_id,
  amount,
  action_type,
  module,
  reference_id,
  balance_after,
  credits_deducted,
  status
)
SELECT
  u.id,
  w.id,
  u.ai_token_balance,
  'billing_migration_backfill',
  'billing',
  'ai-billing-backfill-0068-' || u.id::text,
  u.ai_token_balance,
  0,
  'credit'
FROM users u
JOIN workspaces w ON w.owner_id = u.id
WHERE u.ai_token_balance > 0
  AND NOT EXISTS (
    SELECT 1
    FROM ai_token_ledger l
    WHERE l.user_id = u.id
      AND l.reference_id = 'ai-billing-backfill-0068-' || u.id::text
  );

CREATE INDEX IF NOT EXISTS ai_token_ledger_workspace_idx
  ON ai_token_ledger(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_token_ledger_action_idx
  ON ai_token_ledger(action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_token_ledger_module_idx
  ON ai_token_ledger(module, created_at DESC)
  WHERE module IS NOT NULL;
