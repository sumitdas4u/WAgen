CREATE TABLE IF NOT EXISTS workspace_billing_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  legal_name TEXT,
  gstin TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  country TEXT NOT NULL DEFAULT 'IN',
  billing_email TEXT,
  billing_phone TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_billing_profiles_workspace_idx
  ON workspace_billing_profiles(workspace_id);

CREATE TABLE IF NOT EXISTS credit_recharge_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_order_id TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'expired', 'refunded')),
  credits INTEGER NOT NULL CHECK (credits > 0),
  amount_total_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_total_paise >= 0),
  amount_taxable_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_taxable_paise >= 0),
  gst_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (gst_amount_paise >= 0),
  gst_rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 18.00,
  currency TEXT NOT NULL DEFAULT 'INR',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (amount_total_paise = amount_taxable_paise + gst_amount_paise)
);

CREATE INDEX IF NOT EXISTS credit_recharge_orders_workspace_idx
  ON credit_recharge_orders(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_recharge_orders_status_idx
  ON credit_recharge_orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('subscription', 'recharge')),
  source_type TEXT NOT NULL CHECK (source_type IN ('subscription_payment', 'recharge_order')),
  source_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  total_paise INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  taxable_paise INTEGER NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0),
  gst_paise INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  billing_profile_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  line_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS billing_invoices_workspace_idx
  ON billing_invoices(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_invoices_type_idx
  ON billing_invoices(invoice_type, created_at DESC);

CREATE TABLE IF NOT EXISTS auto_recharge_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  threshold_credits INTEGER NOT NULL DEFAULT 50 CHECK (threshold_credits >= 0),
  recharge_credits INTEGER NOT NULL DEFAULT 1000 CHECK (recharge_credits > 0),
  max_recharges_per_day INTEGER NOT NULL DEFAULT 1 CHECK (max_recharges_per_day > 0),
  gateway_customer_id TEXT,
  gateway_token_id TEXT,
  last_triggered_at TIMESTAMPTZ,
  last_status TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_recharge_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  recharge_order_id UUID REFERENCES credit_recharge_orders(id) ON DELETE SET NULL,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS auto_recharge_attempts_workspace_idx
  ON auto_recharge_attempts(workspace_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS auto_recharge_attempts_status_idx
  ON auto_recharge_attempts(status, triggered_at DESC);

INSERT INTO workspace_billing_profiles (
  workspace_id,
  legal_name,
  billing_email,
  country,
  metadata_json
)
SELECT
  w.id,
  COALESCE(NULLIF(TRIM(u.business_type), ''), NULLIF(TRIM(u.name), ''), SPLIT_PART(u.email, '@', 1)),
  u.email,
  'IN',
  jsonb_build_object('seededFrom', 'migration_0006')
FROM workspaces w
JOIN users u ON u.id = w.owner_id
LEFT JOIN workspace_billing_profiles bp ON bp.workspace_id = w.id
WHERE bp.id IS NULL;

INSERT INTO auto_recharge_settings (workspace_id)
SELECT w.id
FROM workspaces w
LEFT JOIN auto_recharge_settings ars ON ars.workspace_id = w.id
WHERE ars.id IS NULL;

DROP TRIGGER IF EXISTS workspace_billing_profiles_touch_updated_at ON workspace_billing_profiles;
CREATE TRIGGER workspace_billing_profiles_touch_updated_at
BEFORE UPDATE ON workspace_billing_profiles
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS credit_recharge_orders_touch_updated_at ON credit_recharge_orders;
CREATE TRIGGER credit_recharge_orders_touch_updated_at
BEFORE UPDATE ON credit_recharge_orders
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS auto_recharge_settings_touch_updated_at ON auto_recharge_settings;
CREATE TRIGGER auto_recharge_settings_touch_updated_at
BEFORE UPDATE ON auto_recharge_settings
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
