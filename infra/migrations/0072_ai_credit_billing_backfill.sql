-- Backfill statements that were added after 0068 had already run in production.

COMMENT ON COLUMN ai_token_ledger.action_type IS
  'Open-ended AI credit action key. Includes AI actions and billing lifecycle credits such as plan_monthly_reset, recharge_purchase, admin_adjustment, admin_reset, and billing_migration_backfill.';

COMMENT ON COLUMN ai_token_ledger.amount IS
  'AI credits delta: positive values add credits, negative values deduct credits.';

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
