-- ── Migration 0046: AI plan gates ────────────────────────────────────────────
-- Adds per-plan monthly AI token quotas and seeds initial balances for all
-- existing users based on their current subscription_plan.
--
-- Plan token quotas (monthly):
--   trial    →    50  (free taste; blocks heavy usage)
--   starter  →   500
--   pro      →  2 000
--   business → 10 000

-- 1. Add ai_tokens_monthly column to plans table
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS ai_tokens_monthly INT NOT NULL DEFAULT 0;

-- 2. Set monthly quota per plan tier
UPDATE plans SET ai_tokens_monthly = 500   WHERE code = 'starter';
UPDATE plans SET ai_tokens_monthly = 2000  WHERE code = 'pro';
UPDATE plans SET ai_tokens_monthly = 10000 WHERE code = 'business';

-- 3. Seed ai_token_balance for existing users who have none (balance = 0).
--    Trial / free plan users get 50 tokens; paid plans get their full quota.
UPDATE users
SET ai_token_balance = CASE
  WHEN subscription_plan = 'starter'  THEN 500
  WHEN subscription_plan = 'pro'      THEN 2000
  WHEN subscription_plan = 'business' THEN 10000
  ELSE 50  -- trial / unknown
END
WHERE ai_token_balance = 0;

-- 4. Backfill ledger rows so the wallet history isn't empty for existing users
INSERT INTO ai_token_ledger (user_id, amount, action_type, reference_id, balance_after)
SELECT
  u.id,
  u.ai_token_balance,
  'plan_signup_credit',
  'migration-0046-' || u.id::text,
  u.ai_token_balance
FROM users u
WHERE u.ai_token_balance > 0
  AND NOT EXISTS (
    SELECT 1 FROM ai_token_ledger l
    WHERE l.user_id = u.id
      AND l.action_type = 'plan_signup_credit'
      AND l.reference_id = 'migration-0046-' || u.id::text
  );
