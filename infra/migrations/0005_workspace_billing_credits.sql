CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  price_monthly INTEGER NOT NULL DEFAULT 0 CHECK (price_monthly >= 0),
  monthly_credits INTEGER NOT NULL DEFAULT 0 CHECK (monthly_credits >= 0),
  agent_limit INTEGER NOT NULL DEFAULT 1 CHECK (agent_limit >= 0),
  whatsapp_number_limit INTEGER NOT NULL DEFAULT 1 CHECK (whatsapp_number_limit >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plans (code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status)
VALUES
  ('starter', 'Starter', 999, 1000, 5, 1, 'active'),
  ('pro', 'Growth', 2999, 5000, 15, 2, 'active'),
  ('business', 'Pro', 7999, 20000, 50, 5, 'active')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted'))
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'super_admin'));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_workspace_id_fkey;

ALTER TABLE users
  ADD CONSTRAINT users_workspace_id_fkey
  FOREIGN KEY (workspace_id)
  REFERENCES workspaces(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces(owner_id);
CREATE INDEX IF NOT EXISTS workspaces_plan_status_idx ON workspaces(plan_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('active', 'trial', 'past_due', 'cancelled')),
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_billing_date TIMESTAMPTZ,
  payment_gateway_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions(status, next_billing_date);
CREATE INDEX IF NOT EXISTS subscriptions_plan_idx ON subscriptions(plan_id, status);

CREATE TABLE IF NOT EXISTS credit_wallet (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  total_credits INTEGER NOT NULL DEFAULT 0 CHECK (total_credits >= 0),
  used_credits INTEGER NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
  remaining_credits INTEGER NOT NULL DEFAULT 0 CHECK (remaining_credits >= 0),
  last_reset_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  low_credit_notified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (remaining_credits <= total_credits)
);

CREATE INDEX IF NOT EXISTS credit_wallet_remaining_idx ON credit_wallet(remaining_credits, updated_at DESC);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('subscription', 'deduction', 'admin_adjustment', 'addon_purchase', 'renewal')),
  credits INTEGER NOT NULL,
  reference_id TEXT,
  reason TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS credit_transactions_workspace_idx
  ON credit_transactions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_transactions_type_idx
  ON credit_transactions(type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_type_reference_uidx
  ON credit_transactions(type, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credit_deducted BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_sessions_workspace_customer_idx
  ON conversation_sessions(workspace_id, customer_phone, last_message_time DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);

INSERT INTO workspaces (name, owner_id, plan_id, status)
SELECT
  COALESCE(NULLIF(TRIM(u.business_type), ''), CONCAT(SPLIT_PART(u.email, '@', 1), ' Workspace')) AS name,
  u.id AS owner_id,
  p.id AS plan_id,
  'active'
FROM users u
LEFT JOIN workspaces w ON w.owner_id = u.id
LEFT JOIN plans p
  ON p.code = CASE
    WHEN u.subscription_plan = 'business' THEN 'business'
    WHEN u.subscription_plan = 'pro' THEN 'pro'
    ELSE 'starter'
  END
WHERE w.id IS NULL;

UPDATE users u
SET workspace_id = w.id
FROM workspaces w
WHERE w.owner_id = u.id
  AND (u.workspace_id IS NULL OR u.workspace_id <> w.id);

UPDATE workspaces w
SET plan_id = p.id
FROM users u
JOIN plans p
  ON p.code = CASE
    WHEN u.subscription_plan = 'business' THEN 'business'
    WHEN u.subscription_plan = 'pro' THEN 'pro'
    ELSE 'starter'
  END
WHERE w.owner_id = u.id
  AND w.plan_id IS DISTINCT FROM p.id;

INSERT INTO subscriptions (
  workspace_id,
  plan_id,
  status,
  start_date,
  next_billing_date,
  payment_gateway_id,
  metadata_json
)
SELECT
  w.id AS workspace_id,
  w.plan_id AS plan_id,
  CASE
    WHEN u.subscription_plan = 'trial' THEN 'trial'
    ELSE 'active'
  END AS status,
  NOW() AS start_date,
  CASE
    WHEN u.subscription_plan = 'trial' THEN NOW() + INTERVAL '14 days'
    ELSE NOW() + INTERVAL '30 days'
  END AS next_billing_date,
  us.razorpay_subscription_id AS payment_gateway_id,
  jsonb_build_object(
    'seededFrom', 'migration_0005',
    'legacyPlan', u.subscription_plan
  ) AS metadata_json
FROM workspaces w
JOIN users u ON u.id = w.owner_id
LEFT JOIN user_subscriptions us ON us.user_id = u.id
LEFT JOIN subscriptions s ON s.workspace_id = w.id
WHERE s.id IS NULL
  AND w.plan_id IS NOT NULL;

INSERT INTO credit_wallet (
  workspace_id,
  total_credits,
  used_credits,
  remaining_credits,
  last_reset_date
)
SELECT
  w.id AS workspace_id,
  CASE
    WHEN u.subscription_plan = 'trial' THEN 200
    ELSE COALESCE(p.monthly_credits, 0)
  END AS total_credits,
  0 AS used_credits,
  CASE
    WHEN u.subscription_plan = 'trial' THEN 200
    ELSE COALESCE(p.monthly_credits, 0)
  END AS remaining_credits,
  NOW() AS last_reset_date
FROM workspaces w
JOIN users u ON u.id = w.owner_id
LEFT JOIN plans p ON p.id = w.plan_id
LEFT JOIN credit_wallet cw ON cw.workspace_id = w.id
WHERE cw.id IS NULL;

INSERT INTO credit_transactions (
  workspace_id,
  type,
  credits,
  reference_id,
  reason,
  metadata_json
)
SELECT
  cw.workspace_id,
  'subscription' AS type,
  cw.total_credits AS credits,
  CONCAT('migration-seed-', cw.workspace_id::text) AS reference_id,
  'Initial wallet seed from migration 0005' AS reason,
  jsonb_build_object('source', 'migration_0005')
FROM credit_wallet cw
LEFT JOIN credit_transactions ct
  ON ct.type = 'subscription'
 AND ct.reference_id = CONCAT('migration-seed-', cw.workspace_id::text)
WHERE ct.id IS NULL;

DROP TRIGGER IF EXISTS plans_touch_updated_at ON plans;
CREATE TRIGGER plans_touch_updated_at
BEFORE UPDATE ON plans
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS workspaces_touch_updated_at ON workspaces;
CREATE TRIGGER workspaces_touch_updated_at
BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS subscriptions_touch_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_touch_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS credit_wallet_touch_updated_at ON credit_wallet;
CREATE TRIGGER credit_wallet_touch_updated_at
BEFORE UPDATE ON credit_wallet
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
